import { fetchRemaxProviderBundle } from "./remaxProvider.js";
import { fetchHepsiemlakHtmlComparableBundle } from "./hepsiemlakHtmlProvider.js";
import { fetchSerpSnippetComparableBundle } from "./serpSnippetProvider.js";
import {
    PROVIDER_TIMEOUT_MS,
    TARGET_TOTAL,
    comparableUnitPrice,
    quantile,
    selectPortfolioGroups,
    toNumber,
    uniqueComparables,
} from "../comparablePolicy.js";
import {
    CACHE_PROVIDER,
    cachedProviderBundle,
    findCachedComparables,
} from "../comparableCache.js";

const PROVIDERS = {
    HEPSIEMLAK_HTML: {
        name: "HEPSIEMLAK_HTML",
        fetch: fetchHepsiemlakHtmlComparableBundle,
    },
    REMAX: {
        name: "REMAX",
        fetch: fetchRemaxProviderBundle,
    },
    SERP_SNIPPET: {
        name: "SERP_SNIPPET",
        fetch: fetchSerpSnippetComparableBundle,
    },
};

function buildPriceBand(comparables = [], subjectArea = null) {
    const area = toNumber(subjectArea);
    if (!area || area <= 0) return null;

    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const prices = comparables.map((item) => toNumber(item?.price)).filter(Number.isFinite);
    if (unitPrices.length >= 3) {
        const minPricePerSqm = Math.round(quantile(unitPrices, 0.2));
        const expectedPricePerSqm = Math.round(quantile(unitPrices, 0.5));
        const maxPricePerSqm = Math.round(quantile(unitPrices, 0.8));
        return {
            minPricePerSqm,
            expectedPricePerSqm,
            maxPricePerSqm,
            minPrice: Math.round(minPricePerSqm * area),
            expectedPrice: Math.round(expectedPricePerSqm * area),
            maxPrice: Math.round(maxPricePerSqm * area),
            confidence: Math.min(0.66, 0.38 + unitPrices.length * 0.012),
            note: `${comparables.length} otomatik emsal üzerinden hesaplanan fiyat bandıdır.`,
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
        minPricePerSqm: Math.round(minPrice / area),
        expectedPricePerSqm: Math.round(expectedPrice / area),
        maxPricePerSqm: Math.round(maxPrice / area),
        confidence: Math.min(0.58, 0.34 + prices.length * 0.01),
        note: `${comparables.length} otomatik emsal fiyat dağılımı üzerinden hesaplanan fiyat bandıdır.`,
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
        summary: `${comparables.length} otomatik emsal 6 düşük, 6 orta, 6 yüksek fiyat bandında seçildi.`,
        manualText: `${comparables.length} otomatik emsal 6 düşük, 6 orta, 6 yüksek fiyat bandında seçildi.`,
    };
}

function selectedProviders() {
    const raw = "HEPSIEMLAK_HTML,REMAX,SERP_SNIPPET";
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
    const portfolio = selectPortfolioGroups(allComparables, {
        subjectArea: options.subjectArea,
        subjectRoomText: options.subjectRoomText,
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
        priceBand: buildPriceBand(portfolio.comparables, options.subjectArea),
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
                diagnostics: portfolio.diagnostics,
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
