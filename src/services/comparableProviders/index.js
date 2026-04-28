import { fetchRemaxProviderBundle } from "./remaxProvider.js";
import { fetchHepsiemlakHtmlComparableBundle } from "./hepsiemlakHtmlProvider.js";
import { fetchSerpSnippetComparableBundle } from "./serpSnippetProvider.js";
import { fetchEmlakjetHtmlComparableBundle } from "./emlakjetHtmlProvider.js";
import { fetchSahibindenHtmlComparableBundle } from "./sahibindenHtmlProvider.js";

const PROVIDERS = {
    EMLAKJET_HTML: {
        name: "EMLAKJET_HTML",
        fetch: fetchEmlakjetHtmlComparableBundle,
    },
    HEPSIEMLAK_HTML: {
        name: "HEPSIEMLAK_HTML",
        fetch: fetchHepsiemlakHtmlComparableBundle,
    },
    SAHIBINDEN_HTML: {
        name: "SAHIBINDEN_HTML",
        fetch: fetchSahibindenHtmlComparableBundle,
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
const GROUP_SIZE = 6;
const MAX_OUTPUT_COMPARABLES = 24;
const DEFAULT_COMPARABLE_PROVIDERS = "SAHIBINDEN_HTML,HEPSIEMLAK_HTML,REMAX,EMLAKJET_HTML,SERP_SNIPPET";

function providerEnabled(key) {
    if (process.env.ENABLE_LIVE_SCRAPING === "false" && key !== "SERP_SNIPPET") return false;
    if (key === "SAHIBINDEN_HTML" && process.env.ENABLE_SAHIBINDEN_HTML === "false") return false;
    if (key === "EMLAKJET_HTML") return process.env.COMPARABLE_EMLAKJET_HTML_ENABLED !== "false";
    if (key === "HEPSIEMLAK_HTML") return process.env.COMPARABLE_HEPSIEMLAK_HTML_ENABLED !== "false";
    if (key === "SAHIBINDEN_HTML") return process.env.COMPARABLE_SAHIBINDEN_HTML_ENABLED !== "false";
    if (key === "REMAX") return process.env.COMPARABLE_REMAX_ENABLED !== "false";
    return true;
}

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

function orderComparablesForOutput(comparables = [], groups = {}) {
    const byKey = new Map(
        comparables
            .map((item) => [comparableKey(item), item])
            .filter(([key]) => !!key)
    );
    const ordered = [];
    const used = new Set();

    ["low", "mid", "high", "stale"].forEach((group) => {
        (groups?.[group] || []).forEach((key) => {
            const item = byKey.get(key);
            if (!item || used.has(key)) return;
            ordered.push(item);
            used.add(key);
        });
    });

    const remainder = comparables.filter((item) => {
        const key = comparableKey(item);
        return key ? !used.has(key) : true;
    });

    return [...ordered, ...remainder].slice(0, MAX_OUTPUT_COMPARABLES);
}

function buildGroups(comparables = []) {
    const priced = comparables
        .filter((item) => Number.isFinite(toNumber(item?.price)))
        .slice()
        .sort((a, b) => toNumber(a.price) - toNumber(b.price));

    const low = priced.slice(0, GROUP_SIZE);
    const high = priced.length <= GROUP_SIZE ? [] : priced.slice(Math.max(GROUP_SIZE, priced.length - GROUP_SIZE));
    const used = new Set([...low, ...high].map(comparableKey).filter(Boolean));
    const mid = chooseMidComparables(priced, GROUP_SIZE, used);
    const stale = comparables
        .filter((item) => Number.isFinite(toNumber(item?.listingAgeDays)))
        .slice()
        .sort((a, b) => toNumber(b.listingAgeDays) - toNumber(a.listingAgeDays))
        .slice(0, GROUP_SIZE);

    return {
        low: low.map(comparableKey).filter(Boolean),
        mid: mid.map(comparableKey).filter(Boolean),
        high: high.map(comparableKey).filter(Boolean),
        stale: stale.map(comparableKey).filter(Boolean),
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
    const pool = uniqueComparables(partialBundles.flatMap((bundle) => bundle.comparables || []));
    const groups = buildGroups(pool);
    const comparables = orderComparablesForOutput(pool, groups);
    const tagged = tagGroups(comparables, groups);
    const providers = partialBundles.map((bundle) => bundle.sourceMeta?.provider).filter(Boolean);
    const providerDetails = partialBundles.map((bundle) => ({
        provider: bundle.sourceMeta?.provider || "UNKNOWN",
        recordCount: bundle.sourceMeta?.recordCount ?? null,
        sampleCount: Array.isArray(bundle.comparables) ? bundle.comparables.length : bundle.sourceMeta?.sampleCount ?? null,
        scope: bundle.sourceMeta?.scope || null,
        searchUrls: bundle.sourceMeta?.searchUrls || null,
        searchQueries: bundle.sourceMeta?.searchQueries || null,
    }));
    const recordCount = partialBundles.reduce((sum, bundle) => {
        const count = toNumber(bundle.sourceMeta?.recordCount);
        return sum + (Number.isFinite(count) ? count : Array.isArray(bundle.comparables) ? bundle.comparables.length : 0);
    }, 0);

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
            providerDetails,
            fetchedAt: new Date().toISOString(),
            recordCount,
            sampleCount: tagged.length,
            confidence: providers.includes("SERP_SNIPPET") ? "low" : "medium",
        },
    };
}

function rebuildComparableBundleFromComparables(bundle = {}, comparables = [], options = {}) {
    const unique = uniqueComparables(comparables).slice(0, MAX_OUTPUT_COMPARABLES);
    const groups = buildGroups(unique);
    const tagged = tagGroups(unique, groups);

    return {
        ...bundle,
        comparables: tagged,
        groups,
        marketProjection: tagged.length ? buildMarketProjection(tagged) : null,
        priceBand: tagged.length ? buildPriceBand(tagged, options.subjectArea) : null,
        sourceMeta: {
            ...(bundle.sourceMeta || {}),
            recordCount: bundle.sourceMeta?.recordCount ?? tagged.length,
            sampleCount: tagged.length,
        },
    };
}

function selectedProviders() {
    const raw = process.env.COMPARABLE_PROVIDERS || DEFAULT_COMPARABLE_PROVIDERS;
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

    const enabledKeys = keys.filter(providerEnabled);
    const finalKeys = enabledKeys.length ? enabledKeys : ["SERP_SNIPPET"];

    return finalKeys
        .map((key) => PROVIDERS[key])
        .filter(Boolean);
}

async function fetchComparableBundle(criteria = {}, options = {}) {
    const warnings = [];
    const providers = selectedProviders();
    const partialBundles = [];
    const stopAfterComplete = process.env.COMPARABLE_STOP_AFTER_COMPLETE === "true";

    console.log("[COMPARABLES] provider plan", {
        providers: providers.map((provider) => provider.name),
        stopAfterComplete,
        minCompleteComparables: MIN_COMPLETE_COMPARABLES,
        maxOutputComparables: MAX_OUTPUT_COMPARABLES,
        city: criteria.city,
        district: criteria.district,
        neighborhood: criteria.neighborhood,
        propertyType: criteria.propertyType,
        subjectRoomText: options.subjectRoomText || null,
        subjectArea: options.subjectArea || null,
        searchText: criteria.searchText || null,
    });

    for (const [index, provider] of providers.entries()) {
        try {
            const hasMoreProviders = index < providers.length - 1;

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

                if (stopAfterComplete && count >= MIN_COMPLETE_COMPARABLES && !partialBundles.length) {
                    return normalizedBundle;
                }

                partialBundles.push(normalizedBundle);
                if (
                    stopAfterComplete &&
                    uniqueComparables(partialBundles.flatMap((partial) => partial.comparables || [])).length >= MIN_COMPLETE_COMPARABLES
                ) {
                    return mergePartialBundles(partialBundles, warnings, options);
                }

                if (hasMoreProviders && count < MIN_COMPLETE_COMPARABLES) {
                    warnings.push(`${provider.name}: ${MIN_COMPLETE_COMPARABLES} emsal için kısmi sonuç bulundu (${count}), diğer kaynaklarla tamamlanıyor.`);
                }
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
    rebuildComparableBundleFromComparables,
    selectedProviders,
};
