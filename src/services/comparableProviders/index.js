import { fetchApifyEmlakjetComparableBundle } from "./apifyEmlakjetProvider.js";
import { fetchHepsiemlakComparableBundle } from "./hepsiemlakProvider.js";
import { fetchRemaxComparableBundle } from "./remaxProvider.js";
import {
    PROVIDER_TIMEOUT_MS,
    TARGET_STALE_GROUP_SIZE,
    TARGET_TOTAL,
    comparableUnitPrice,
    quantile,
    selectPortfolioGroups,
    selectValuationComparables,
    toNumber,
    uniqueComparables,
} from "../comparablePolicy.js";
import {
    CACHE_PROVIDER,
    cachedProviderBundle,
    findCachedComparables,
} from "../comparableCache.js";

const PROVIDERS = {
    HEPSIEMLAK: {
        name: "HEPSIEMLAK",
        fetch: fetchHepsiemlakComparableBundle,
        costTier: "free",
    },
    REMAX_PUBLIC: {
        name: "REMAX_PUBLIC",
        fetch: fetchRemaxComparableBundle,
        costTier: "free",
    },
    APIFY_EMLAKJET: {
        name: "APIFY_EMLAKJET",
        fetch: fetchApifyEmlakjetComparableBundle,
        costTier: "paid",
    },
};

function buildPriceBand(comparables = [], subjectArea = null, options = {}) {
    const area = toNumber(subjectArea);
    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const prices = comparables.map((item) => toNumber(item?.price)).filter(Number.isFinite);
    const canUseAbsoluteGuard = options.propertyCategory !== "land" && prices.length >= 3;

    if (area && area > 0 && unitPrices.length >= 3) {
        const minPricePerSqm = Math.round(quantile(unitPrices, 0.2));
        const expectedPricePerSqm = Math.round(quantile(unitPrices, 0.5));
        const maxPricePerSqm = Math.round(quantile(unitPrices, 0.8));
        const unitMinPrice = Math.round(minPricePerSqm * area);
        const unitExpectedPrice = Math.round(expectedPricePerSqm * area);
        const unitMaxPrice = Math.round(maxPricePerSqm * area);
        const absoluteMinGuard = canUseAbsoluteGuard ? Math.round(quantile(prices, 0.2) * 0.92) : null;
        const absoluteExpectedGuard = canUseAbsoluteGuard ? Math.round(quantile(prices, 0.5) * 0.96) : null;
        const absoluteMaxGuard = canUseAbsoluteGuard ? Math.round(quantile(prices, 0.8)) : null;
        const minPrice = absoluteMinGuard ? Math.max(unitMinPrice, absoluteMinGuard) : unitMinPrice;
        const expectedPrice = absoluteExpectedGuard ? Math.max(unitExpectedPrice, absoluteExpectedGuard, minPrice) : Math.max(unitExpectedPrice, minPrice);
        const maxPrice = absoluteMaxGuard ? Math.max(unitMaxPrice, absoluteMaxGuard, expectedPrice) : Math.max(unitMaxPrice, expectedPrice);

        return {
            minPricePerSqm,
            expectedPricePerSqm,
            maxPricePerSqm,
            minPrice,
            expectedPrice,
            maxPrice,
            confidence: Math.min(0.66, 0.38 + unitPrices.length * 0.012),
            note: `${comparables.length} konuya yakın otomatik emsal üzerinden hesaplanan fiyat bandıdır.`,
            comparablePriceGuard: absoluteMinGuard
                ? {
                      minPrice: absoluteMinGuard,
                      expectedPrice: absoluteExpectedGuard,
                      maxPrice: absoluteMaxGuard,
                      note: "Konut emsallerinde birim m² normalizasyonunun toplam fiyatı emsal havuzunun altına aşırı çekmemesi için mutlak emsal fiyat tabanı uygulanmıştır.",
                  }
                : null,
        };
    }

    if (prices.length < 3) return null;
    const minPrice = Math.round(quantile(prices, 0.2));
    const expectedPrice = Math.round(quantile(prices, 0.5));
    const maxPrice = Math.round(quantile(prices, 0.8));
    return {
        minPrice,
        expectedPrice,
        maxPrice,
        minPricePerSqm: area && area > 0 ? Math.round(minPrice / area) : null,
        expectedPricePerSqm: area && area > 0 ? Math.round(expectedPrice / area) : null,
        maxPricePerSqm: area && area > 0 ? Math.round(maxPrice / area) : null,
        confidence: Math.min(0.58, 0.34 + prices.length * 0.01),
        note: `${comparables.length} konuya yakın otomatik emsal fiyat dağılımı üzerinden hesaplanan fiyat bandıdır.`,
    };
}

export function buildMarketProjection(comparables = [], rawCount = null, diagnostics = {}) {
    const days = comparables.map((item) => toNumber(item?.daysOnMarket)).filter(Number.isFinite);
    const averageMarketingDays = days.length
        ? Math.round(days.reduce((sum, item) => sum + item, 0) / days.length)
        : null;
    const activeComparableCount = rawCount || comparables.length;
    const longListedCount = diagnostics.longListedCount ?? comparables.filter((item) => item.longListed).length;
    const waitingComparableCount = longListedCount || null;
    const competitionStatus =
        activeComparableCount >= 120
            ? "Yüksek"
            : activeComparableCount >= 40
              ? "Orta"
              : comparables.length >= TARGET_TOTAL
                ? "Orta"
                : "Düşük";

    return {
        averageMarketingDays,
        competitionStatus,
        activeComparableCount,
        waitingComparableCount,
        annualChangePct: null,
        amortizationYears: null,
        summary: `${comparables.length} otomatik emsal seçildi. Kaynaklarda ${activeComparableCount} aktif emsal sinyali bulundu.${waitingComparableCount ? ` ${waitingComparableCount} ilan uzun süredir yayında görünüyor.` : ""}`,
        manualText: `${comparables.length} otomatik emsal seçildi. Kaynaklarda ${activeComparableCount} aktif emsal sinyali bulundu.${waitingComparableCount ? ` ${waitingComparableCount} ilan uzun süredir yayında görünüyor.` : ""}`,
    };
}

function buildRegionalStats(criteria = {}, comparables = [], marketProjection = null) {
    const prices = comparables.map((item) => toNumber(item?.price)).filter(Number.isFinite);
    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const locationLabel = [criteria.neighborhood, criteria.district, criteria.city].filter(Boolean).join(" / ");

    if (!prices.length) return null;

    const minPrice = Math.min(...prices).toLocaleString("tr-TR");
    const maxPrice = Math.max(...prices).toLocaleString("tr-TR");
    const medianPrice = Math.round(quantile(prices, 0.5)).toLocaleString("tr-TR");
    const unitSummary = unitPrices.length
        ? ` Birim fiyat aralığı ${Math.min(...unitPrices).toLocaleString("tr-TR")} - ${Math.max(...unitPrices).toLocaleString("tr-TR")} TL/m².`
        : "";

    return {
        demographicsSummary: locationLabel ? `${locationLabel} için ilan havuzu kaynaklı piyasa sinyalleri oluşturuldu.` : null,
        saleMarketSummary: `Seçilen emsal havuzunda fiyatlar ${minPrice} TL - ${maxPrice} TL aralığında; medyan fiyat ${medianPrice} TL.${unitSummary}`,
        rentalMarketSummary: marketProjection?.summary || null,
        nearbyPlacesSummary: null,
        riskSummary: "Bu bölüm Hepsiemlak, RE/MAX, Emlakjet ve arama sonucu kaynaklarından derlenen ilan sinyalleridir; resmi değerleme veya saha kontrolü yerine geçmez.",
    };
}

function selectedProviders() {
    const raw = process.env.COMPARABLE_PROVIDERS || "HEPSIEMLAK,REMAX_PUBLIC,APIFY_EMLAKJET";
    const keys = raw
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

    return keys
        .map((key) => PROVIDERS[key])
        .filter(Boolean);
}

function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

async function runProvider(provider, criteria, options) {
    const startedAt = Date.now();
    console.log("[COMPARABLES] provider start", {
        provider: provider.name,
        city: criteria.city,
        district: criteria.district,
        neighborhood: criteria.neighborhood,
        reportType: criteria.reportType,
        propertyType: criteria.propertyType,
        timeoutMs: PROVIDER_TIMEOUT_MS,
    });

    const bundle = await withTimeout(
        provider.fetch(criteria, options),
        PROVIDER_TIMEOUT_MS,
        `${provider.name}: ${PROVIDER_TIMEOUT_MS}ms timeout`
    );

    const count = Array.isArray(bundle?.comparables) ? bundle.comparables.length : 0;
    console.log("[COMPARABLES] provider finish", {
        provider: provider.name,
        count,
        elapsedMs: Date.now() - startedAt,
    });

    return {
        ...bundle,
        sourceMeta: {
            ...(bundle?.sourceMeta || {}),
            provider: bundle?.sourceMeta?.provider || provider.name,
        },
    };
}

function mergeProviderBundles(partialBundles = [], warnings = [], options = {}) {
    const allComparables = uniqueComparables(partialBundles.flatMap((bundle) => bundle.comparables || []));
    const valuationComparables = selectValuationComparables(allComparables, options);
    const portfolio = selectPortfolioGroups(allComparables, {
        subjectArea: options.subjectArea,
        subjectRoomText: options.subjectRoomText,
        subjectBuildingAge: options.subjectBuildingAge,
        propertyCategory: options.propertyCategory,
    });
    const providers = partialBundles.map((bundle) => bundle.sourceMeta?.provider).filter(Boolean);
    const cacheCount = partialBundles
        .filter((bundle) => bundle.sourceMeta?.provider === CACHE_PROVIDER)
        .reduce((sum, bundle) => sum + (Array.isArray(bundle.comparables) ? bundle.comparables.length : 0), 0);
    const providerOnlyCache = providers.length > 0 && providers.every((provider) => provider === CACHE_PROVIDER);
    const providerRecordCount = partialBundles.reduce((sum, bundle) => {
        const recordCount = toNumber(bundle?.sourceMeta?.recordCount);
        const comparableCount = Array.isArray(bundle?.comparables) ? bundle.comparables.length : 0;
        return sum + (Number.isFinite(recordCount) && recordCount > 0 ? recordCount : comparableCount);
    }, 0);

    const diagnostics = {
        ...(portfolio.diagnostics || {}),
        providerRecordCount,
    };
    const marketProjection = buildMarketProjection(portfolio.comparables, providerRecordCount || diagnostics.rawCount, diagnostics);

    return {
        comparables: portfolio.comparables,
        groups: portfolio.groups,
        marketProjection,
        regionalStats: buildRegionalStats(options.criteria, portfolio.comparables, marketProjection),
        priceBand: buildPriceBand(valuationComparables, options.subjectArea, options),
        warnings,
        sourceMeta: {
            provider: providers.length > 1 ? "MIXED" : providers[0] || "NONE",
            providers,
            fetchedAt: new Date().toISOString(),
            recordCount: providerRecordCount || diagnostics.rawCount,
            sampleCount: portfolio.comparables.length,
            confidence: "medium",
            cache: {
                hit: cacheCount > 0,
                count: cacheCount,
                fullHit: providerOnlyCache && portfolio.comparables.length >= TARGET_TOTAL,
            },
            policy: {
                targetTotal: TARGET_TOTAL,
                groups: portfolio.groups,
                diagnostics: {
                    ...diagnostics,
                    valuationCount: valuationComparables.length,
                },
            },
        },
    };
}

function hasEnoughCoverageForReport(merged) {
    const diagnostics = merged?.sourceMeta?.policy?.diagnostics || {};
    const selectedCount = toNumber(merged?.sourceMeta?.sampleCount) || merged?.comparables?.length || 0;
    const rawCount = toNumber(merged?.sourceMeta?.recordCount) || toNumber(diagnostics.rawCount) || 0;
    const valuationCount = toNumber(diagnostics.valuationCount) || 0;
    const targetWithoutStale = Math.max(1, TARGET_TOTAL - TARGET_STALE_GROUP_SIZE);

    if (selectedCount >= TARGET_TOTAL) return true;
    return selectedCount >= targetWithoutStale && rawCount >= TARGET_TOTAL && valuationCount >= 3;
}

async function runProviderPhase(providers, criteria, providerOptions, partialBundles, warnings, phase) {
    if (!providers.length) return partialBundles;

    console.log("[COMPARABLES] provider phase start", {
        phase,
        providers: providers.map((provider) => provider.name),
    });

    const settled = await Promise.allSettled(
        providers.map((provider) => runProvider(provider, criteria, providerOptions))
    );

    settled.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === "rejected") {
            const message = `${provider.name}: ${String(result.reason?.message || result.reason)}`;
            warnings.push(message);
            console.error("[COMPARABLES] provider failed", {
                provider: provider.name,
                phase,
                message,
            });
            return;
        }

        const bundle = result.value || {};
        const count = Array.isArray(bundle.comparables) ? bundle.comparables.length : 0;
        if (Array.isArray(bundle.warnings) && bundle.warnings.length) warnings.push(...bundle.warnings);

        if (!count) {
            warnings.push(`${provider.name}: emsal bulunamadı`);
            console.warn("[COMPARABLES] provider empty", { provider: provider.name, phase });
            return;
        }

        partialBundles.push(bundle);
    });

    return partialBundles;
}

async function fetchComparableBundle(criteria = {}, options = {}) {
    const warnings = [];
    const providers = selectedProviders();
    const cachedComparables = await findCachedComparables(criteria, options);
    const cacheBundle = cachedComparables.length ? cachedProviderBundle(cachedComparables) : null;

    if (cachedComparables.length >= TARGET_TOTAL) {
        const merged = mergeProviderBundles([cacheBundle], warnings, { ...options, criteria });
        if (hasEnoughCoverageForReport(merged)) {
            console.log("[COMPARABLES] cache hit full", {
                cachedCount: cachedComparables.length,
                selectedCount: merged.sourceMeta.sampleCount,
                imageCount: merged.sourceMeta.policy?.diagnostics?.imageCount,
            });
            return merged;
        }

        console.log("[COMPARABLES] cache hit partial after policy", {
            cachedCount: cachedComparables.length,
            selectedCount: merged.sourceMeta.sampleCount,
        });
    }

    console.log("[COMPARABLES] parallel search start", {
        providers: providers.map((provider) => provider.name),
        city: criteria.city,
        district: criteria.district,
        neighborhood: criteria.neighborhood,
        targetTotal: TARGET_TOTAL,
        cacheCount: cachedComparables.length,
    });

    const providerOptions = {
        ...options,
        existingComparableCount: cachedComparables.length,
        criteria,
    };

    const partialBundles = cacheBundle ? [cacheBundle] : [];
    const freeProviders = providers.filter((provider) => provider.costTier !== "paid");
    const paidProviders = providers.filter((provider) => provider.costTier === "paid");

    await runProviderPhase(freeProviders.length ? freeProviders : providers, criteria, providerOptions, partialBundles, warnings, "free");

    if (partialBundles.length) {
        const freeMerged = mergeProviderBundles(partialBundles, warnings, { ...options, criteria });
        if (freeProviders.length && hasEnoughCoverageForReport(freeMerged)) {
            console.log("[COMPARABLES] free providers enough, paid fallback skipped", {
                providers: freeMerged.sourceMeta.providers,
                rawCount: freeMerged.sourceMeta.recordCount,
                selectedCount: freeMerged.sourceMeta.sampleCount,
            });
            return freeMerged;
        }
    }

    if (freeProviders.length && paidProviders.length) {
        providerOptions.existingComparableCount = partialBundles.reduce(
            (sum, bundle) => sum + (Array.isArray(bundle.comparables) ? bundle.comparables.length : 0),
            0
        );
        await runProviderPhase(paidProviders, criteria, providerOptions, partialBundles, warnings, "paid-fallback");
    }

    if (partialBundles.length) {
        const merged = mergeProviderBundles(partialBundles, warnings, { ...options, criteria });
        console.log("[COMPARABLES] parallel search finish", {
            providers: merged.sourceMeta.providers,
            rawCount: merged.sourceMeta.recordCount,
            selectedCount: merged.sourceMeta.sampleCount,
            imageCount: merged.sourceMeta.policy?.diagnostics?.imageCount,
        });
        return merged;
    }

    return {
        comparables: [],
        groups: {},
        marketProjection: null,
        regionalStats: null,
        priceBand: null,
        sourceMeta: {
            provider: "NONE",
            fetchedAt: new Date().toISOString(),
            sampleCount: 0,
            recordCount: 0,
        },
        warnings,
    };
}

export {
    fetchComparableBundle,
    selectedProviders,
};
