import { searchSerpApiOrganic } from "./hepsiemlakUrlResolver.js";
import crypto from "node:crypto";
import { comparableSearchText, normalizePropertyText, propertyCategory, valuationType } from "../propertyCategory.js";
import { TARGET_TOTAL } from "../comparablePolicy.js";

const ALLOWED_HOSTS = [
    "hepsiemlak.com",
    "remax.com.tr",
    "emlakjet.com",
    "sahibinden.com",
    "zingat.com",
];
const GROUP_SIZE = 6;
const MAX_OUTPUT_COMPARABLES = 24;
const SERP_PAGE_SIZE = 10;
const SERP_MAX_PAGES = 2;

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function compactText(value) {
    return normalizePropertyText(value).replace(/\s+/g, "");
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
            return /(satilik|satılık|kiralik|kiralık|arsa|arazi|tarla|bahce|bahçe|bag|bağ|zeytinlik|ilan|portfoy)/i.test(text);
        }

        if (category === "commercial") {
            if (/(daire|konut|villa|residence|arsa|arazi|tarla)/i.test(text) && !/(isyeri|işyeri|ticari|ofis|dukkan|dükkan|magaza|mağaza|depo|fabrika|plaza|otel|atolye|imalathane)/i.test(text)) {
                return false;
            }
            return /(satilik|satılık|kiralik|kiralık|isyeri|işyeri|ticari|ofis|dukkan|dükkan|magaza|mağaza|depo|fabrika|plaza|otel|atolye|imalathane|ilan|portfoy)/i.test(text);
        }

        if (/(arsa|arazi|tarla|isyeri|işyeri|ticari|ofis|dukkan|dükkan|magaza|mağaza|depo|fabrika)/i.test(text) && !/(daire|konut|villa|residence)/i.test(text)) {
            return false;
        }
        return /(satilik|satılık|kiralik|kiralık|daire|villa|residence|konut|portfoy|ilan)/i.test(text);
    } catch {
        return false;
    }
}

function isLikelyAggregateUrl(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, "");
        const path = decodeURIComponent(parsed.pathname).toLocaleLowerCase("tr-TR");

        if (host.includes("emlakjet")) return !path.includes("/ilan/");
        if (host.includes("remax")) return !path.includes("/portfoy/");

        if (host.includes("sahibinden")) {
            if (/\/(?:satilik|satılık|kiralik|kiralık)-/.test(path)) return true;
            if (/\/emlak-(?:konut|arsa|isyeri|işyeri)/.test(path)) return true;
            return !/\d{7,}/.test(path);
        }

        return false;
    } catch {
        return true;
    }
}

function isLikelyAggregateText(title, snippet) {
    const text = normalizePropertyText(`${title} ${snippet}`);
    return (
        /\bfiyatlari\b/.test(text) ||
        /\bilanlari\b/.test(text) ||
        /\ben ucuz\b/.test(text) ||
        /\bbaslayan\b/.test(text) ||
        /\barasindan\b/.test(text) ||
        /\badet\b.*\bilan\b/.test(text) ||
        /\bfavori ikonu\b/.test(text)
    );
}

function matchesTargetNeighborhood(link, title, snippet, criteria = {}) {
    const target = normalizePropertyText(criteria.neighborhood)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "")
        .trim();
    if (!target) return true;

    const haystack = normalizePropertyText(`${link} ${title} ${snippet}`)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "");

    return haystack.includes(target) || compactText(haystack).includes(compactText(target));
}

function roomParts(roomText) {
    const match = String(roomText || "").replace(/\s+/g, "").match(/^(\d+)\+(\d+)$/);
    if (!match) return null;
    return { bedrooms: Number(match[1]), livingRooms: Number(match[2]) };
}

function roomCompatible(itemRoom, targetRoom) {
    const currentText = String(itemRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    const targetText = String(targetRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    if (!targetText || !currentText) return true;
    if (currentText === targetText) return true;
    if (/stüdyo|studio|1\+0/.test(currentText)) return false;

    const current = roomParts(currentText);
    const target = roomParts(targetText);
    if (!current || !target) return true;
    if (target.bedrooms >= 2 && current.bedrooms <= 1) return false;
    if (Math.abs(current.bedrooms - target.bedrooms) > 1) return false;
    if (current.livingRooms !== target.livingRooms) return false;

    return true;
}

function parsePrice(text) {
    const source = cleanText(text);
    const millionMatch = source.match(/(\d+(?:[.,]\d+)?)\s*(?:milyon|mn)\s*(?:tl|₺)?/i);
    if (millionMatch && !/en ucuz|başlayan|baslayan/i.test(source.slice(Math.max(0, millionMatch.index - 30), millionMatch.index + millionMatch[0].length + 30))) {
        const value = Number(millionMatch[1].replace(",", "."));
        if (Number.isFinite(value)) return Math.round(value * 1_000_000);
    }

    const matches = [...source.matchAll(/(?:₺\s*)?(\d[\d.]*(?:,\d{2})?)\s*(?:tl|₺)/gi)];
    const values = matches
        .filter((match) => {
            const context = source.slice(Math.max(0, match.index - 35), match.index + match[0].length + 35);
            return !/en ucuz|başlayan|baslayan|den başlayan|den baslayan|seçeneklerle|seceneklerle/i.test(context);
        })
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

function comparableUnitPrice(item) {
    const price = toNumber(item?.price);
    const area = toNumber(item?.netArea) || toNumber(item?.grossArea);
    if (!Number.isFinite(price) || !Number.isFinite(area) || area <= 0) return null;
    return Math.round(price / area);
}

function normalizeSerpComparable(item, criteria, index, options = {}) {
    const link = cleanText(item?.link || item?.redirect_link || "");
    if (!isAllowedListingUrl(link, criteria)) return null;

    const title = cleanText(item?.title);
    const snippet = cleanText([
        item?.snippet,
        item?.rich_snippet?.top?.extensions?.join(" "),
        item?.rich_snippet?.bottom?.extensions?.join(" "),
    ].filter(Boolean).join(" "));
    if (isLikelyAggregateUrl(link) || isLikelyAggregateText(title, snippet)) return null;
    if (!matchesTargetNeighborhood(link, title, snippet, criteria)) return null;

    const text = `${title} ${snippet}`;
    const price = parsePrice(text);
    if (!Number.isFinite(price) || price < 250000) return null;

    const grossArea = parseArea(text);
    const roomText = parseRoomText(text);
    if (!roomCompatible(roomText, options.subjectRoomText)) return null;

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

function buildQueries(criteria = {}, options = {}) {
    const location = [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean).join(" ");
    const transaction = valuationType(criteria) === "rental" ? "kiralık" : "satılık";
    const type = propertySearchText(criteria);
    const room = propertyCategory(criteria) === "residential" && options.subjectRoomText
        ? String(options.subjectRoomText).trim()
        : "";
    const base = `${location} ${transaction} ${room} ${type}`.trim();
    const category = propertyCategory(criteria);
    const categoryTerms =
        category === "land"
            ? ["site:sahibinden.com/arsa", "site:hepsiemlak.com arsa", "site:remax.com.tr arsa-arazi", "site:emlakjet.com satılık arsa"]
            : category === "commercial"
              ? ["site:sahibinden.com/isyeri", "site:hepsiemlak.com işyeri", "site:remax.com.tr ticari", "site:emlakjet.com satılık işyeri"]
              : ["site:sahibinden.com", "site:hepsiemlak.com", "site:remax.com.tr", "site:emlakjet.com"];

    return [
        `${base} ${transaction === "kiralık" ? "kira" : "fiyat"}`,
        ...categoryTerms.map((term) => `${term} ${base}`),
    ].filter(Boolean);
}

function roomMatches(itemRoom, targetRoom) {
    const current = String(itemRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    const target = String(targetRoom || "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");
    if (!target || !current) return false;
    return current === target;
}

function preferTargetRoom(comparables, subjectRoomText, minTotal = TARGET_TOTAL) {
    const target = String(subjectRoomText || "").trim();
    if (!target) return comparables;

    const exact = comparables.filter((item) => roomMatches(item.roomText, target));
    if (exact.length >= minTotal) return exact;

    const withoutStudio = comparables.filter((item) => !/stüdyo|studio|1\+0/i.test(String(item.roomText || "")));
    if (/^[2-9]\+/.test(target) && withoutStudio.length >= minTotal) return withoutStudio;

    return uniqueComparables([
        ...exact,
        ...withoutStudio,
        ...comparables,
    ]);
}

function normalizedCandidateComparables(organicItems, criteria = {}, options = {}) {
    const category = propertyCategory(criteria);
    const unique = uniqueComparables(
        organicItems
            .map((item, index) => normalizeSerpComparable(item, criteria, index, options))
            .filter(Boolean)
    );

    if (category !== "residential") return unique;

    const existingCount = Number(options.existingComparableCount || 0);
    const desiredCount = Math.max(TARGET_TOTAL, Math.min(MAX_OUTPUT_COMPARABLES, TARGET_TOTAL - existingCount + GROUP_SIZE));
    return preferTargetRoom(unique, options.subjectRoomText, desiredCount);
}

async function runSerpQueryPage(queries = [], { pageIndex = 0, pageSize = SERP_PAGE_SIZE } = {}) {
    const start = pageIndex * pageSize;
    const settled = await Promise.allSettled(
        queries.map(async (query) => ({
            query,
            pageIndex,
            start,
            results: await searchSerpApiOrganic(query, { maxResults: pageSize, start }),
        }))
    );

    const warnings = [];
    const items = [];

    settled.forEach((result, index) => {
        const query = queries[index];
        if (result.status === "rejected") {
            warnings.push(`SERP_SNIPPET: ${String(result.reason?.message || result.reason)}`);
            console.warn("[SERP_SNIPPET] query failed", {
                query,
                pageIndex,
                start,
                message: String(result.reason?.message || result.reason),
            });
            return;
        }

        items.push(...(result.value.results || []));
        console.log("[SERP_SNIPPET] query success", {
            query: result.value.query,
            pageIndex: result.value.pageIndex,
            start: result.value.start,
            count: result.value.results?.length || 0,
        });
    });

    return { items, warnings };
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

    return {
        low: low.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        mid: mid.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        high: high.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
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

    ["low", "mid", "high"].forEach((group) => {
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
    const summaryParts = [`Arama sonucu özetlerinden ${comparables.length} fiyatlı emsal çıkarıldı.`];

    return {
        averageMarketingDays: null,
        competitionStatus: comparables.length >= 12 ? "Orta" : "Düşük",
        activeComparableCount: comparables.length,
        waitingComparableCount: null,
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

    const maxQueries = Math.max(1, Math.min(Number(5), 5));
    const maxResults = SERP_PAGE_SIZE;
    const queries = buildQueries(criteria, options).slice(0, maxQueries);
    const warnings = [];
    const organicItems = [];
    const existingCount = Number(options.existingComparableCount || 0);
    const desiredComparableCount = Math.max(TARGET_TOTAL, Math.min(MAX_OUTPUT_COMPARABLES, TARGET_TOTAL - existingCount + GROUP_SIZE));
    let pagesUsed = 0;

    console.log("[SERP_SNIPPET] query batch start", {
        queries: queries.length,
        maxResults,
        maxPages: SERP_MAX_PAGES,
        existingCount,
        desiredComparableCount,
    });

    const firstPage = await runSerpQueryPage(queries, { pageIndex: 0, pageSize: maxResults });
    pagesUsed = 1;
    warnings.push(...firstPage.warnings);
    organicItems.push(...firstPage.items);

    let candidateComparables = normalizedCandidateComparables(organicItems, criteria, {
        ...options,
        existingComparableCount: existingCount,
    });

    if (candidateComparables.length < desiredComparableCount && SERP_MAX_PAGES > 1) {
        console.log("[SERP_SNIPPET] second page needed", {
            candidateCount: candidateComparables.length,
            desiredComparableCount,
        });

        const secondPage = await runSerpQueryPage(queries, { pageIndex: 1, pageSize: maxResults });
        pagesUsed = 2;
        warnings.push(...secondPage.warnings);
        organicItems.push(...secondPage.items);
        candidateComparables = normalizedCandidateComparables(organicItems, criteria, {
            ...options,
            existingComparableCount: existingCount,
        });
    }


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
            serpPagesUsed: pagesUsed,
            desiredComparableCount,
            candidateCount: candidateComparables.length,
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
