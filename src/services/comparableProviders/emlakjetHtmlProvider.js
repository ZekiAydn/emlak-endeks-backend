import * as cheerio from "cheerio";
import { comparableSearchText, propertyCategory, valuationType } from "../propertyCategory.js";

const EMLAKJET_BASE_URL = "https://www.emlakjet.com";
const GROUP_SIZE = 6;
const MAX_OUTPUT_COMPARABLES = 24;

const REQUEST_HEADERS = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: `${EMLAKJET_BASE_URL}/`,
    "upgrade-insecure-requests": "1",
    "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
};

function asciiTurkish(value) {
    return String(value || "")
        .replace(/İ/g, "i")
        .replace(/I/g, "i")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/Ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/Ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/Ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/Ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/Ç/g, "c");
}

function normalizeText(value) {
    return asciiTurkish(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[']/g, "")
        .replace(/&/g, " ve ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/Telefona Bak/gi, " ")
        .trim();
}

function stripNeighborhoodSuffix(value) {
    return normalizeText(value)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "")
        .trim();
}

function slugify(value) {
    return normalizeText(value).replace(/\s+/g, "-");
}

function slugifyNeighborhood(value) {
    const base = stripNeighborhoodSuffix(value);
    return base ? `${base.replace(/\s+/g, "-")}-mahallesi` : "";
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    const match = String(value)
        .replace(/\u00a0/g, " ")
        .replace(/₺/g, " TL")
        .match(/-?\d[\d.,]*/);

    if (!match) return null;

    const parsed = Number(
        match[0]
            .replace(/\./g, "")
            .replace(",", ".")
            .replace(/[^\d.-]/g, "")
    );

    return Number.isFinite(parsed) ? parsed : null;
}

function formatShortMoney(value) {
    const amount = toNumber(value);
    if (!Number.isFinite(amount)) return null;
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2).replace(".", ",")} Mn TL`;
    return `${Math.round(amount).toLocaleString("tr-TR")} TL`;
}

function absoluteUrl(href) {
    const text = String(href || "").trim();
    if (!text) return null;
    if (text.startsWith("http://") || text.startsWith("https://")) return text;
    if (text.startsWith("/")) return `${EMLAKJET_BASE_URL}${text}`;
    return `${EMLAKJET_BASE_URL}/${text}`;
}

function normalizeImageUrl(src) {
    const text = String(src || "").trim();
    if (!text || text.startsWith("data:")) return null;
    return absoluteUrl(text);
}

function detectTypeSlug(criteria = {}) {
    const category = propertyCategory(criteria);
    const type = normalizeText(comparableSearchText(criteria));

    if (category === "land") return "arsa";
    if (category === "commercial") return "isyeri";
    if (type.includes("villa")) return "villa";
    if (type.includes("residence")) return "residence";
    if (type.includes("mustakil")) return "mustakil-ev";
    if (type.includes("dublex") || type.includes("dubleks")) return "dubleks";
    if (type.includes("triplex") || type.includes("tripleks")) return "tripleks";
    return "daire";
}

function buildCategorySlug(criteria = {}) {
    const transaction = valuationType(criteria) === "rental" ? "kiralik" : "satilik";
    return `${transaction}-${detectTypeSlug(criteria)}`;
}

function buildEmlakjetSearchUrl(criteria = {}) {
    const categorySlug = buildCategorySlug(criteria);
    const citySlug = slugify(criteria.city);
    const districtSlug = slugify(criteria.district);
    const neighborhoodSlug = slugifyNeighborhood(criteria.neighborhood);
    const locationSlug = [citySlug, districtSlug, neighborhoodSlug].filter(Boolean).join("-");

    if (!categorySlug || !locationSlug) return null;
    return `${EMLAKJET_BASE_URL}/${categorySlug}/${locationSlug}`;
}

function withPage(url, pageNumber) {
    if (!url || pageNumber <= 1) return url;
    const parsed = new URL(url);
    parsed.searchParams.set("sayfa", String(pageNumber));
    return parsed.toString();
}

function parsePrice(text) {
    const source = cleanText(text);
    const match = source.match(/(\d[\d.]*(?:,\d{1,2})?)\s*(?:TL|₺)/i);
    return match ? toNumber(match[1]) : null;
}

function parseArea(text) {
    const match = cleanText(text).match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)/i);
    return match ? toNumber(match[1]) : null;
}

function parseRoomText(text) {
    const match = cleanText(text).match(/(\d+(?:[.,]5)?\s*\+\s*\d+)/);
    return match ? match[1].replace(/\s+/g, "").replace(",", ".") : null;
}

function parseFloorNumber(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const match = text.match(/-?\d+/);
    if (match) {
        const n = Number(match[0]);
        return Number.isFinite(n) ? n : null;
    }

    const normalized = normalizeText(text);
    if (normalized.includes("giris")) return 0;
    if (normalized.includes("zemin")) return 0;
    if (normalized.includes("bahce")) return 0;
    return null;
}

function parseAddress(locationText, criteria = {}) {
    const location = cleanText(locationText);
    if (location) {
        const normalizedLocation = location.replace(/\s+-\s+/g, " / ");
        return [criteria.city, normalizedLocation].filter(Boolean).join(" / ");
    }

    const fallback = [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean);
    return fallback.length ? fallback.join(" / ") : null;
}

function extractExternalId(url, fallback = null) {
    const text = String(url || fallback || "");
    const matches = text.match(/(\d{6,})/g);
    return matches?.length ? matches[matches.length - 1] : text;
}

function comparableArea(item) {
    return toNumber(item?.netArea) || toNumber(item?.grossArea) || null;
}

function comparableUnitPrice(item) {
    const direct = toNumber(item?.pricePerSqm);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const price = toNumber(item?.price);
    const area = comparableArea(item);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(area) || area <= 0) return null;
    return Math.round(price / area);
}

function parseTotalCount($) {
    const metaDescription = $("meta[name='description']").attr("content");
    const title = $("title").first().text();
    const text = cleanText(`${metaDescription || ""} ${title || ""} ${$("main").first().text()}`);

    const patterns = [
        /(\d+)\s+adet\b/i,
        /(\d+)\s+ilan\s+bulundu/i,
        /\((\d+)\)/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        const count = toNumber(match?.[1]);
        if (Number.isFinite(count) && count > 0) return count;
    }

    return null;
}

function parseCard($, card, criteria = {}) {
    const $card = $(card);
    const link = $card.find("a[href^='/ilan/']").first();
    const sourceUrl = absoluteUrl(link.attr("href"));
    if (!sourceUrl) return null;

    const text = cleanText($card.text());
    const quickInfo = cleanText($card.find("[class*='quickinfoWrapper']").first().text());
    const locationText = cleanText($card.find("[class*='locationWrapper']").first().text());
    const priceText = cleanText($card.find("[class*='price']").first().text()) || text;
    const title =
        cleanText($card.find("[class*='titleWrapper']").first().text()) ||
        cleanText($card.find("img").first().attr("alt")) ||
        "Emlakjet İlanı";
    const imageUrl = normalizeImageUrl(
        $card.find("img").first().attr("src") ||
        $card.find("img").first().attr("data-src") ||
        $card.find("img").first().attr("data-original")
    );

    const segments = quickInfo.split("|").map(cleanText).filter(Boolean);
    const roomText = parseRoomText(quickInfo || text);
    const grossArea = parseArea(quickInfo || text);
    const floorText = segments.find((segment) => /kat/i.test(segment)) || null;
    const price = parsePrice(priceText);
    const pricePerSqm =
        Number.isFinite(price) && Number.isFinite(grossArea) && grossArea > 0
            ? Math.round(price / grossArea)
            : null;

    if (!Number.isFinite(price) || price < 250000) return null;
    if (!Number.isFinite(grossArea) || grossArea <= 10) return null;

    return {
        title,
        source: "Emlakjet",
        sourceUrl,
        price,
        netArea: null,
        grossArea,
        roomText,
        buildingAge: null,
        floor: parseFloorNumber(floorText),
        floorText,
        totalFloors: null,
        distanceMeters: null,
        listingAgeDays: null,
        imageUrl,
        address: parseAddress(locationText, criteria),
        externalId: extractExternalId(sourceUrl, $card.attr("data-item-id")),
        createdAt: new Date().toISOString(),
        pricePerSqm,
        provider: "EMLAKJET",
        latitude: null,
        longitude: null,
        propertyType: segments[0] || comparableSearchText(criteria),
    };
}

function dedupeComparables(items = []) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
        const key = item?.externalId || item?.sourceUrl || `${item?.title}-${item?.price}-${item?.grossArea}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }

    return output;
}

function isLikelyTestListing(item) {
    const text = normalizeText(`${item?.title || ""} ${item?.address || ""}`);
    return text.includes("test") || text.includes("dikkate almayin");
}

function trimOutlierComparables(comparables = []) {
    const clean = comparables.filter((item) => {
        if (isLikelyTestListing(item)) return false;

        const price = toNumber(item.price);
        const area = comparableArea(item);
        const unit = comparableUnitPrice(item);

        if (!Number.isFinite(price) || price < 250000) return false;
        if (!Number.isFinite(area) || area <= 10) return false;
        if (Number.isFinite(unit) && unit < 5000) return false;
        return true;
    });

    if (!clean.length && comparables.length) return comparables.filter((item) => !isLikelyTestListing(item));

    const units = clean.map(comparableUnitPrice).filter(Number.isFinite).sort((a, b) => a - b);
    if (units.length < 8) return clean;

    const q1 = quantile(units, 0.25);
    const q3 = quantile(units, 0.75);
    const iqr = q3 - q1;
    const lower = Math.max(1, q1 - iqr * 1.5);
    const upper = q3 + iqr * 1.5;

    const filtered = clean.filter((item) => {
        const unit = comparableUnitPrice(item);
        if (!Number.isFinite(unit)) return true;
        return unit >= lower && unit <= upper;
    });

    return filtered.length >= 6 ? filtered : clean;
}

function roomMatches(itemRoom, targetRoom) {
    const current = normalizeText(itemRoom).replace(/\s+/g, "");
    const target = normalizeText(targetRoom).replace(/\s+/g, "");
    return !!current && !!target && current === target;
}

function preferTargetRoom(items, subjectRoomText) {
    const target = String(subjectRoomText || "").trim();
    if (!target) return items;

    const exact = items.filter((item) => roomMatches(item.roomText, target));
    if (exact.length >= 8) return exact;

    const withoutStudio = items.filter((item) => !/stüdyo|studio|1\+0/i.test(String(item.roomText || "")));
    if (/^[2-9]\+/.test(target) && withoutStudio.length >= 8) return withoutStudio;

    return items;
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

function chooseMidComparables(sortedItems, count, excludedKeys) {
    const candidates = sortedItems.filter((item) => !excludedKeys.has(item.externalId || item.sourceUrl));
    if (!candidates.length) return [];

    const start = Math.max(0, Math.floor(candidates.length / 2) - Math.floor(count / 2));
    return candidates.slice(start, start + count);
}

function buildGroups(comparables = []) {
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

function buildMarketProjection(comparables, totalCount) {
    const activeComparableCount = toNumber(totalCount) || comparables.length || null;

    let competitionStatus = "Düşük";
    if (activeComparableCount >= 80) competitionStatus = "Yüksek";
    else if (activeComparableCount >= 25) competitionStatus = "Orta";

    return {
        averageMarketingDays: null,
        competitionStatus,
        activeComparableCount,
        waitingComparableCount: 0,
        annualChangePct: null,
        amortizationYears: null,
        summary: activeComparableCount
            ? `Emlakjet havuzunda ${activeComparableCount} aktif emsal örneği değerlendirildi.`
            : `${comparables.length} Emlakjet emsali değerlendirildi.`,
        manualText: activeComparableCount
            ? `Emlakjet havuzunda ${activeComparableCount} aktif emsal örneği değerlendirildi.`
            : `${comparables.length} Emlakjet emsali değerlendirildi.`,
    };
}

function buildRegionalStats(criteria, comparables, parcelLookup, marketProjection) {
    const prices = comparables.map((item) => toNumber(item.price)).filter(Number.isFinite);
    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    const locationLabel = [criteria.neighborhood, criteria.district, criteria.city].filter(Boolean).join(" / ");

    const areaSummary = prices.length
        ? `İncelenen emsallerde fiyat bandı ${formatShortMoney(Math.min(...prices))} ile ${formatShortMoney(Math.max(...prices))} arasında.`
        : "";
    const unitSummary = unitPrices.length
        ? `Birim fiyatlar ${Math.round(Math.min(...unitPrices)).toLocaleString("tr-TR")} - ${Math.round(Math.max(...unitPrices)).toLocaleString("tr-TR")} TL/m² bandında.`
        : "";

    const parcelBits = [];
    if (parcelLookup?.properties?.summary) parcelBits.push(parcelLookup.properties.summary);
    if (parcelLookup?.properties?.quality) parcelBits.push(parcelLookup.properties.quality);
    if (parcelLookup?.properties?.area) parcelBits.push(`${parcelLookup.properties.area} m²`);

    return {
        demographicsSummary: locationLabel ? `${locationLabel} çevresindeki Emlakjet ilan havuzu üzerinden değerlendirme yapıldı.` : null,
        saleMarketSummary: [areaSummary, unitSummary].filter(Boolean).join(" "),
        rentalMarketSummary: marketProjection?.summary || null,
        nearbyPlacesSummary: parcelBits.length
            ? `Parsel doğrulaması ${parcelBits.join(" • ")} bilgileriyle desteklendi.`
            : null,
        riskSummary: "Aktif ilan havuzu fiyat, metrekare ve konum benzerliğiyle manuel kontrol edilmelidir.",
    };
}

function buildPriceBandForSubject(comparables, subjectArea) {
    const area = toNumber(subjectArea);
    if (!Number.isFinite(area) || area <= 0) return null;

    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    if (unitPrices.length < 3) return null;

    const minPricePerSqm = Math.round(quantile(unitPrices, 0.2));
    const expectedPricePerSqm = Math.round(quantile(unitPrices, 0.5));
    const maxPricePerSqm = Math.round(quantile(unitPrices, 0.8));

    if (![minPricePerSqm, expectedPricePerSqm, maxPricePerSqm].every(Number.isFinite)) return null;

    return {
        minPricePerSqm,
        expectedPricePerSqm,
        maxPricePerSqm,
        minPrice: Math.round(minPricePerSqm * area),
        expectedPrice: Math.round(expectedPricePerSqm * area),
        maxPrice: Math.round(maxPricePerSqm * area),
        confidence: Math.min(0.74, 0.48 + unitPrices.length * 0.01),
        note: `${comparables.length} Emlakjet emsalinin birim fiyat dağılımı üzerinden hesaplanan veri destekli fiyat bandıdır.`,
    };
}

async function fetchHtml(url, options = {}) {
    const timeoutMs = Number(process.env.EMLAKJET_TIMEOUT_MS || 20000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        console.log("[EMLAKJET] fetch", { url });

        const response = await fetch(url, {
            headers: REQUEST_HEADERS,
            cache: "no-store",
            signal: controller.signal,
        });
        const contentType = response.headers.get("content-type");
        const html = await response.text().catch(() => "");

        console.log("[EMLAKJET] response", {
            url,
            status: response.status,
            ok: response.ok,
            contentType,
            size: html.length,
        });

        const result = {
            url,
            status: response.status,
            ok: response.ok,
            contentType,
            html,
            htmlLength: html.length,
            bodyStart: html.slice(0, 500),
        };

        if (!response.ok) {
            const error = new Error(`Emlakjet araması cevap vermedi (${response.status}): ${html.slice(0, 300)}`);
            error.fetchResult = result;
            throw error;
        }

        if (!html || html.length < 1000) {
            const error = new Error(`Emlakjet aramasından beklenen HTML alınamadı. Uzunluk: ${html.length}`);
            error.fetchResult = result;
            throw error;
        }

        return options.includeMeta ? result : html;
    } finally {
        clearTimeout(timer);
    }
}

function parseSearchPage(url, html, criteria = {}, options = {}) {
    const $ = cheerio.load(html);
    const cards = $("[data-type='ilan'][data-item-id]").toArray();
    const comparables = dedupeComparables(
        cards
            .map((card) => parseCard($, card, criteria))
            .filter(Boolean)
    );
    const totalCount = parseTotalCount($);

    console.log("[EMLAKJET] parsed", {
        url,
        cards: cards.length,
        comparables: comparables.length,
        totalCount,
    });

    if (options.includeDiagnostics) {
        return {
            title: cleanText($("title").first().text()),
            cardsCount: cards.length,
            totalCount,
            comparables,
            bodyStart: html.slice(0, 500),
        };
    }

    return {
        comparables,
        totalCount,
        cardsCount: cards.length,
    };
}

async function fetchAndParse(url, criteria) {
    const html = await fetchHtml(url);
    return parseSearchPage(url, html, criteria);
}

async function fetchEmlakjetHtmlComparableBundle(criteria = {}, options = {}) {
    if (!criteria.city || !criteria.district) return null;

    const baseUrl = buildEmlakjetSearchUrl(criteria);
    if (!baseUrl) return null;

    const maxItems = Math.min(Number(process.env.EMLAKJET_MAX_ITEMS || 60), 100);
    const maxPages = Math.max(1, Math.min(Number(process.env.EMLAKJET_MAX_PAGES || 2), 5));
    const pages = [];
    const errors = [];

    try {
        const first = await fetchAndParse(baseUrl, criteria);
        pages.push({ page: 1, url: baseUrl, ...first });

        const totalCount = first.totalCount || first.comparables.length;
        const pageSize = first.cardsCount || first.comparables.length || 30;
        const expectedPages = Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)));
        const pageLimit = Math.min(maxPages, expectedPages);

        for (let page = 2; page <= pageLimit; page += 1) {
            const url = withPage(baseUrl, page);
            try {
                const parsed = await fetchAndParse(url, criteria);
                pages.push({ page, url, ...parsed });
            } catch (error) {
                errors.push(`${url}: ${String(error.message || error)}`);
            }
        }
    } catch (error) {
        errors.push(`${baseUrl}: ${String(error.message || error)}`);
    }

    const totalCount = pages.find((page) => Number.isFinite(toNumber(page.totalCount)))?.totalCount || null;
    const rawComparables = preferTargetRoom(
        dedupeComparables(pages.flatMap((page) => page.comparables || [])),
        options.subjectRoomText
    );
    const presentationPool = trimOutlierComparables(rawComparables).slice(0, maxItems);

    console.log("[EMLAKJET] bundle", {
        baseUrl,
        pages: pages.map((page) => ({ page: page.page, count: page.comparables?.length || 0 })),
        rawCount: rawComparables.length,
        presentationCount: presentationPool.length,
        totalCount,
        errors: errors.slice(0, 5),
    });

    if (!presentationPool.length) {
        const error = new Error(errors[0] || "Emlakjet aramasında emsal bulunamadı.");
        error.code = "EMLAKJET_EMPTY";
        throw error;
    }

    const groups = buildGroups(presentationPool);
    const comparables = enrichComparablesWithGroups(orderComparablesForOutput(presentationPool, groups), groups);
    const marketProjection = buildMarketProjection(presentationPool, totalCount || rawComparables.length);
    const regionalStats = buildRegionalStats(criteria, presentationPool, options.parcelLookup, marketProjection);
    const priceBand = buildPriceBandForSubject(presentationPool, options.subjectArea);

    return {
        comparables,
        groups,
        marketProjection,
        regionalStats,
        priceBand,
        warnings: errors.length ? errors.map((error) => `EMLAKJET_HTML: ${error}`) : [],
        sourceMeta: {
            provider: "EMLAKJET_HTML",
            fetchedAt: new Date().toISOString(),
            scope: criteria.neighborhood ? "neighborhood" : criteria.district ? "district" : "city",
            recordCount: totalCount || rawComparables.length,
            sampleCount: comparables.length,
            parsedCount: rawComparables.length,
            searchUrls: pages.map((page) => page.url),
        },
    };
}

export {
    fetchEmlakjetHtmlComparableBundle,
    fetchHtml,
    parseSearchPage,
    buildEmlakjetSearchUrl,
};
