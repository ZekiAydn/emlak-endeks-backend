import { searchSerpApiOrganic } from "./hepsiemlakUrlResolver.js";
import crypto from "node:crypto";
import { comparableSearchText, propertyCategory } from "../propertyCategory.js";

const ALLOWED_HOSTS = [
    "hepsiemlak.com",
    "remax.com.tr",
    "emlakjet.com",
    "sahibinden.com",
    "zingat.com",
];
const GROUP_SIZE = 6;
const MAX_OUTPUT_COMPARABLES = 24;

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
}

function propertySearchText(criteria = {}) {
    return comparableSearchText(criteria);
}

function sourceName(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        if (host.includes("hepsiemlak")) return "Hepsiemlak";
        if (host.includes("remax")) return "RE/MAX";
        if (host.includes("emlakjet")) return "Emlakjet";
        if (host.includes("sahibinden")) return "Sahibinden";
        if (host.includes("zingat")) return "Zingat";
        return host;
    } catch {
        return "Web";
    }
}

function isAllowedListingUrl(url, criteria = {}) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, "");
        if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return false;
        const text = `${parsed.pathname} ${parsed.search}`.toLocaleLowerCase("tr-TR");
        if (/(emlak-ofisi|projeler|emlak-yasam|kullanim-kosullari|gizlilik|yardim|kurumsal)/i.test(text)) return false;
        const category = propertyCategory(criteria);

        if (category === "land") {
            if (/(daire|konut|villa|residence|isyeri|işyeri|ticari\/satilik)/i.test(text) && !/(arsa|arazi|tarla|bahce|bahçe|bag|bağ|zeytinlik)/i.test(text)) {
                return false;
            }
            return /(satilik|satılık|arsa|arazi|tarla|bahce|bahçe|bag|bağ|zeytinlik|ilan|portfoy)/i.test(text);
        }

        if (category === "commercial") {
            if (/(daire|konut|villa|residence|arsa|arazi|tarla)/i.test(text) && !/(isyeri|işyeri|ticari|ofis|dukkan|dükkan|magaza|mağaza|depo|fabrika|plaza|otel|atolye|imalathane)/i.test(text)) {
                return false;
            }
            return /(satilik|satılık|isyeri|işyeri|ticari|ofis|dukkan|dükkan|magaza|mağaza|depo|fabrika|plaza|otel|atolye|imalathane|ilan|portfoy)/i.test(text);
        }

        if (/(arsa|arazi|tarla|isyeri|işyeri|ticari|ofis|dukkan|dükkan|magaza|mağaza|depo|fabrika)/i.test(text) && !/(daire|konut|villa|residence)/i.test(text)) {
            return false;
        }
        return /(satilik|satılık|daire|villa|residence|konut|portfoy|ilan)/i.test(text);
    } catch {
        return false;
    }
}

function parsePrice(text) {
    const source = cleanText(text);
    const millionMatch = source.match(/(\d+(?:[.,]\d+)?)\s*(?:milyon|mn)\s*(?:tl|₺)?/i);
    if (millionMatch) {
        const value = Number(millionMatch[1].replace(",", "."));
        if (Number.isFinite(value)) return Math.round(value * 1_000_000);
    }

    const matches = [...source.matchAll(/(?:₺\s*)?(\d[\d.]*(?:,\d{2})?)\s*(?:tl|₺)/gi)];
    const values = matches
        .map((match) => Number(match[1].replace(/\./g, "").replace(",", ".")))
        .filter((value) => Number.isFinite(value) && value >= 250000);

    return values[0] || null;
}

function parseArea(text) {
    const source = cleanText(text);
    const gross = source.match(/brüt\s*(\d{2,4})\s*(?:m2|m²|metrekare)/i);
    if (gross) return Number(gross[1]);

    const net = source.match(/net\s*(\d{2,4})\s*(?:m2|m²|metrekare)/i);
    if (net) return Number(net[1]);

    const generic = source.match(/(\d{2,4})\s*(?:m2|m²|metrekare)/i);
    return generic ? Number(generic[1]) : null;
}

function parseRoomText(text) {
    const match = cleanText(text).match(/(\d+(?:[.,]5)?\s*\+\s*\d+)/);
    return match ? match[1].replace(/\s+/g, "").replace(",", ".") : null;
}

function parseListingAgeDays(item) {
    const dateText = cleanText(item?.date || "");
    if (!dateText) return null;

    const dayMatch = dateText.match(/(\d+)\s*gün/i);
    if (dayMatch) return Number(dayMatch[1]);

    const monthMatch = dateText.match(/(\d+)\s*ay/i);
    if (monthMatch) return Number(monthMatch[1]) * 30;

    return null;
}

function comparableUnitPrice(item) {
    const price = toNumber(item?.price);
    const area = toNumber(item?.netArea) || toNumber(item?.grossArea);
    if (!Number.isFinite(price) || !Number.isFinite(area) || area <= 0) return null;
    return Math.round(price / area);
}

function normalizeSerpComparable(item, criteria, index) {
    const link = cleanText(item?.link || item?.redirect_link || "");
    if (!isAllowedListingUrl(link, criteria)) return null;

    const title = cleanText(item?.title);
    const snippet = cleanText([
        item?.snippet,
        item?.rich_snippet?.top?.extensions?.join(" "),
        item?.rich_snippet?.bottom?.extensions?.join(" "),
    ].filter(Boolean).join(" "));
    const text = `${title} ${snippet}`;
    const price = parsePrice(text);
    if (!Number.isFinite(price) || price < 250000) return null;

    const grossArea = parseArea(text);
    const roomText = parseRoomText(text);
    const pricePerSqm = grossArea ? Math.round(price / grossArea) : null;

    return {
        title: title || `${criteria.district || criteria.city || "Bölge"} satılık ${propertySearchText(criteria)}`,
        source: sourceName(link),
        sourceUrl: link,
        price,
        netArea: null,
        grossArea,
        roomText,
        buildingAge: null,
        floor: null,
        floorText: null,
        totalFloors: null,
        distanceMeters: null,
        listingAgeDays: parseListingAgeDays(item),
        imageUrl: item?.thumbnail || null,
        address: [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean).join(" / ") || null,
        externalId: `serp:${crypto.createHash("sha1").update(link).digest("hex").slice(0, 16)}`,
        createdAt: new Date().toISOString(),
        pricePerSqm,
        provider: "SERP_SNIPPET",
        latitude: null,
        longitude: null,
        snippet,
    };
}

function uniqueComparables(items) {
    const seen = new Set();
    const result = [];

    for (const item of items) {
        const key = item.sourceUrl || `${item.title}:${item.price}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }

    return result;
}

function buildQueries(criteria = {}) {
    const location = [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean).join(" ");
    const type = propertySearchText(criteria);
    const base = `${location} satılık ${type}`.trim();
    const category = propertyCategory(criteria);
    const categoryTerms =
        category === "land"
            ? ["site:sahibinden.com/arsa", "site:hepsiemlak.com arsa", "site:remax.com.tr arsa-arazi", "site:emlakjet.com satılık arsa"]
            : category === "commercial"
              ? ["site:sahibinden.com/isyeri", "site:hepsiemlak.com işyeri", "site:remax.com.tr ticari", "site:emlakjet.com satılık işyeri"]
              : ["site:sahibinden.com", "site:hepsiemlak.com", "site:remax.com.tr", "site:emlakjet.com"];

    return [
        `${base} fiyat`,
        ...categoryTerms.map((term) => `${term} ${base}`),
    ].filter(Boolean);
}

function roomMatches(itemRoom, targetRoom) {
    const current = String(itemRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    const target = String(targetRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    if (!target || !current) return false;
    return current === target;
}

function preferTargetRoom(comparables, subjectRoomText) {
    const target = String(subjectRoomText || "").trim();
    if (!target) return comparables;

    const exact = comparables.filter((item) => roomMatches(item.roomText, target));
    if (exact.length >= 8) return exact;

    const withoutStudio = comparables.filter((item) => !/stüdyo|studio|1\+0/i.test(String(item.roomText || "")));
    if (/^[2-9]\+/.test(target) && withoutStudio.length >= 8) return withoutStudio;

    return comparables;
}

function chooseMidComparables(sortedItems, count, excludedKeys) {
    const candidates = sortedItems.filter((item) => !excludedKeys.has(item.externalId || item.sourceUrl));
    if (!candidates.length) return [];
    const start = Math.max(0, Math.floor(candidates.length / 2) - Math.floor(count / 2));
    return candidates.slice(start, start + count);
}

function buildGroups(comparables) {
    const priced = comparables
        .filter((item) => Number.isFinite(toNumber(item.price)))
        .slice()
        .sort((a, b) => toNumber(a.price) - toNumber(b.price));

    const low = priced.slice(0, GROUP_SIZE);
    const high = priced.length <= GROUP_SIZE ? [] : priced.slice(Math.max(GROUP_SIZE, priced.length - GROUP_SIZE));
    const used = new Set([...low, ...high].map((item) => item.externalId || item.sourceUrl).filter(Boolean));
    const mid = chooseMidComparables(priced, GROUP_SIZE, used);
    const stale = comparables
        .filter((item) => Number.isFinite(toNumber(item?.listingAgeDays)))
        .slice()
        .sort((a, b) => toNumber(b.listingAgeDays) - toNumber(a.listingAgeDays))
        .slice(0, GROUP_SIZE);

    return {
        low: low.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        mid: mid.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        high: high.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        stale: stale.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
    };
}

function enrichComparablesWithGroups(comparables, groups) {
    const tagged = new Map();
    Object.entries(groups || {}).forEach(([group, ids]) => {
        (ids || []).forEach((id) => tagged.set(id, group));
    });

    return comparables.map((item) => ({
        ...item,
        group: tagged.get(item.externalId || item.sourceUrl) || item.group || null,
    }));
}

function orderComparablesForOutput(comparables, groups) {
    const byKey = new Map(
        comparables
            .map((item) => [item.externalId || item.sourceUrl, item])
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
        const key = item.externalId || item.sourceUrl;
        return key ? !used.has(key) : true;
    });

    return [...ordered, ...remainder].slice(0, MAX_OUTPUT_COMPARABLES);
}

function quantile(values, ratio) {
    const list = values.map(toNumber).filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return null;
    const pos = (list.length - 1) * ratio;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return list[lower];
    const weight = pos - lower;
    return list[lower] * (1 - weight) + list[upper] * weight;
}

function buildPriceBand(comparables, subjectArea) {
    const area = toNumber(subjectArea);
    if (!Number.isFinite(area) || area <= 0) return null;

    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const prices = comparables.map((item) => toNumber(item.price)).filter(Number.isFinite);
    const enoughUnitPrices = unitPrices.length >= 3;
    const enoughPrices = prices.length >= 3;

    if (!enoughUnitPrices && !enoughPrices) return null;

    if (!enoughUnitPrices) {
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
            confidence: Math.min(0.52, 0.32 + prices.length * 0.012),
            note: `${comparables.length} arama sonucu özetindeki fiyat dağılımı ve ${Math.round(area)} m² konu alanı üzerinden hesaplanan düşük güvenli fiyat bandıdır.`,
        };
    }

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
        confidence: Math.min(0.58, 0.36 + unitPrices.length * 0.015),
        note: `${comparables.length} arama sonucu özetinden çıkarılan düşük güvenli fiyat bandıdır.`,
    };
}

function buildMarketProjection(comparables) {
    const ages = comparables.map((item) => toNumber(item.listingAgeDays)).filter(Number.isFinite);
    const averageMarketingDays = ages.length
        ? Math.round(ages.reduce((sum, value) => sum + value, 0) / ages.length)
        : null;

    const summaryParts = [`Arama sonucu özetlerinden ${comparables.length} fiyatlı emsal çıkarıldı.`];
    if (Number.isFinite(averageMarketingDays)) {
        summaryParts.push(`Sonuçlarda görünen tarih bilgilerine göre ortalama ilan yaşı yaklaşık ${averageMarketingDays} gün.`);
    }

    return {
        averageMarketingDays,
        competitionStatus: comparables.length >= 12 ? "Orta" : "Düşük",
        activeComparableCount: comparables.length,
        waitingComparableCount: ages.filter((value) => value >= 90).length,
        annualChangePct: null,
        amortizationYears: null,
        summary: summaryParts.join(" "),
        manualText: summaryParts.join(" "),
    };
}

function buildRegionalStats(criteria, comparables, parcelLookup, marketProjection, subjectArea = null) {
    const prices = comparables.map((item) => toNumber(item.price)).filter(Number.isFinite);
    const area = toNumber(subjectArea);
    const directUnitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const unitPrices = directUnitPrices.length >= 3 || !Number.isFinite(area) || area <= 0
        ? directUnitPrices
        : prices.map((price) => Math.round(price / area));
    const locationLabel = [criteria.neighborhood, criteria.district, criteria.city].filter(Boolean).join(" / ");

    return {
        demographicsSummary: locationLabel ? `${locationLabel} çevresinde arama sonucu özetleri üzerinden düşük güvenli ön değerlendirme yapıldı.` : null,
        saleMarketSummary: prices.length
            ? `Bulunan özetlerde fiyat bandı ${Math.min(...prices).toLocaleString("tr-TR")} TL ile ${Math.max(...prices).toLocaleString("tr-TR")} TL arasında.${unitPrices.length ? ` Birim fiyatlar ${Math.min(...unitPrices).toLocaleString("tr-TR")} - ${Math.max(...unitPrices).toLocaleString("tr-TR")} TL/m² bandında.` : ""}`
            : null,
        rentalMarketSummary: marketProjection?.summary || null,
        nearbyPlacesSummary: parcelLookup?.properties?.summary ? `Parsel doğrulaması ${parcelLookup.properties.summary} bilgisiyle desteklendi.` : null,
        riskSummary: "Bu emsaller ilan sayfası okunarak değil arama sonucu özetlerinden çıkarıldığı için manuel kontrol önerilir.",
    };
}

async function fetchSerpSnippetComparableBundle(criteria = {}, options = {}) {
    if (!process.env.SERPAPI_KEY) {
        return {
            comparables: [],
            groups: {},
            marketProjection: null,
            regionalStats: null,
            priceBand: null,
            sourceMeta: {
                provider: "SERP_SNIPPET",
                fetchedAt: new Date().toISOString(),
                sampleCount: 0,
                recordCount: 0,
                serpUsed: false,
            },
            warnings: ["SERP_SNIPPET: SERPAPI_KEY tanımlı değil"],
        };
    }

    const maxQueries = Math.max(1, Math.min(Number(process.env.SERP_SNIPPET_MAX_QUERIES || 4), 5));
    const maxResults = Math.max(5, Math.min(Number(process.env.SERP_SNIPPET_MAX_RESULTS || process.env.SERPAPI_MAX_RESULTS || 10), 20));
    const queries = buildQueries(criteria).slice(0, maxQueries);
    const warnings = [];
    const organicItems = [];

    for (const query of queries) {
        try {
            const results = await searchSerpApiOrganic(query, { maxResults });
            organicItems.push(...results);
        } catch (error) {
            warnings.push(`SERP_SNIPPET: ${String(error.message || error)}`);
        }
    }

    const category = propertyCategory(criteria);
    const unique = uniqueComparables(
        organicItems
            .map((item, index) => normalizeSerpComparable(item, criteria, index))
            .filter(Boolean)
    );
    const candidateComparables = category === "residential" ? preferTargetRoom(unique, options.subjectRoomText) : unique;

    if (candidateComparables.length < 12) {
        warnings.push(`SERP_SNIPPET: 12 emsal için yeterli fiyatlı sonuç bulunamadı (${candidateComparables.length})`);
    }

    const groups = buildGroups(candidateComparables);
    const comparables = orderComparablesForOutput(candidateComparables, groups);
    const enriched = enrichComparablesWithGroups(comparables, groups);
    const marketProjection = comparables.length ? buildMarketProjection(enriched) : null;
    const regionalStats = comparables.length ? buildRegionalStats(criteria, enriched, options.parcelLookup, marketProjection, options.subjectArea) : null;
    const priceBand = comparables.length ? buildPriceBand(enriched, options.subjectArea) : null;

    return {
        comparables: enriched,
        groups,
        marketProjection,
        regionalStats,
        priceBand,
        sourceMeta: {
            provider: "SERP_SNIPPET",
            fetchedAt: new Date().toISOString(),
            scope: criteria.neighborhood ? "neighborhood" : criteria.district ? "district" : "city",
            recordCount: organicItems.length,
            sampleCount: enriched.length,
            serpUsed: true,
            confidence: "low",
            searchQueries: queries,
        },
        warnings,
    };
}

export {
    fetchSerpSnippetComparableBundle,
    buildQueries as buildSerpSnippetQueries,
    normalizeSerpComparable,
};
