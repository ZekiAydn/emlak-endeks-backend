import crypto from "node:crypto";
import {
    comparableSearchText,
    propertyCategory,
    valuationType,
} from "../propertyCategory.js";
import {
    TARGET_TOTAL,
    toNumber,
    uniqueComparables,
} from "../comparablePolicy.js";

const PROVIDER = "APIFY_EMLAKJET";
const DEFAULT_ACTOR_ID = "seralifatih/turkish-real-estate-api-1";
const DEFAULT_WAIT_SECS = 40;
const DEFAULT_MAX_LISTINGS = 24;

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function slugifyTr(value) {
    return cleanText(value)
        .toLocaleLowerCase("tr-TR")
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

function firstText(...values) {
    return values.map(cleanText).find(Boolean) || null;
}

function firstArrayItem(...values) {
    for (const value of values) {
        if (Array.isArray(value) && value.length) return value[0];
        if (typeof value === "string" && value) return value;
    }
    return null;
}

function parseNumber(value) {
    return toNumber(value);
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

function roomLabelFromItem(item = {}) {
    if (item.roomLayout?.label) return cleanText(item.roomLayout.label);
    if (item.specifications?.["Oda Sayısı"]) return cleanText(item.specifications["Oda Sayısı"]);
    return cleanText(item.roomText || item.rooms) || null;
}

function parseFloorValue(value) {
    if (value && typeof value === "object") return parseNumber(value.floor);
    const text = cleanText(value);
    if (/bahçe|bahce|zemin|giriş|giris/i.test(text)) return 0;
    return parseNumber(text);
}

function parseTotalFloors(value) {
    if (value && typeof value === "object") return parseNumber(value.totalFloors);
    return parseNumber(value);
}

function parseBuildingAge(value) {
    const text = cleanText(value);
    if (!text) return null;
    if (/^(sıfır|sifir|0)(?:\b|$)/i.test(text)) return 0;
    const number = parseNumber(text);
    return Number.isFinite(number) ? number : null;
}

function dateIso(value) {
    const text = cleanText(value);
    if (!text) return new Date().toISOString();
    const parsed = new Date(text.replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeApifyListing(item = {}, criteria = {}) {
    const priceObject = item.price && typeof item.price === "object" ? item.price : null;
    const specs = item.specifications && typeof item.specifications === "object" ? item.specifications : {};
    const sourceUrl = firstText(item.url, item.listingUrl, item.sourceUrl);
    const price = parseNumber(priceObject?.amount ?? item.price ?? item.priceAmount);
    const grossArea = parseNumber(item.grossArea ?? item.grossSize ?? specs["Brüt Metrekare"] ?? specs["Brüt m²"] ?? specs["Brüt Alan"]);
    const netArea = parseNumber(item.netArea ?? item.netSize ?? specs["Net Metrekare"] ?? specs["Net m²"]);
    const imageUrl = firstArrayItem(item.imageUrls, item.images, item.photos, item.photoUrls, item.imageUrl);

    if (!sourceUrl || !Number.isFinite(price) || !Number.isFinite(grossArea || netArea) || !imageUrl) {
        return null;
    }

    const listingId = cleanText(item.listingId) || cleanText(sourceUrl.match(/(\d{6,})/)?.[1]) || null;
    const normalizedPropertyType = cleanText(item.propertyType) || propertyTypeSlug(criteria);
    const floor = parseFloorValue(item.floor ?? specs["Bulunduğu Kat"]);
    const totalFloors = parseTotalFloors(item.floor ?? specs["Binanın Kat Sayısı"]);
    const buildingAgeText = cleanText(item.buildingAge || specs["Binanın Yaşı"]) || null;
    const imageCount = Array.isArray(item.imageUrls) ? item.imageUrls.length : parseNumber(item.imageCount);

    return {
        title: firstText(item.title, item.name) || "Emlakjet emsal ilanı",
        source: "Emlakjet",
        sourceUrl,
        price,
        currency: cleanText(priceObject?.currency || item.currency || "TRY") || "TRY",
        netArea: Number.isFinite(netArea) ? netArea : null,
        grossArea: Number.isFinite(grossArea) ? grossArea : null,
        roomText: roomLabelFromItem(item),
        buildingAge: parseBuildingAge(buildingAgeText),
        buildingAgeText,
        floor: Number.isFinite(floor) ? floor : null,
        floorText: cleanText(specs["Bulunduğu Kat"]) || null,
        totalFloors: Number.isFinite(totalFloors) ? totalFloors : null,
        totalFloorsText: cleanText(specs["Binanın Kat Sayısı"]) || null,
        distanceMeters: null,
        imageUrl,
        imageSource: "PAGE_GALLERY",
        address: firstText(item.fullAddress, item.address, [item.city, item.district, item.neighborhood].filter(Boolean).join(" / ")),
        externalId: listingId ? `emlakjet:${listingId}` : `apify-emlakjet:${crypto.createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16)}`,
        sourceListingId: listingId,
        createdAt: dateIso(item.listingDate || item.scrapedAt),
        pricePerSqm: parseNumber(item.pricePerSqm) || (Number.isFinite(grossArea) && grossArea > 0 ? Math.round(price / grossArea) : null),
        provider: PROVIDER,
        latitude: parseNumber(item.latitude),
        longitude: parseNumber(item.longitude),
        city: firstText(item.city, criteria.city),
        district: firstText(item.district, criteria.district),
        neighborhood: firstText(item.neighborhood, criteria.neighborhood),
        reportType: propertyCategory(criteria),
        valuationType: valuationType(criteria),
        propertyType: normalizedPropertyType,
        heating: cleanText(item.heating) || null,
        rawSearchResultJson: null,
        imageCount: Number.isFinite(imageCount) ? imageCount : null,
        description: cleanText(item.description) || null,
    };
}

function maxListings(options = {}) {
    const existingCount = Number(options.existingComparableCount || 0);
    const desired = Math.max(TARGET_TOTAL, TARGET_TOTAL - existingCount + 6);
    return Math.max(6, Math.min(desired || DEFAULT_MAX_LISTINGS, 36));
}

function buildApifyInput(criteria = {}, options = {}) {
    const city = slugifyTr(criteria.city);
    const district = slugifyTr(criteria.district);
    const neighborhood = slugifyTr(criteria.neighborhood);
    const listingType = listingTypeSlug(criteria);
    const propertyType = propertyTypeSlug(criteria);
    const room = propertyCategory(criteria) === "residential" ? cleanText(options.subjectRoomText) : "";
    const area = parseNumber(options.subjectArea);
    const areaMin = Number.isFinite(area) && area > 0 ? Math.round(area * 0.65) : undefined;
    const areaMax = Number.isFinite(area) && area > 0 ? Math.round(area * 1.5) : undefined;
    const searchUrls = city && district && neighborhood
        ? [`https://www.emlakjet.com/${listingType}-${propertyType}/${city}-${district}-${neighborhood}-mahallesi`]
        : [];

    return {
        ...(searchUrls.length ? { searchUrls } : {}),
        filters: {
            listingType,
            propertyType,
            ...(city ? { city } : {}),
            ...(district ? { district } : {}),
            ...(room ? { rooms: room } : {}),
            ...(areaMin ? { areaMin } : {}),
            ...(areaMax ? { areaMax } : {}),
        },
        maxListings: maxListings(options),
        scrapeDetails: true,
        proxyConfig: { useApifyProxy: true },
    };
}

async function apifyJson(url, token, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...(options.headers || {}),
        },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(`Apify ${response.status}: ${JSON.stringify(json).slice(0, 600)}`);
    }
    return json;
}

async function abortRun(runId, token) {
    if (!runId) return;
    try {
        await apifyJson(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}/abort`, token, {
            method: "POST",
        });
    } catch (error) {
        console.warn("[APIFY_EMLAKJET] abort failed", {
            runId,
            message: String(error.message || error),
        });
    }
}

async function runActor(input) {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
        return {
            run: null,
            items: [],
            warnings: ["APIFY_EMLAKJET: APIFY_TOKEN tanımlı değil"],
        };
    }

    const actorId = (process.env.APIFY_EMLAKJET_ACTOR_ID || DEFAULT_ACTOR_ID).replace("/", "~");
    const waitSecs = DEFAULT_WAIT_SECS;
    const runUrl = new URL(`https://api.apify.com/v2/acts/${actorId}/runs`);
    runUrl.searchParams.set("waitForFinish", String(waitSecs));

    const runResponse = await apifyJson(runUrl, token, {
        method: "POST",
        body: JSON.stringify(input),
    });
    const run = runResponse.data;

    if (!run?.defaultDatasetId) {
        return {
            run,
            items: [],
            warnings: [`APIFY_EMLAKJET: actor dataset üretmedi (status: ${run?.status || "UNKNOWN"})`],
        };
    }

    if (run.status !== "SUCCEEDED") {
        await abortRun(run.id, token);
        return {
            run,
            items: [],
            warnings: [`APIFY_EMLAKJET: actor zamanında tamamlanmadı (status: ${run.status})`],
        };
    }

    const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`);
    datasetUrl.searchParams.set("clean", "true");
    datasetUrl.searchParams.set("format", "json");

    const items = await apifyJson(datasetUrl, token);
    return {
        run,
        items: Array.isArray(items) ? items : [],
        warnings: [],
    };
}

async function fetchApifyEmlakjetComparableBundle(criteria = {}, options = {}) {
    if (!criteria.city && !criteria.district && !criteria.neighborhood) return null;

    const input = buildApifyInput(criteria, options);
    console.log("[APIFY_EMLAKJET] run start", {
        city: criteria.city,
        district: criteria.district,
        neighborhood: criteria.neighborhood,
        maxListings: input.maxListings,
        hasToken: Boolean(process.env.APIFY_TOKEN),
    });

    const { run, items, warnings } = await runActor(input);
    const comparables = uniqueComparables(
        items.map((item) => normalizeApifyListing(item, criteria)).filter(Boolean)
    );

    console.log("[APIFY_EMLAKJET] run finish", {
        runId: run?.id || null,
        status: run?.status || null,
        rawCount: items.length,
        comparableCount: comparables.length,
    });

    return {
        comparables,
        groups: {},
        marketProjection: null,
        regionalStats: null,
        priceBand: null,
        warnings,
        sourceMeta: {
            provider: PROVIDER,
            fetchedAt: new Date().toISOString(),
            scope: criteria.neighborhood ? "neighborhood" : criteria.district ? "district" : "city",
            recordCount: items.length,
            sampleCount: comparables.length,
            actorId: process.env.APIFY_EMLAKJET_ACTOR_ID || DEFAULT_ACTOR_ID,
            actorRunId: run?.id || null,
            actorStatus: run?.status || null,
            datasetId: run?.defaultDatasetId || null,
            input,
        },
    };
}

export {
    fetchApifyEmlakjetComparableBundle,
    normalizeApifyListing,
    buildApifyInput,
};
