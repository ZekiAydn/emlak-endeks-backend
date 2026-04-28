import crypto from "node:crypto";
import { parseComparableFromText } from "./parseComparableFromText.js";
import { calculateComparableConfidence } from "./calculateComparableConfidence.js";
import { getDefaultComparableImage } from "./defaultComparableImage.js";
import { sanitizeListingUrl } from "./dedupeComparableListings.js";

const KNOWN_SOURCES = new Set(["HEPSIEMLAK", "EMLAKJET", "REMAX", "SAHIBINDEN", "OTHER"]);

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function nullIfEmpty(value) {
    const text = cleanString(value);
    return text || null;
}

function toNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    let text = String(value).trim().replace(/\s/g, "").replace(/[^\d.,-]/g, "");
    if (!text || text === "-") return null;

    const commaCount = (text.match(/,/g) || []).length;
    const dotCount = (text.match(/\./g) || []).length;

    if (commaCount && dotCount) {
        if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
            text = text.replace(/\./g, "").replace(",", ".");
        } else {
            text = text.replace(/,/g, "");
        }
    } else if (commaCount > 1) {
        text = text.replace(/,/g, "");
    } else if (dotCount > 1) {
        text = text.replace(/\./g, "");
    } else if (commaCount === 1) {
        const [head, tail] = text.split(",");
        text = tail.length === 3 && head.length <= 3 ? `${head}${tail}` : `${head}.${tail}`;
    } else if (dotCount === 1) {
        const [head, tail] = text.split(".");
        text = tail.length === 3 && head.length <= 3 ? `${head}${tail}` : text;
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
    const number = toNumber(value);
    return Number.isFinite(number) ? Math.round(number) : null;
}

export function detectComparableSource(urlOrSource) {
    const explicit = cleanString(urlOrSource).toUpperCase();
    if (KNOWN_SOURCES.has(explicit)) return explicit;

    let host = "";
    try {
        host = new URL(cleanString(urlOrSource)).hostname.toLowerCase();
    } catch {
        host = cleanString(urlOrSource).toLowerCase();
    }

    if (host.includes("hepsiemlak.com")) return "HEPSIEMLAK";
    if (host.includes("emlakjet.com")) return "EMLAKJET";
    if (host.includes("remax.com.tr")) return "REMAX";
    if (host.includes("sahibinden.com")) return "SAHIBINDEN";
    return "OTHER";
}

function buildExternalId(listingUrl) {
    const normalized = sanitizeListingUrl(listingUrl);
    if (!normalized) return null;
    return `url:${crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16)}`;
}

function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
}

function missingFieldsFor(item) {
    const missing = [];
    if (!Number.isFinite(Number(item.price))) missing.push("price");
    if (!Number.isFinite(Number(item.grossM2))) missing.push("grossM2");
    if (!Number.isFinite(Number(item.netM2))) missing.push("netM2");
    if (!Number.isInteger(Number(item.roomCount))) missing.push("roomCount");
    if (!item.addressText) missing.push("addressText");
    if (!item.city) missing.push("city");
    if (!item.district) missing.push("district");
    if (!item.neighborhood) missing.push("neighborhood");
    if (!item.listingUrl) missing.push("listingUrl");
    return missing;
}

function pricePerSqm(price, grossM2, netM2) {
    const area = Number(grossM2) > 0 ? Number(grossM2) : Number(netM2) > 0 ? Number(netM2) : null;
    return Number(price) > 0 && area ? Math.round((Number(price) / area) * 100) / 100 : null;
}

function jsonSafe(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

export function normalizeComparableListing(input = {}, options = {}) {
    const context = options.context || {};
    const listingUrl = sanitizeListingUrl(firstValue(input.listingUrl, input.link, input.url));
    const title = nullIfEmpty(firstValue(input.title, input.name));
    const description = nullIfEmpty(firstValue(input.description, input.snippet));
    const text = [title, description, listingUrl].filter(Boolean).join(" ");
    const parsed = parseComparableFromText(text, {
        city: firstValue(input.city, context.city),
        district: firstValue(input.district, context.district),
        neighborhood: firstValue(input.neighborhood, context.neighborhood),
        addressText: firstValue(input.addressText, input.address, context.addressText),
    });

    const source = detectComparableSource(firstValue(input.source, listingUrl));
    const grossM2 = toNumber(firstValue(input.grossM2, input.grossArea, parsed.grossM2, context.grossM2));
    const netM2 = toNumber(firstValue(input.netM2, input.netArea, parsed.netM2, context.netM2));
    const price = toNumber(firstValue(input.price, parsed.price));
    const propertyType = nullIfEmpty(firstValue(input.propertyType, context.propertyType));

    const normalized = {
        source,
        externalId: nullIfEmpty(firstValue(input.externalId, buildExternalId(listingUrl))),
        title,
        description,
        price,
        currency: cleanString(firstValue(input.currency, "TRY")) || "TRY",
        city: nullIfEmpty(firstValue(input.city, parsed.city, context.city)),
        district: nullIfEmpty(firstValue(input.district, parsed.district, context.district)),
        neighborhood: nullIfEmpty(firstValue(input.neighborhood, parsed.neighborhood, context.neighborhood)),
        addressText: nullIfEmpty(firstValue(input.addressText, input.address, parsed.addressText, context.addressText)),
        grossM2,
        netM2,
        roomCount: toInteger(firstValue(input.roomCount, parsed.roomCount, context.roomCount)),
        salonCount: toInteger(firstValue(input.salonCount, parsed.salonCount, context.salonCount)),
        bathCount: toInteger(firstValue(input.bathCount, context.bathCount)),
        propertyType,
        buildingAge: toInteger(firstValue(input.buildingAge, parsed.buildingAge, context.buildingAge)),
        floor: toInteger(firstValue(input.floor, parsed.floor, context.floor)),
        totalFloors: toInteger(firstValue(input.totalFloors, input.buildingFloors, context.totalFloors, context.buildingFloors)),
        heating: nullIfEmpty(firstValue(input.heating, parsed.heating, context.heating)),
        imageUrl: nullIfEmpty(firstValue(input.imageUrl, input.thumbnail)),
        imageStatus: "DEFAULT",
        listingUrl,
        providerRaw: jsonSafe(input.providerRaw ?? input.raw ?? null),
        parsedRaw: jsonSafe({
            ...(input.parsedRaw || {}),
            ...(parsed.parsedRaw || {}),
        }),
        isManualVerified: Boolean(input.isManualVerified),
        isSelectedForReport: Boolean(input.isSelectedForReport),
        comparableGroup: nullIfEmpty(input.comparableGroup),
    };

    if (!normalized.addressText) {
        normalized.addressText = [normalized.city, normalized.district, normalized.neighborhood].filter(Boolean).join(" / ") || null;
    }

    if (!normalized.imageUrl) {
        normalized.imageUrl = getDefaultComparableImage(normalized.propertyType);
        normalized.imageStatus = "DEFAULT";
    } else {
        normalized.imageStatus = "REAL";
    }

    if (normalized.imageUrl === getDefaultComparableImage(normalized.propertyType)) {
        normalized.imageStatus = "DEFAULT";
    }

    normalized.pricePerSqm = pricePerSqm(normalized.price, normalized.grossM2, normalized.netM2);
    normalized.missingFields = missingFieldsFor(normalized);
    normalized.confidenceScore = calculateComparableConfidence(normalized);

    return normalized;
}

export default normalizeComparableListing;

