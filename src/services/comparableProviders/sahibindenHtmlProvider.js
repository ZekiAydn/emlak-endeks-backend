import * as cheerio from "cheerio";
import { getBrowser } from "../headlessBrowser.js";
import { comparableSearchText, propertyCategory, valuationType } from "../propertyCategory.js";
import { searchSerpApiOrganic } from "./hepsiemlakUrlResolver.js";

const SAHIBINDEN_BASE_URL = "https://www.sahibinden.com";
const GROUP_SIZE = 6;
const MAX_OUTPUT_COMPARABLES = 24;

const REQUEST_HEADERS = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: `${SAHIBINDEN_BASE_URL}/`,
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
    return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
    return normalizeText(value).replace(/\s+/g, "-");
}

function stripNeighborhoodSuffix(value) {
    return normalizeText(value)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "")
        .trim();
}

function slugifyNeighborhood(value) {
    const base = stripNeighborhoodSuffix(value);
    return base ? `${base.replace(/\s+/g, "-")}-mh.` : "";
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

function absoluteUrl(href) {
    const text = String(href || "").trim();
    if (!text) return null;
    if (text.startsWith("http://") || text.startsWith("https://")) return text;
    if (text.startsWith("/")) return `${SAHIBINDEN_BASE_URL}${text}`;
    return `${SAHIBINDEN_BASE_URL}/${text}`;
}

function normalizeImageUrl(src) {
    const text = String(src || "").trim();
    if (!text || text.startsWith("data:")) return null;
    return absoluteUrl(text);
}

function detectPathType(criteria = {}) {
    const category = propertyCategory(criteria);
    const type = normalizeText(comparableSearchText(criteria));

    if (category === "land") return "arsa";
    if (category === "commercial") return "is-yeri";
    if (type.includes("villa")) return "villa";
    if (type.includes("residence")) return "residence";
    return "daire";
}

function buildCategoryPath(criteria = {}) {
    const transaction = valuationType(criteria) === "rental" ? "kiralik" : "satilik";
    const type = detectPathType(criteria);

    if (type === "arsa") return `${transaction}-arsa`;
    if (type === "is-yeri") return `${transaction}-isyeri`;
    return `${transaction}-${type}`;
}

function buildGeneratedUrls(criteria = {}) {
    const categoryPath = buildCategoryPath(criteria);
    const citySlug = slugify(criteria.city);
    const districtSlug = slugify(criteria.district);
    const neighborhoodSlug = slugifyNeighborhood(criteria.neighborhood);
    const urls = [];

    if (citySlug && districtSlug && neighborhoodSlug) {
        urls.push(`${SAHIBINDEN_BASE_URL}/${categoryPath}/${citySlug}-${districtSlug}-${neighborhoodSlug}`);
    }
    if (citySlug && districtSlug) {
        urls.push(`${SAHIBINDEN_BASE_URL}/${categoryPath}/${citySlug}-${districtSlug}`);
    }

    return urls;
}

function buildSerpQuery(criteria = {}) {
    const location = [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean).join(" ");
    const transaction = valuationType(criteria) === "rental" ? "kiralık" : "satılık";
    const roomText = cleanText(criteria.roomText || criteria.subjectRoomText);
    const searchText = cleanText(criteria.searchText || criteria.listingTitle || criteria.title);
    return ["site:sahibinden.com", location, transaction, comparableSearchText(criteria), searchText, roomText]
        .filter(Boolean)
        .join(" ");
}

function normalizeSerpUrl(url) {
    const text = String(url || "").trim();
    if (!text || !text.includes("sahibinden.com")) return null;

    try {
        const parsed = new URL(text);
        parsed.hash = "";
        const keep = new URLSearchParams();
        for (const [key, value] of parsed.searchParams.entries()) {
            if (["pagingoffset", "a23"].includes(key.toLowerCase())) keep.set(key, value);
        }
        parsed.search = keep.toString();
        return parsed.toString();
    } catch {
        return text;
    }
}

function isUsefulUrl(url) {
    const lower = String(url || "").toLowerCase();
    if (!lower.includes("sahibinden.com")) return false;
    if (lower.includes("/emlak-ofisi")) return false;
    if (lower.includes("/projeler")) return false;
    if (lower.includes("/yardim")) return false;
    if (lower.includes("/ilan-ver")) return false;
    return lower.includes("satilik") || lower.includes("kiralik") || lower.includes("/ilan/");
}

async function resolveSahibindenUrls(criteria = {}) {
    const generated = buildGeneratedUrls(criteria);
    const serpUrls = [];

    if (process.env.SERPER_API_KEY) {
        try {
            const query = buildSerpQuery(criteria);
            console.log("[SAHIBINDEN] serp resolve", { query });
            const organic = await searchSerpApiOrganic(query, {
                maxResults: Math.min(Number(process.env.SAHIBINDEN_SERP_MAX_RESULTS || 10), 20),
            });
            serpUrls.push(
                ...organic
                    .map((item) => normalizeSerpUrl(item?.link || item?.redirect_link))
                    .filter(isUsefulUrl)
            );
        } catch (error) {
            console.warn("[SAHIBINDEN] serp resolve failed", { message: String(error.message || error) });
        }
    }

    return [...new Set([...serpUrls, ...generated])];
}

function isBlockedHtml(html, title = "") {
    const text = `${title} ${html}`.toLowerCase();
    return (
        text.includes("just a moment") ||
        text.includes("cf-mitigated") ||
        text.includes("px-captcha") ||
        text.includes("olağan dışı erişim") ||
        text.includes("olagan disi erisim") ||
        text.includes("enable javascript and cookies")
    );
}

function headersWithCookie() {
    const cookie = cleanText(process.env.SAHIBINDEN_COOKIE || "");
    return cookie ? { ...REQUEST_HEADERS, cookie } : REQUEST_HEADERS;
}

async function fetchHtml(url, options = {}) {
    const timeoutMs = Number(process.env.SAHIBINDEN_TIMEOUT_MS || 20000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        console.log("[SAHIBINDEN] fetch", { url });
        const response = await fetch(url, {
            headers: headersWithCookie(),
            cache: "no-store",
            signal: controller.signal,
        });
        const html = await response.text().catch(() => "");
        const contentType = response.headers.get("content-type");
        const result = {
            url,
            status: response.status,
            ok: response.ok,
            contentType,
            html,
            htmlLength: html.length,
            bodyStart: html.slice(0, 500),
        };

        console.log("[SAHIBINDEN] response", {
            url,
            status: response.status,
            ok: response.ok,
            contentType,
            size: html.length,
        });

        if (!response.ok || isBlockedHtml(html)) {
            if (process.env.ENABLE_BROWSER_FALLBACK === "true" && process.env.SAHIBINDEN_BROWSER_FALLBACK_ENABLED !== "false") {
                return fetchHtmlWithBrowser(url, options, result);
            }

            const error = new Error(`Sahibinden erişimi engellendi veya cevap vermedi (${response.status}).`);
            error.code = "SAHIBINDEN_BLOCKED";
            error.fetchResult = result;
            throw error;
        }

        return options.includeMeta ? result : html;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchHtmlWithBrowser(url, options = {}, directResult = {}) {
    console.log("[SAHIBINDEN] browser fallback", {
        url,
        directStatus: directResult.status || null,
        directHtmlLength: directResult.htmlLength || 0,
    });

    const browser = await getBrowser();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1200, deviceScaleFactor: 1 },
        locale: "tr-TR",
        userAgent: REQUEST_HEADERS["user-agent"],
        extraHTTPHeaders: headersWithCookie(),
    });

    try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        const title = await page.title().catch(() => "");
        const html = await page.content();
        const status = response?.status() || null;
        const result = {
            url,
            status: status || 200,
            ok: !status || status < 400,
            contentType: response?.headers()?.["content-type"] || "text/html",
            html,
            htmlLength: html.length,
            bodyStart: html.slice(0, 500),
            browserFallback: true,
            directStatus: directResult.status || null,
        };

        console.log("[SAHIBINDEN] browser response", {
            url,
            status,
            ok: result.ok,
            size: html.length,
            title: cleanText(title).slice(0, 120),
            blocked: isBlockedHtml(html, title),
        });

        if (!result.ok || isBlockedHtml(html, title)) {
            const error = new Error("Sahibinden bot/captcha koruması nedeniyle direkt ilan sayfası okunamadı.");
            error.code = "SAHIBINDEN_BLOCKED";
            error.fetchResult = result;
            throw error;
        }

        return options.includeMeta ? result : html;
    } finally {
        await page.close().catch(() => {});
    }
}

function parsePrice(text) {
    const match = cleanText(text).match(/(\d[\d.]*(?:,\d{1,2})?)\s*(?:TL|₺)/i);
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

function parseListingCard($, row, criteria = {}) {
    const $row = $(row);
    const sourceUrl = absoluteUrl(
        $row.find("a[href*='/ilan/']").first().attr("href") ||
        $row.find("a[href]").first().attr("href")
    );
    if (!sourceUrl || !sourceUrl.includes("sahibinden.com")) return null;

    const text = cleanText($row.text());
    const title =
        cleanText($row.find(".classifiedTitle").first().text()) ||
        cleanText($row.find("a[href*='/ilan/']").first().text()) ||
        "Sahibinden İlanı";
    const priceText = cleanText($row.find(".searchResultsPriceValue").first().text()) || text;
    const locationText = cleanText($row.find(".searchResultsLocationValue").first().text());
    const attributes = $row.find(".searchResultsAttributeValue").map((_, node) => cleanText($(node).text())).get();
    const detailText = [text, ...attributes].join(" ");
    const price = parsePrice(priceText);
    const area = parseArea(detailText);
    const roomText = parseRoomText(detailText);
    const imageUrl = normalizeImageUrl(
        $row.find("img").first().attr("data-src") ||
        $row.find("img").first().attr("src")
    );

    if (!Number.isFinite(price) || price < 250000) return null;

    return {
        title,
        source: "Sahibinden",
        sourceUrl,
        price,
        netArea: null,
        grossArea: area,
        roomText,
        buildingAge: null,
        floor: null,
        floorText: null,
        totalFloors: null,
        distanceMeters: null,
        listingAgeDays: null,
        imageUrl,
        address: locationText || [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean).join(" / ") || null,
        externalId: $row.attr("data-id") || sourceUrl.match(/(\d{6,})/)?.[1] || sourceUrl,
        createdAt: new Date().toISOString(),
        pricePerSqm: Number.isFinite(price) && Number.isFinite(area) && area > 0 ? Math.round(price / area) : null,
        provider: "SAHIBINDEN",
        latitude: null,
        longitude: null,
    };
}

function parseSearchPage(url, html, criteria = {}, options = {}) {
    const $ = cheerio.load(html);
    const rows = [
        ...$("tr.searchResultsItem").toArray(),
        ...$("[data-id].searchResultsItem").toArray(),
        ...$("[class*='searchResultsItem']").toArray(),
    ];
    const comparables = dedupeComparables(
        rows
            .map((row) => parseListingCard($, row, criteria))
            .filter(Boolean)
    );

    console.log("[SAHIBINDEN] parsed", {
        url,
        rows: rows.length,
        comparables: comparables.length,
    });

    if (options.includeDiagnostics) {
        return {
            title: cleanText($("title").first().text()),
            rowsCount: rows.length,
            comparables,
            bodyStart: html.slice(0, 500),
        };
    }

    return comparables;
}

function dedupeComparables(items = []) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
        const key = item.externalId || item.sourceUrl || `${item.title}-${item.price}-${item.grossArea}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }

    return output;
}

function comparableUnitPrice(item) {
    const direct = toNumber(item?.pricePerSqm);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const price = toNumber(item?.price);
    const area = toNumber(item?.netArea) || toNumber(item?.grossArea);
    if (!Number.isFinite(price) || !Number.isFinite(area) || area <= 0) return null;
    return Math.round(price / area);
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

    return {
        low: low.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        mid: mid.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        high: high.map((item) => item.externalId || item.sourceUrl).filter(Boolean),
        stale: [],
    };
}

function tagGroups(comparables, groups) {
    const tagged = new Map();
    Object.entries(groups || {}).forEach(([group, ids]) => {
        (ids || []).forEach((id) => tagged.set(id, group));
    });
    return comparables.map((item) => ({
        ...item,
        group: tagged.get(item.externalId || item.sourceUrl) || item.group || null,
    }));
}

function buildPriceBand(comparables, subjectArea) {
    const area = toNumber(subjectArea);
    if (!Number.isFinite(area) || area <= 0) return null;
    const unitPrices = comparables.map(comparableUnitPrice).filter(Number.isFinite);
    if (unitPrices.length < 3) return null;

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
        confidence: Math.min(0.7, 0.46 + unitPrices.length * 0.01),
        note: `${comparables.length} Sahibinden emsali üzerinden hesaplanan fiyat bandıdır.`,
    };
}

async function fetchSahibindenHtmlComparableBundle(criteria = {}, options = {}) {
    if (!criteria.city || !criteria.district) return null;

    const urls = (await resolveSahibindenUrls({
        ...criteria,
        subjectRoomText: options.subjectRoomText,
    })).slice(0, Math.max(1, Math.min(Number(process.env.SAHIBINDEN_MAX_URLS || 3), 8)));
    const errors = [];
    const comparables = [];

    for (const url of urls) {
        try {
            const html = await fetchHtml(url);
            comparables.push(...parseSearchPage(url, html, criteria));
        } catch (error) {
            errors.push(`${url}: ${String(error.message || error)}`);
        }
    }

    const unique = dedupeComparables(comparables).slice(0, Math.min(Number(process.env.SAHIBINDEN_MAX_ITEMS || 36), 60));
    console.log("[SAHIBINDEN] bundle", {
        urls,
        rawCount: comparables.length,
        uniqueCount: unique.length,
        errors: errors.slice(0, 5),
    });

    if (!unique.length) {
        const error = new Error(errors[0] || "Sahibinden aramasında emsal bulunamadı.");
        error.code = errors.some((item) => item.includes("bot/captcha")) ? "SAHIBINDEN_BLOCKED" : "SAHIBINDEN_EMPTY";
        throw error;
    }

    const groups = buildGroups(unique);
    const tagged = tagGroups(unique.slice(0, MAX_OUTPUT_COMPARABLES), groups);

    return {
        comparables: tagged,
        groups,
        marketProjection: {
            averageMarketingDays: null,
            competitionStatus: unique.length >= 25 ? "Orta" : "Düşük",
            activeComparableCount: unique.length,
            waitingComparableCount: 0,
            annualChangePct: null,
            amortizationYears: null,
            summary: `${unique.length} Sahibinden emsali değerlendirildi.`,
            manualText: `${unique.length} Sahibinden emsali değerlendirildi.`,
        },
        regionalStats: null,
        priceBand: buildPriceBand(unique, options.subjectArea),
        warnings: errors.length ? errors.map((error) => `SAHIBINDEN_HTML: ${error}`) : [],
        sourceMeta: {
            provider: "SAHIBINDEN_HTML",
            fetchedAt: new Date().toISOString(),
            scope: criteria.neighborhood ? "neighborhood" : criteria.district ? "district" : "city",
            recordCount: unique.length,
            sampleCount: tagged.length,
            searchUrls: urls,
            blocked: errors.some((item) => item.includes("bot/captcha") || item.includes("erişimi engellendi")),
        },
    };
}

export {
    fetchSahibindenHtmlComparableBundle,
    fetchHtml,
    parseSearchPage,
    resolveSahibindenUrls,
};
