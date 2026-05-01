import { fetchApifyEmlakjetComparableBundle } from "./apifyEmlakjetProvider.js";
import { fetchSerpSnippetComparableBundle } from "./serpSnippetProvider.js";
import {
    PROVIDER_TIMEOUT_MS,
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
    APIFY_EMLAKJET: {
        name: "APIFY_EMLAKJET",
        fetch: fetchApifyEmlakjetComparableBundle,
    },
    SERP_SNIPPET: {
        name: "SERP_SNIPPET",
        fetch: fetchSerpSnippetComparableBundle,
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

function buildMarketProjection(comparables = [], rawCount = null) {
    return {
        averageMarketingDays: null,
        competitionStatus: comparables.length >= TARGET_TOTAL ? "Orta" : "Düşük",
        activeComparableCount: rawCount || comparables.length,
        waitingComparableCount: null,
        annualChangePct: null,
        amortizationYears: null,
        summary: `${comparables.length} otomatik emsal fiyat dağılımı ve uzun süre yayında kalma sinyaliyle seçildi.`,
        manualText: `${comparables.length} otomatik emsal fiyat dağılımı ve uzun süre yayında kalma sinyaliyle seçildi.`,
    };
}

function selectedProviders() {
    const raw = process.env.COMPARABLE_PROVIDERS || "APIFY_EMLAKJET,SERP_SNIPPET";
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

    return {
        comparables: portfolio.comparables,
        groups: portfolio.groups,
        marketProjection: buildMarketProjection(portfolio.comparables, portfolio.diagnostics.rawCount),
        regionalStats: null,
        priceBand: buildPriceBand(valuationComparables, options.subjectArea, options),
        warnings,
        sourceMeta: {
            provider: providers.length > 1 ? "MIXED" : providers[0] || "NONE",
            providers,
            fetchedAt: new Date().toISOString(),
            recordCount: portfolio.diagnostics.rawCount,
            sampleCount: portfolio.comparables.length,
            confidence: providerOnlyCache
                ? "medium"
                : providers.includes("SERP_SNIPPET") || providers.some((item) => String(item).includes("SERP"))
                  ? "low"
                  : "medium",
            cache: {
                hit: cacheCount > 0,
                count: cacheCount,
                fullHit: providerOnlyCache && portfolio.comparables.length >= TARGET_TOTAL,
            },
            policy: {
                targetTotal: TARGET_TOTAL,
                groups: portfolio.groups,
                diagnostics: {
                    ...portfolio.diagnostics,
                    valuationCount: valuationComparables.length,
                },
            },
        },
    };
}

async function fetchComparableBundle(criteria = {}, options = {}) {
    const warnings = [];
    const providers = selectedProviders();
    const cachedComparables = await findCachedComparables(criteria, options);
    const cacheBundle = cachedComparables.length ? cachedProviderBundle(cachedComparables) : null;

    if (cachedComparables.length >= TARGET_TOTAL) {
        const merged = mergeProviderBundles([cacheBundle], warnings, options);
        if (merged.comparables.length >= TARGET_TOTAL) {
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
    };

    const settled = await Promise.allSettled(
        providers.map((provider) => runProvider(provider, criteria, providerOptions))
    );

    const partialBundles = cacheBundle ? [cacheBundle] : [];
    settled.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === "rejected") {
            const message = `${provider.name}: ${String(result.reason?.message || result.reason)}`;
            warnings.push(message);
            console.error("[COMPARABLES] provider failed", {
                provider: provider.name,
                message,
            });
            return;
        }

        const bundle = result.value || {};
        const count = Array.isArray(bundle.comparables) ? bundle.comparables.length : 0;
        if (Array.isArray(bundle.warnings) && bundle.warnings.length) warnings.push(...bundle.warnings);

        if (!count) {
            warnings.push(`${provider.name}: emsal bulunamadı`);
            console.warn("[COMPARABLES] provider empty", { provider: provider.name });
            return;
        }

        partialBundles.push(bundle);
    });

    if (partialBundles.length) {
        const merged = mergeProviderBundles(partialBundles, warnings, options);
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
