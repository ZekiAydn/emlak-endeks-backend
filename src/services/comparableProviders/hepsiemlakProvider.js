import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { propertyCategory, valuationType } from "../propertyCategory.js";
import { TARGET_TOTAL, uniqueComparables } from "../comparablePolicy.js";
import {
    absoluteUrl,
    cleanText,
    listingTypeSlug,
    normalizeProviderComparable,
    propertyTypeSlug,
    slugifyTr,
} from "./providerUtils.js";

const PROVIDER = "HEPSIEMLAK";
const BASE_URL = "https://www.hepsiemlak.com";
const DEFAULT_MAX_LISTINGS = 30;
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

function maxListings(options = {}) {
    const existingCount = Number(options.existingComparableCount || 0);
    const desired = Math.max(TARGET_TOTAL, TARGET_TOTAL - existingCount + 8);
    return Math.max(8, Math.min(desired || DEFAULT_MAX_LISTINGS, DEFAULT_MAX_LISTINGS));
}

function listingPath(criteria = {}) {
    const district = slugifyTr(criteria.district);
    const neighborhood = slugifyTr(criteria.neighborhood);
    const listingType = listingTypeSlug(criteria);
    const propertyType = propertyTypeSlug(criteria);

    if (!district) return null;
    const location = neighborhood ? `${district}-${neighborhood}` : district;
    return `/${location}-${listingType}/${propertyType}`;
}

function buildHepsiemlakUrl(criteria = {}) {
    const path = listingPath(criteria);
    return path ? `${BASE_URL}${path}` : null;
}

function textParts($, element) {
    return $(element)
        .text()
        .split(/\n+/)
        .map(cleanText)
        .filter(Boolean);
}

function specFromTexts(texts, label) {
    const index = texts.findIndex((item) => item.toLocaleLowerCase("tr-TR") === label.toLocaleLowerCase("tr-TR"));
    if (index < 0) return null;

    const value = texts[index + 1] || null;
    if (/\+\s*$/.test(value || "") && /^\d+$/.test(texts[index + 2] || "")) {
        return `${value} ${texts[index + 2]}`;
    }

    return value;
}

function imageFromCard($, element) {
    const candidates = [];
    $(element)
        .find("img")
        .each((_, img) => {
            candidates.push($(img).attr("data-src"));
            candidates.push($(img).attr("src"));
            candidates.push($(img).attr("srcset")?.split(/\s+/)[0]);
        });

    return candidates
        .map((value) => absoluteUrl(value, BASE_URL))
        .find((url) => url && !url.startsWith("data:") && /hecdn|hemlak/i.test(url) && !/logo\//i.test(url));
}

function parseRecordCount(bodyText) {
    const match = cleanText(bodyText).match(/için\s+([\d.]+)\s+ilan\s+bulundu/i);
    if (!match) return null;
    const parsed = Number(match[1].replace(/\./g, ""));
    return Number.isFinite(parsed) ? parsed : null;
}

function listingIdFromUrl(url) {
    const match = cleanText(url).match(/\/([^/]+\/[^/]+)$/);
    return match?.[1] || null;
}

function extractListingCards(html, criteria = {}, options = {}) {
    const $ = cheerio.load(html);
    const output = [];
    const limit = maxListings(options);

    $("li.listing-item").each((_, element) => {
        if (output.length >= limit) return false;

        const link = absoluteUrl($(element).find("a.listingView__card-link").attr("href") || $(element).find("a").first().attr("href"), BASE_URL);
        const texts = textParts($, element);
        const priceText = cleanText($(element).find(".list-view-price").text());
        const title =
            cleanText($(element).find("a.listingView__card-link").attr("title")) ||
            texts.find((item) => item.length > 18 && !/telefonu göster|whatsapp|paylaş/i.test(item));
        const address = texts.find((item) => /\/.+\//.test(item) && /İstanbul|Ankara|İzmir|Bursa|Antalya|Kocaeli|Sakarya/i.test(item));
        const listingDate = texts.find((item) => /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(item));
        const imageUrl = imageFromCard($, element);
        const room = specFromTexts(texts, "Oda Sayısı");
        const grossArea = specFromTexts(texts, "Brüt m²");
        const buildingAgeText = specFromTexts(texts, "Bina Yaşı");
        const floorText = specFromTexts(texts, "Kat");
        const imageCount = cleanText($(element).find(".photo-count").first().text());

        const comparable = normalizeProviderComparable(
            {
                title,
                source: "Hepsiemlak",
                sourceUrl: link,
                price: priceText,
                grossArea,
                roomText: room,
                buildingAgeText,
                floorText,
                imageUrl,
                imageCount,
                listingDate,
                address,
                sourceListingId: listingIdFromUrl(link),
                externalId: listingIdFromUrl(link) ? `hepsiemlak:${listingIdFromUrl(link)}` : null,
                propertyType: propertyTypeSlug(criteria),
            },
            criteria,
            { name: PROVIDER, source: "Hepsiemlak", idPrefix: "hepsiemlak" }
        );

        if (comparable) output.push(comparable);
        return true;
    });

    return {
        comparables: uniqueComparables(output),
        recordCount: parseRecordCount($("body").text()) || output.length,
    };
}

async function fetchHtmlWithBrowser(url) {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            locale: "tr-TR",
            timezoneId: "Europe/Istanbul",
            userAgent: USER_AGENT,
            extraHTTPHeaders: {
                "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        });
        const page = await context.newPage();
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
            referer: "https://www.google.com/",
        });
        await page.waitForSelector("li.listing-item", { timeout: 15000 });

        for (let i = 0; i < 5; i += 1) {
            await page.mouse.wheel(0, 1200);
            await page.waitForTimeout(250);
        }

        return await page.content();
    } finally {
        await browser.close();
    }
}

async function fetchHepsiemlakComparableBundle(criteria = {}, options = {}) {
    if (propertyCategory(criteria) !== "residential" && propertyCategory(criteria) !== "land" && propertyCategory(criteria) !== "commercial") {
        return null;
    }

    const url = buildHepsiemlakUrl(criteria);
    if (!url) {
        return {
            comparables: [],
            groups: {},
            marketProjection: null,
            regionalStats: null,
            priceBand: null,
            sourceMeta: {
                provider: PROVIDER,
                fetchedAt: new Date().toISOString(),
                sampleCount: 0,
                recordCount: 0,
            },
            warnings: ["HEPSIEMLAK: ilçe bilgisi eksik"],
        };
    }

    console.log("[HEPSIEMLAK] fetch start", {
        url,
        valuationType: valuationType(criteria),
        maxListings: maxListings(options),
    });

    const html = await fetchHtmlWithBrowser(url);
    const { comparables, recordCount } = extractListingCards(html, criteria, options);

    console.log("[HEPSIEMLAK] fetch finish", {
        url,
        recordCount,
        comparableCount: comparables.length,
    });

    return {
        comparables,
        groups: {},
        marketProjection: null,
        regionalStats: null,
        priceBand: null,
        sourceMeta: {
            provider: PROVIDER,
            fetchedAt: new Date().toISOString(),
            scope: criteria.neighborhood ? "neighborhood" : criteria.district ? "district" : "city",
            recordCount,
            sampleCount: comparables.length,
            searchUrl: url,
            confidence: "medium",
            browser: "playwright",
        },
        warnings: comparables.length ? [] : ["HEPSIEMLAK: emsal bulunamadı"],
    };
}

export {
    buildHepsiemlakUrl,
    extractListingCards,
    fetchHepsiemlakComparableBundle,
};
