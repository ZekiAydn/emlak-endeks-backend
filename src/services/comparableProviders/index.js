import { fetchRemaxProviderBundle } from "./remaxProvider.js";
import { fetchHepsiemlakHtmlComparableBundle } from "./hepsiemlakHtmlProvider.js";
import { fetchSerpSnippetComparableBundle } from "./serpSnippetProvider.js";

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

const MIN_COMPLETE_COMPARABLES = 12;

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function comparableKey(item) {
    return item?.externalId || item?.sourceUrl || `${item?.title || ""}:${item?.price || ""}`;
}

function uniqueComparables(items = []) {
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const key = comparableKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }

    return out;
}

function chooseMidComparables(sortedItems, count, excludedKeys) {
    const candidates = sortedItems.filter((item) => !excludedKeys.has(comparableKey(item)));
    if (!candidates.length) return [];
    const start = Math.max(0, Math.floor(candidates.length / 2) - Math.floor(count / 2));
    return candidates.slice(start, start + count);
}

function buildGroups(comparables = []) {
    const priced = comparables
        .filter((item) => Number.isFinite(toNumber(item?.price)))
        .slice()
        .sort((a, b) => toNumber(a.price) - toNumber(b.price));

    const low = priced.slice(0, 4);
    const high = priced.length <= 4 ? [] : priced.slice(Math.max(4, priced.length - 4));
    const used = new Set([...low, ...high].map(comparableKey).filter(Boolean));
    const mid = chooseMidComparables(priced, 4, used);

    return {
        low: low.map(comparableKey).filter(Boolean),
        mid: mid.map(comparableKey).filter(Boolean),
        high: high.map(comparableKey).filter(Boolean),
    };
}

function tagGroups(comparables = [], groups = {}) {
    const tagged = new Map();
    Object.entries(groups || {}).forEach(([group, ids]) => {
        (ids || []).forEach((id) => tagged.set(id, group));
    });

    return comparables.map((item) => ({
        ...item,
        group: tagged.get(comparableKey(item)) || item.group || null,
    }));
}

function comparableUnitPrice(item) {
    const direct = toNumber(item?.pricePerSqm);
    if (direct && direct > 0) return direct;
    const price = toNumber(item?.price);
    const area = toNumber(item?.netArea) || toNumber(item?.grossArea);
    if (!price || !area || area <= 0) return null;
    return Math.round(price / area);
}

function quantile(values, ratio) {
    const list = values.map(toNumber).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;
    const pos = (list.length - 1) * ratio;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return list[lower];
    return list[lower] * (1 - (pos - lower)) + list[upper] * (pos - lower);
}

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
            confidence: Math.min(0.62, 0.36 + unitPrices.length * 0.012),
            note: `${comparables.length} karma emsal üzerinden hesaplanan fiyat bandıdır.`,
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
        confidence: Math.min(0.56, 0.32 + prices.length * 0.01),
        note: `${comparables.length} karma emsal fiyat dağılımı üzerinden hesaplanan fiyat bandıdır.`,
    };
}

function buildMarketProjection(comparables = []) {
    const ages = comparables.map((item) => toNumber(item?.listingAgeDays)).filter(Number.isFinite);
    const averageMarketingDays = ages.length
        ? Math.round(ages.reduce((sum, value) => sum + value, 0) / ages.length)
        : null;

    return {
        averageMarketingDays,
        competitionStatus: comparables.length >= 12 ? "Orta" : "Düşük",
        activeComparableCount: comparables.length,
        waitingComparableCount: ages.filter((value) => value >= 90).length,
        annualChangePct: null,
        amortizationYears: null,
        summary: `${comparables.length} karma otomatik emsal kaynağından fiyatlı ilan çıkarıldı.`,
        manualText: `${comparables.length} karma otomatik emsal kaynağından fiyatlı ilan çıkarıldı.`,
    };
}

function mergePartialBundles(partialBundles = [], warnings = [], options = {}) {
    const comparables = uniqueComparables(partialBundles.flatMap((bundle) => bundle.comparables || [])).slice(0, 24);
    const groups = buildGroups(comparables);
    const tagged = tagGroups(comparables, groups);
    const providers = partialBundles.map((bundle) => bundle.sourceMeta?.provider).filter(Boolean);

    return {
        comparables: tagged,
        groups,
        marketProjection: buildMarketProjection(tagged),
        regionalStats: null,
        priceBand: buildPriceBand(tagged, options.subjectArea),
        warnings,
        sourceMeta: {
            provider: providers.length > 1 ? "MIXED" : providers[0] || "MIXED",
            providers,
            fetchedAt: new Date().toISOString(),
            recordCount: tagged.length,
            sampleCount: tagged.length,
            confidence: providers.includes("SERP_SNIPPET") ? "low" : "medium",
        },
    };
}

function selectedProviders() {
    const raw = process.env.COMPARABLE_PROVIDERS || "HEPSIEMLAK_HTML,REMAX,SERP_SNIPPET";
    const keys = raw
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

    if (
        process.env.COMPARABLE_SERP_SNIPPET_FALLBACK_ENABLED !== "false" &&
        !keys.includes("SERP_SNIPPET")
    ) {
        keys.push("SERP_SNIPPET");
    }

    return keys
        .map((key) => PROVIDERS[key])
        .filter(Boolean);
}

async function fetchComparableBundle(criteria = {}, options = {}) {
    const warnings = [];
    const providers = selectedProviders();
    const partialBundles = [];

    for (const provider of providers) {
        try {
            console.log("[COMPARABLES] provider start", {
                provider: provider.name,
                city: criteria.city,
                district: criteria.district,
                neighborhood: criteria.neighborhood,
                reportType: criteria.reportType,
                propertyType: criteria.propertyType,
            });

            const bundle = await provider.fetch(criteria, options);
            const count = Array.isArray(bundle?.comparables) ? bundle.comparables.length : 0;
            if (Array.isArray(bundle?.warnings) && bundle.warnings.length) {
                warnings.push(...bundle.warnings);
            }

            if (count > 0) {
                console.log("[COMPARABLES] provider success", {
                    provider: provider.name,
                    count,
                });

                const normalizedBundle = {
                    ...bundle,
                    warnings,
                    sourceMeta: {
                        ...(bundle.sourceMeta || {}),
                        provider: bundle.sourceMeta?.provider || provider.name,
                    },
                };

                if (count >= MIN_COMPLETE_COMPARABLES && !partialBundles.length) {
                    return normalizedBundle;
                }

                partialBundles.push(normalizedBundle);
                if (uniqueComparables(partialBundles.flatMap((partial) => partial.comparables || [])).length >= MIN_COMPLETE_COMPARABLES) {
                    return mergePartialBundles(partialBundles, warnings, options);
                }

                warnings.push(`${provider.name}: ${MIN_COMPLETE_COMPARABLES} emsal için kısmi sonuç bulundu (${count}), diğer kaynaklarla tamamlanıyor.`);
                continue;
            }

            const message = `${provider.name}: emsal bulunamadı`;
            warnings.push(message);

            console.warn("[COMPARABLES] provider empty", {
                provider: provider.name,
                count,
            });
        } catch (error) {
            const message = `${provider.name}: ${String(error.message || error)}`;
            warnings.push(message);

            console.error("[COMPARABLES] provider failed", {
                provider: provider.name,
                message: String(error.message || error),
            });
        }
    }

    if (partialBundles.length) {
        return mergePartialBundles(partialBundles, warnings, options);
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
