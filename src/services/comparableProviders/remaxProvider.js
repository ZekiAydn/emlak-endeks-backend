import * as cheerio from "cheerio";
import { comparableSearchText, propertyCategory, valuationType } from "../propertyCategory.js";
import { TARGET_TOTAL, toNumber, uniqueComparables } from "../comparablePolicy.js";
import {
    cleanText,
    listingTypeSlug,
    normalizeProviderComparable,
    parseBuildingAge,
    propertyTypeSlug,
    slugifyTr,
} from "./providerUtils.js";

const PROVIDER = "REMAX_PUBLIC";
const API_URL = "https://remaxsiteapi.remax.com.tr/api/Property/GetPropertySearchByQuery";
const MAX_LISTINGS = 36;

const ISTANBUL_ANATOLIAN_DISTRICTS = new Set([
    "adalar",
    "atasehir",
    "beykoz",
    "cekmekoy",
    "kadikoy",
    "kartal",
    "maltepe",
    "pendik",
    "sancaktepe",
    "sile",
    "sultanbeyli",
    "tuzla",
    "umraniye",
    "uskudar",
]);

function remaxCitySlug(criteria = {}) {
    const city = slugifyTr(criteria.city);
    const district = slugifyTr(criteria.district);
    const rawCity = `${criteria.city || ""}`.toLocaleLowerCase("tr-TR");

    if (city.includes("istanbul-anadolu")) return "istanbul-anadolu";
    if (city.includes("istanbul-avrupa")) return "istanbul-avrupa";
    if (city === "istanbul" || rawCity.includes("istanbul")) {
        return ISTANBUL_ANATOLIAN_DISTRICTS.has(district) ? "istanbul-anadolu" : "istanbul-avrupa";
    }

    return city;
}

function remaxSubCategory(criteria = {}) {
    const category = propertyCategory(criteria);
    const text = comparableSearchText(criteria);
    const normalized = slugifyTr(text);

    if (category === "land") return normalized.includes("tarla") ? "tarla" : "arsa";
    if (category === "commercial") {
        if (/ofis|buro/.test(normalized)) return "ofis";
        if (/depo/.test(normalized)) return "depo";
        if (/fabrika|imalathane|atolye/.test(normalized)) return "fabrika";
        if (/plaza/.test(normalized)) return "plaza-kati";
        return "dukkan-magaza";
    }

    if (normalized.includes("villa")) return "villa";
    if (normalized.includes("residence")) return "rezidans";
    if (normalized.includes("mustakil")) return "mustakil-ev";
    return "daire";
}

function remaxCategory(criteria = {}) {
    const category = propertyCategory(criteria);
    if (category === "land") return "arsa-arazi";
    if (category === "commercial") return "ticari";
    return "konut";
}

function maxListings(options = {}) {
    const existingCount = Number(options.existingComparableCount || 0);
    const desired = Math.max(TARGET_TOTAL, TARGET_TOTAL - existingCount + 8);
    return Math.max(8, Math.min(desired || MAX_LISTINGS, MAX_LISTINGS));
}

function buildQueryStrings(criteria = {}, options = {}) {
    const city = remaxCitySlug(criteria);
    const towns = slugifyTr(criteria.district);
    const neighborhood = slugifyTr(criteria.neighborhood);
    const neighborhoods = neighborhood ? `${neighborhood}-mah` : "";

    return {
        category: remaxCategory(criteria),
        operation: listingTypeSlug(criteria),
        subcategory: remaxSubCategory(criteria),
        city,
        towns,
        neighborhoods,
        minPrice: "",
        maxPrice: "",
        currencyId: "1",
        attributes: "",
        page: "",
        sort: "13,desc",
        countryId: "",
        perPage: String(maxListings(options)),
        lat: "",
        lon: "",
        radiusKm: "",
        homeSectionType: "",
        officeId: "",
        employeeId: "",
    };
}

function buildRequestBody(criteria = {}, options = {}) {
    const perPage = maxListings(options);
    const queryStrings = buildQueryStrings(criteria, options);

    return {
        queryStrings,
        pagination: {
            page: 1,
            pages: 1,
            perpage: perPage,
            total: 1,
        },
        sort: {
            sort: "desc",
            field: 13,
        },
        query: {
            statusIds: [1],
            showOnWeb: true,
            justGetOnlyCategory: false,
        },
    };
}

function stripHtml(value) {
    if (!value) return null;
    return cleanText(cheerio.load(String(value)).text());
}

function localizedText(value) {
    if (!Array.isArray(value)) return cleanText(value) || null;
    return cleanText(value.find((item) => Number(item.languageId) === 1)?.text || value[0]?.text) || null;
}

function buildingAgeFromAttributes(attributes = {}) {
    const raw = attributes?.["140"];
    const number = toNumber(raw);
    if (!Number.isFinite(number)) return null;

    const currentYear = new Date().getFullYear();
    if (number >= 1900 && number <= currentYear + 1) return Math.max(0, currentYear - number);
    return parseBuildingAge(number);
}

function normalizeRemaxListing(item = {}, criteria = {}) {
    const imageUrl = Array.isArray(item.images) ? item.images.find(Boolean) : null;
    const sourceUrl = item.code ? `https://www.remax.com.tr/portfoy/${item.code}` : null;
    const description = localizedText(item.description);

    return normalizeProviderComparable(
        {
            title: localizedText(item.title),
            source: "RE/MAX",
            sourceUrl,
            price: item.priceInfo?.amount,
            currency: item.priceInfo?.amountTypeSymbol === "₺" ? "TRY" : item.priceInfo?.amountTypeSymbol || "TRY",
            netArea: item.m2AreaAttributeName && /net/i.test(item.m2AreaAttributeName) ? item.m2Area : null,
            grossArea: item.m2AreaAttributeName && !/net/i.test(item.m2AreaAttributeName) ? item.m2Area : null,
            roomText: item.roomOptions,
            buildingAge: buildingAgeFromAttributes(item.attributes),
            floorText: item.floor,
            imageUrl,
            imageCount: Array.isArray(item.images) ? item.images.length : null,
            address: item.address,
            sourceListingId: item.code,
            externalId: item.code ? `remax:${item.code}` : null,
            latitude: item.latitude,
            longitude: item.longitude,
            propertyType: propertyTypeSlug(criteria),
            description: stripHtml(description),
            rawSearchResultJson: {
                id: item.id,
                code: item.code,
                realEstateId: item.realEstateId,
                categoryName: item.categoryName,
                operationName: item.operationName,
                createDate: item.createDate,
            },
        },
        criteria,
        { name: PROVIDER, source: "RE/MAX", idPrefix: "remax" }
    );
}

async function fetchRemaxJson(body) {
    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-client-platform": "1",
            languageid: "1",
        },
        body: JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(`RE/MAX ${response.status}: ${text.slice(0, 500)}`);
    }
    return json;
}

async function fetchRemaxComparableBundle(criteria = {}, options = {}) {
    const body = buildRequestBody(criteria, options);

    console.log("[REMAX_PUBLIC] fetch start", {
        city: body.queryStrings.city,
        district: body.queryStrings.towns,
        neighborhood: body.queryStrings.neighborhoods,
        category: body.queryStrings.category,
        subcategory: body.queryStrings.subcategory,
        maxListings: body.queryStrings.perPage,
    });

    let json = await fetchRemaxJson(body);
    let rows = Array.isArray(json?.data?.data) ? json.data.data : [];
    let recordCount = Number(json?.data?.recordCount || rows.length);
    let queryStrings = body.queryStrings;

    if (!rows.length && body.queryStrings.neighborhoods) {
        const districtBody = {
            ...body,
            queryStrings: {
                ...body.queryStrings,
                neighborhoods: "",
            },
        };
        json = await fetchRemaxJson(districtBody);
        rows = Array.isArray(json?.data?.data) ? json.data.data : [];
        recordCount = Number(json?.data?.recordCount || rows.length);
        queryStrings = districtBody.queryStrings;
    }

    const comparables = uniqueComparables(
        rows
            .map((item) => normalizeRemaxListing(item, criteria))
            .filter(Boolean)
    );

    console.log("[REMAX_PUBLIC] fetch finish", {
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
            scope: queryStrings.neighborhoods ? "neighborhood" : queryStrings.towns ? "district" : "city",
            recordCount,
            sampleCount: comparables.length,
            apiUsed: true,
            queryStrings,
            confidence: "high",
        },
        warnings: comparables.length ? [] : ["REMAX_PUBLIC: emsal bulunamadı"],
    };
}

export {
    buildRequestBody as buildRemaxRequestBody,
    fetchRemaxComparableBundle,
    normalizeRemaxListing,
};
