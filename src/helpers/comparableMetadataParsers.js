import * as cheerio from "cheerio";
import {
    extractAreaM2FromText,
    extractCurrencyFromText,
    extractPriceFromText,
    extractPropertyTypeFromText,
    extractRoomTextFromText,
    normalizeArea,
    normalizePrice,
} from "./comparableExtraction.js";

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
    const text = cleanString(value);
    if (!text) return null;
    try {
        return new URL(text, baseUrl).toString();
    } catch {
        return null;
    }
}

function jsonSafeParse(value) {
    try {
        return JSON.parse(String(value || "").trim());
    } catch {
        return null;
    }
}

function collectNodes(value, out = []) {
    if (!value || typeof value !== "object") return out;
    if (Array.isArray(value)) {
        value.forEach((item) => collectNodes(item, out));
        return out;
    }
    out.push(value);
    Object.values(value).forEach((item) => collectNodes(item, out));
    return out;
}

function firstImage(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(firstImage).find(Boolean) || null;
    if (typeof value === "object") return value.url || value.contentUrl || value.thumbnailUrl || null;
    return null;
}

function firstOffer(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value.map(firstOffer).find(Boolean) || null;
    if (typeof value === "object") return value;
    return null;
}

function scalar(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === "object") return value.value || value.name || value.text || null;
    return value;
}

function metaContent($, key) {
    return cleanString($(`meta[property="${key}"]`).attr("content") || $(`meta[name="${key}"]`).attr("content"));
}

function htmlTitle($) {
    return cleanString($("title").first().text());
}

export function parseJsonLd(html = "", baseUrl = "") {
    const $ = cheerio.load(html || "");
    const out = {
        title: null,
        description: null,
        price: null,
        currency: null,
        areaM2: null,
        roomText: null,
        imageUrl: null,
        propertyType: null,
        raw: [],
    };

    $("script[type='application/ld+json']").each((_, el) => {
        const parsed = jsonSafeParse($(el).contents().text());
        if (parsed) out.raw.push(parsed);
    });

    for (const node of collectNodes(out.raw)) {
        if (!out.title) out.title = cleanString(node.name || node.headline);
        if (!out.description) out.description = cleanString(node.description);

        const offer = firstOffer(node.offers || node.offer);
        if (!out.price) out.price = normalizePrice(offer?.price || node.price) || extractPriceFromText(offer?.price || node.price || "");
        if (!out.currency) out.currency = cleanString(offer?.priceCurrency || node.priceCurrency) || null;

        const floorSize = Array.isArray(node.floorSize) ? node.floorSize[0] : node.floorSize;
        if (!out.areaM2) out.areaM2 = normalizeArea(scalar(floorSize) || node.size || node.area) || extractAreaM2FromText(scalar(floorSize) || node.size || node.area || "");
        if (!out.roomText) out.roomText = extractRoomTextFromText(node.numberOfRooms || node.numberOfBedrooms || "");
        if (!out.imageUrl) out.imageUrl = absoluteUrl(firstImage(node.image || node.photo || node.primaryImageOfPage), baseUrl);
        if (!out.propertyType) out.propertyType = extractPropertyTypeFromText([node["@type"], node.category, node.additionalType].filter(Boolean).join(" "));
    }

    return out;
}

export function parseOpenGraph(html = "", baseUrl = "") {
    const $ = cheerio.load(html || "");
    const title = metaContent($, "og:title");
    const description = metaContent($, "og:description") || metaContent($, "description");
    const combined = [title, description].filter(Boolean).join(" ");

    return {
        title: title || null,
        description: description || null,
        price: extractPriceFromText(combined),
        currency: extractCurrencyFromText(combined),
        areaM2: extractAreaM2FromText(combined),
        roomText: extractRoomTextFromText(combined),
        imageUrl: absoluteUrl(metaContent($, "og:image:secure_url") || metaContent($, "og:image"), baseUrl),
        propertyType: extractPropertyTypeFromText(combined),
        raw: {
            title,
            description,
            image: metaContent($, "og:image"),
        },
    };
}

export function parseTwitterMeta(html = "", baseUrl = "") {
    const $ = cheerio.load(html || "");
    const title = metaContent($, "twitter:title");
    const description = metaContent($, "twitter:description");
    const combined = [title, description].filter(Boolean).join(" ");

    return {
        title: title || null,
        description: description || null,
        price: extractPriceFromText(combined),
        currency: extractCurrencyFromText(combined),
        areaM2: extractAreaM2FromText(combined),
        roomText: extractRoomTextFromText(combined),
        imageUrl: absoluteUrl(metaContent($, "twitter:image"), baseUrl),
        propertyType: extractPropertyTypeFromText(combined),
        raw: {
            title,
            description,
            image: metaContent($, "twitter:image"),
        },
    };
}

export function parseVisibleHtmlText(html = "") {
    const $ = cheerio.load(html || "");
    $("script, style, noscript, svg").remove();
    const title = htmlTitle($);
    const bodyText = cleanString($("body").text()).slice(0, 150_000);
    const combined = [title, bodyText].filter(Boolean).join(" ");

    return {
        title: title || null,
        description: bodyText ? bodyText.slice(0, 2_000) : null,
        price: extractPriceFromText(combined),
        currency: extractCurrencyFromText(combined),
        areaM2: extractAreaM2FromText(combined),
        roomText: extractRoomTextFromText(combined),
        propertyType: extractPropertyTypeFromText(combined),
        rawText: bodyText,
    };
}

export function parseGalleryImages(html = "", baseUrl = "") {
    const $ = cheerio.load(html || "");
    const candidates = [];

    $("img").each((_, el) => {
        const srcset = cleanString($(el).attr("srcset"));
        const fromSrcset = srcset.split(",").map((part) => cleanString(part).split(/\s+/)[0]).find(Boolean);
        candidates.push(
            absoluteUrl($(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || fromSrcset, baseUrl)
        );
    });

    $("[style]").each((_, el) => {
        const match = cleanString($(el).attr("style")).match(/url\(([^)]+)\)/i);
        if (match) candidates.push(absoluteUrl(match[1].replace(/^['"]|['"]$/g, ""), baseUrl));
    });

    const seen = new Set();
    const images = candidates
        .filter(Boolean)
        .filter((url) => /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(url) || /(image|photo|listing|resize|cdn)/i.test(url))
        .filter((url) => !/(logo|favicon|sprite|icon|avatar|profile|captcha|challenge|placeholder|blank)/i.test(url))
        .filter((url) => {
            const key = String(url).replace(/[?#].*$/, "");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    return {
        imageUrl: images[0] || null,
        images,
    };
}

export function detectBlockedHtml({ status = null, html = "", title = "" } = {}) {
    const haystack = [title, html].map(cleanString).join(" ").toLocaleLowerCase("tr-TR");
    if ([403, 429].includes(Number(status))) {
        return { blocked: true, reason: `HTTP_${Number(status)}` };
    }

    const rules = [
        { reason: "BIR_DAKIKA_LUTFEN", pattern: /bir dakika lütfen|bir dakika lutfen/ },
        { reason: "CAPTCHA", pattern: /captcha|recaptcha|hcaptcha/ },
        { reason: "BOT_PROTECTION", pattern: /bot protection|bot koruması|bot korumasi|robot check/ },
        { reason: "ACCESS_DENIED", pattern: /access denied|erişim engellendi|erisim engellendi/ },
        { reason: "CLOUDFLARE_CHALLENGE", pattern: /cloudflare|cf-challenge|challenge-platform|just a moment/ },
        { reason: "VERIFY_HUMAN", pattern: /verify you are human|insan olduğunuzu doğrulayın|insan oldugunuzu dogrulayin/ },
    ];

    const found = rules.find((rule) => rule.pattern.test(haystack));
    return found ? { blocked: true, reason: found.reason } : { blocked: false, reason: null };
}
