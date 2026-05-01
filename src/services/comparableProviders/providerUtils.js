import crypto from "node:crypto";
import { comparableSearchText, normalizePropertyText, propertyCategory, valuationType } from "../propertyCategory.js";
import { toNumber } from "../comparablePolicy.js";

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function slugifyTr(value) {
    return cleanText(value)
        .toLocaleLowerCase("tr-TR")
        .replace(/\bmahallesi\b|\bmahalle\b|\bmah\b|\bmh\b/gi, "")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/İ/g, "i")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function parsePrice(value) {
    const number = toNumber(value);
    return Number.isFinite(number) ? Math.round(number) : null;
}

function parseArea(value) {
    const number = toNumber(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function parseBuildingAge(value) {
    const text = cleanText(value).toLocaleLowerCase("tr-TR");
    if (!text) return null;
    if (/sıfır|sifir|yeni/.test(text)) return 0;
    const number = toNumber(text);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function parseFloorValue(value) {
    const text = cleanText(value).toLocaleLowerCase("tr-TR");
    if (!text) return null;
    if (/bahçe|bahce|zemin|giriş|giris/.test(text)) return 0;
    if (/bodrum/.test(text)) {
        const number = toNumber(text);
        return Number.isFinite(number) ? -Math.abs(number) : -1;
    }
    const number = toNumber(text);
    return Number.isFinite(number) ? number : null;
}

function parseDateToIso(value) {
    const text = cleanText(value);
    if (!text) return new Date().toISOString();

    const trDate = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (trDate) {
        const [, day, month, year] = trDate;
        const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00+03:00`);
        return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function absoluteUrl(value, baseUrl) {
    const text = cleanText(value);
    if (!text) return null;
    try {
        return new URL(text, baseUrl).toString();
    } catch {
        return null;
    }
}

function hashExternalId(prefix, value) {
    return `${prefix}:${crypto.createHash("sha1").update(cleanText(value)).digest("hex").slice(0, 16)}`;
}

function propertyTypeSlug(criteria = {}) {
    const category = propertyCategory(criteria);
    if (category === "land") return "arsa";
    if (category === "commercial") return "isyeri";

    const text = comparableSearchText(criteria);
    if (text.includes("villa")) return "villa";
    if (text.includes("residence")) return "residence";
    if (text.includes("müstakil") || text.includes("mustakil")) return "mustakil-ev";
    return "daire";
}

function listingTypeSlug(criteria = {}) {
    return valuationType(criteria) === "rental" ? "kiralik" : "satilik";
}

function roomText(value) {
    const text = cleanText(value).replace(/\s+/g, "");
    return text || null;
}

function normalizeProviderComparable(item = {}, criteria = {}, provider) {
    const price = parsePrice(item.price);
    const grossArea = parseArea(item.grossArea);
    const netArea = parseArea(item.netArea);
    const area = netArea || grossArea;

    if (!item.sourceUrl || !Number.isFinite(price) || !Number.isFinite(area) || !item.imageUrl) {
        return null;
    }

    return {
        title: cleanText(item.title) || `${criteria.district || criteria.city || "Bölge"} emsal ilanı`,
        source: item.source || provider.source,
        sourceUrl: item.sourceUrl,
        price,
        currency: item.currency || "TRY",
        netArea: Number.isFinite(netArea) ? netArea : null,
        grossArea: Number.isFinite(grossArea) ? grossArea : null,
        roomText: roomText(item.roomText),
        buildingAge: parseBuildingAge(item.buildingAge ?? item.buildingAgeText),
        buildingAgeText: cleanText(item.buildingAgeText ?? item.buildingAge) || null,
        floor: parseFloorValue(item.floor ?? item.floorText),
        floorText: cleanText(item.floorText ?? item.floor) || null,
        totalFloors: Number.isFinite(toNumber(item.totalFloors)) ? toNumber(item.totalFloors) : null,
        totalFloorsText: cleanText(item.totalFloorsText) || null,
        distanceMeters: null,
        imageUrl: item.imageUrl,
        imageSource: item.imageSource || "PAGE_LIST",
        address: cleanText(item.address) || [criteria.city, criteria.district, criteria.neighborhood].filter(Boolean).join(" / ") || null,
        externalId: item.externalId || hashExternalId(provider.idPrefix, item.sourceUrl),
        sourceListingId: cleanText(item.sourceListingId) || null,
        createdAt: parseDateToIso(item.createdAt || item.listingDate),
        listingDate: item.listingDate ? parseDateToIso(item.listingDate) : null,
        pricePerSqm: Number.isFinite(toNumber(item.pricePerSqm)) ? Math.round(toNumber(item.pricePerSqm)) : Math.round(price / area),
        provider: provider.name,
        latitude: Number.isFinite(toNumber(item.latitude)) ? toNumber(item.latitude) : null,
        longitude: Number.isFinite(toNumber(item.longitude)) ? toNumber(item.longitude) : null,
        city: cleanText(item.city) || cleanText(criteria.city) || null,
        district: cleanText(item.district) || cleanText(criteria.district) || null,
        neighborhood: cleanText(item.neighborhood) || cleanText(criteria.neighborhood) || null,
        reportType: propertyCategory(criteria),
        valuationType: valuationType(criteria),
        propertyType: cleanText(item.propertyType) || propertyTypeSlug(criteria),
        heating: cleanText(item.heating) || null,
        rawSearchResultJson: item.rawSearchResultJson || null,
        imageCount: Number.isFinite(toNumber(item.imageCount)) ? toNumber(item.imageCount) : null,
        description: cleanText(item.description) || null,
    };
}

export {
    absoluteUrl,
    cleanText,
    hashExternalId,
    listingTypeSlug,
    normalizeProviderComparable,
    parseArea,
    parseBuildingAge,
    parseDateToIso,
    parseFloorValue,
    parsePrice,
    propertyTypeSlug,
    roomText,
    slugifyTr,
};
