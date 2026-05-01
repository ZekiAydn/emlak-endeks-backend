import prisma from "../prisma.js";
import {
    comparableSearchText,
    normalizePropertyText,
    propertyCategory,
    valuationType,
} from "./propertyCategory.js";
import {
    TARGET_TOTAL,
    comparableUnitPrice,
    toNumber,
    uniqueComparables,
} from "./comparablePolicy.js";
import {
    comparableImageCacheDbFields,
    comparableImageCacheFromListing,
} from "./comparableImageCache.js";

const CACHE_PROVIDER = "DB_CACHE";
const CACHE_QUERY_LIMIT = 240;
const CACHE_SAVE_TTL_DAYS = 45;
const CACHE_RECHECK_DAYS = 14;

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLocation(value) {
    return normalizePropertyText(value)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeRoom(value) {
    return normalizePropertyText(value).replace(/\s+/g, "").replace(/,/g, ".");
}

function comparableArea(item = {}) {
    return (
        toNumber(item.netArea) ??
        toNumber(item.grossArea) ??
        toNumber(item.netM2) ??
        toNumber(item.grossM2) ??
        toNumber(item.netAreaM2) ??
        toNumber(item.grossAreaM2) ??
        null
    );
}

function toInt(value) {
    const parsed = toNumber(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function isHttpUrl(value) {
    try {
        const parsed = new URL(String(value || ""));
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function isRealListingImage(item = {}) {
    const imageUrl = cleanText(item.imageUrl);
    if (!isHttpUrl(imageUrl)) return false;

    const source = normalizePropertyText(item.imageSource || "");
    if (source.includes("brand") || source.includes("mock")) return false;
    if (source.includes("street view") || source.includes("streetview")) return false;
    if (source.includes("nearby") || source.includes("pool")) return false;

    const lowerUrl = imageUrl.toLocaleLowerCase("tr-TR");
    if (lowerUrl.includes("/comparables/mock-image")) return false;
    if (lowerUrl.includes("/comparables/street-view")) return false;
    if (lowerUrl.includes("maps.googleapis.com/maps/api/streetview")) return false;

    return true;
}

function addDays(days) {
    return new Date(Date.now() + days * 86400000);
}

function cacheScope(criteria = {}) {
    const category = propertyCategory(criteria);
    const transaction = valuationType(criteria);
    const city = cleanText(criteria.city);
    const district = cleanText(criteria.district);
    const neighborhood = cleanText(criteria.neighborhood);
    const propertyType = cleanText(criteria.propertyType || comparableSearchText(criteria));

    return {
        category,
        transaction,
        city,
        district,
        neighborhood,
        propertyType,
        normalizedCity: normalizeLocation(city),
        normalizedDistrict: normalizeLocation(district),
        normalizedNeighborhood: normalizeLocation(neighborhood),
        normalizedPropertyType: normalizeComparableType(propertyType, category),
    };
}

function isCacheEligibleScope(scope) {
    return Boolean(scope.city && scope.district && scope.neighborhood && scope.normalizedNeighborhood);
}

function normalizeComparableType(value, category) {
    const text = cleanText(value);
    if (!text) return "";
    return normalizePropertyText(comparableSearchText({ reportType: category, propertyType: text }) || text);
}

function sameLocation(row = {}, scope = {}) {
    return (
        normalizeLocation(row.city) === scope.normalizedCity &&
        normalizeLocation(row.district) === scope.normalizedDistrict &&
        normalizeLocation(row.neighborhood) === scope.normalizedNeighborhood
    );
}

function hasNeighborhoodEvidence(item = {}, scope = {}) {
    if (!scope.normalizedNeighborhood) return false;

    const address = cleanText(item.address || item.addressText);
    const syntheticAddress = [scope.city, scope.district, scope.neighborhood].filter(Boolean).join(" / ");
    const addressLooksSynthetic =
        address &&
        normalizeLocation(address) === normalizeLocation(syntheticAddress);

    const haystack = normalizePropertyText([
        item.neighborhood,
        addressLooksSynthetic ? "" : address,
        item.title,
        item.description,
        item.snippet,
        item.sourceUrl,
        item.listingUrl,
    ].filter(Boolean).join(" "));
    const compactHaystack = haystack.replace(/\s+/g, "");
    const compactNeedle = scope.normalizedNeighborhood.replace(/\s+/g, "");

    return haystack.includes(scope.normalizedNeighborhood) || compactHaystack.includes(compactNeedle);
}

function compatibleArea(item = {}, subjectArea, category) {
    const target = toNumber(subjectArea);
    const area = comparableArea(item);
    if (!Number.isFinite(area) || area <= 10) return false;
    if (!Number.isFinite(target) || target <= 0) return true;

    const ratio = area / target;
    if (category === "land") return ratio >= 0.35 && ratio <= 3;
    if (category === "commercial") return ratio >= 0.5 && ratio <= 2;
    return ratio >= 0.65 && ratio <= 1.5;
}

function compatibleRoom(item = {}, subjectRoomText, category) {
    if (category !== "residential") return true;
    const target = normalizeRoom(subjectRoomText);
    if (!target) return true;
    return normalizeRoom(item.roomText) === target;
}

function compatiblePropertyType(item = {}, scope = {}) {
    if (!scope.normalizedPropertyType) return true;
    const itemType = normalizeComparableType(item.propertyType || item.reportType || "", scope.category);
    if (!itemType) return false;
    return itemType === scope.normalizedPropertyType;
}

function roomParts(roomText) {
    const match = cleanText(roomText).match(/(\d+)\s*\+\s*(\d+)/);
    if (!match) return { roomCount: null, salonCount: null };
    return {
        roomCount: Number(match[1]),
        salonCount: Number(match[2]),
    };
}

function imageSourceEnum(value, item = {}) {
    const source = normalizePropertyText(value || item.imageSource || "");
    const provider = normalizePropertyText(item.provider || item.source || "");

    if (source.includes("json")) return "JSON_LD";
    if (source.includes("twitter")) return "TWITTER_IMAGE";
    if (source.includes("og")) return "OG_IMAGE";
    if (source.includes("gallery") || source.includes("page")) return "PAGE_GALLERY";
    if (source.includes("thumb") || provider.includes("serp") || provider.includes("sahibinden") || provider.includes("emlakjet")) {
        return "SEARCH_THUMBNAIL";
    }
    if (source.includes("duplicate")) return "DUPLICATE_MERGE";
    return "UNKNOWN";
}

function fieldSourceEnum(value, fallback = "UNKNOWN") {
    const source = normalizePropertyText(value);
    if (source.includes("search title")) return "SEARCH_TITLE";
    if (source.includes("search") || source.includes("snippet")) return "SEARCH_SNIPPET";
    if (source.includes("thumb")) return "SEARCH_THUMBNAIL";
    if (source.includes("json")) return "JSON_LD";
    if (source.includes("og")) return "OG_META";
    if (source.includes("twitter")) return "TWITTER_META";
    if (source.includes("html") || source.includes("page")) return "HTML_VISIBLE_TEXT";
    if (source.includes("gallery")) return "PAGE_GALLERY";
    if (source.includes("manual")) return "MANUAL";
    return fallback;
}

function jsonSafe(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function qualityScore(item = {}, options = {}) {
    let score = 0;
    if (isRealListingImage(item)) score += 30;
    if (Number.isFinite(toNumber(item.price))) score += 18;
    if (Number.isFinite(comparableArea(item))) score += 18;
    if (cleanText(item.roomText)) score += 10;
    if (compatibleRoom(item, options.subjectRoomText, options.category)) score += 10;
    if (compatibleArea(item, options.subjectArea, options.category)) score += 10;
    if (item.sourceUrl || item.listingUrl) score += 4;
    return Math.min(100, score);
}

function validateCacheWritable(item = {}, criteria = {}, options = {}) {
    const scope = cacheScope(criteria);
    const sourceUrl = cleanText(item.sourceUrl || item.listingUrl);
    const price = toNumber(item.price);
    const area = comparableArea(item);

    if (!isCacheEligibleScope(scope)) return { ok: false, reason: "missing_neighborhood_scope" };
    if (!isHttpUrl(sourceUrl)) return { ok: false, reason: "missing_source_url" };
    if (!isRealListingImage(item)) return { ok: false, reason: "missing_real_image" };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "missing_price" };
    if (!Number.isFinite(area) || area <= 10) return { ok: false, reason: "missing_area" };
    if (!compatibleArea(item, options.subjectArea, scope.category)) return { ok: false, reason: "area_not_near_subject" };
    if (!scope.category || !scope.transaction) return { ok: false, reason: "missing_type_or_transaction" };
    if (!scope.propertyType) return { ok: false, reason: "missing_property_type" };
    if (!hasNeighborhoodEvidence(item, scope)) return { ok: false, reason: "neighborhood_not_verified" };
    if (scope.category === "residential" && !cleanText(item.roomText)) return { ok: false, reason: "missing_room" };

    return { ok: true, scope, sourceUrl, price, area };
}

function comparableToCreateUpdate(item = {}, criteria = {}, options = {}) {
    const validation = validateCacheWritable(item, criteria, options);
    if (!validation.ok) return null;

    const { scope, sourceUrl, price, area } = validation;
    const netArea = toNumber(item.netArea) || toNumber(item.netM2) || null;
    const grossArea = toNumber(item.grossArea) || toNumber(item.grossM2) || area;
    const unitPrice = toNumber(item.pricePerSqm) || comparableUnitPrice({ ...item, netArea, grossArea });
    const { roomCount, salonCount } = roomParts(item.roomText);
    const score = qualityScore(item, {
        subjectArea: options.subjectArea,
        subjectRoomText: options.subjectRoomText,
        category: scope.category,
    });
    const now = new Date();
    const source = cleanText(item.source || item.provider || "UNKNOWN").slice(0, 80) || "UNKNOWN";
    const imageCacheFields = comparableImageCacheDbFields(item);

    return {
        where: { sourceUrl },
        create: {
            source,
            externalId: cleanText(item.externalId).slice(0, 160) || null,
            sourceListingId: cleanText(item.sourceListingId || item.externalId).slice(0, 160) || null,
            sourceUrl,
            title: cleanText(item.title).slice(0, 500) || null,
            description: cleanText(item.description || item.snippet).slice(0, 2000) || null,
            price,
            currency: cleanText(item.currency || "TRY") || "TRY",
            pricePerM2: Number.isFinite(unitPrice) ? unitPrice : null,
            city: scope.city,
            district: scope.district,
            neighborhood: scope.neighborhood,
            addressText: cleanText(item.address || item.addressText) || [scope.city, scope.district, scope.neighborhood].filter(Boolean).join(" / "),
            reportType: scope.category,
            valuationType: scope.transaction,
            latitude: toNumber(item.latitude),
            longitude: toNumber(item.longitude),
            grossM2: grossArea,
            netM2: netArea,
            grossAreaM2: grossArea,
            netAreaM2: netArea,
            roomText: cleanText(item.roomText) || null,
            roomCount,
            salonCount,
            propertyType: scope.propertyType,
            buildingAge: toInt(item.buildingAge),
            buildingAgeText: cleanText(item.buildingAgeText) || null,
            floor: toInt(item.floor),
            floorText: cleanText(item.floorText) || null,
            totalFloors: toInt(item.totalFloors),
            totalFloorsText: cleanText(item.totalFloorsText) || null,
            heating: cleanText(item.heating) || null,
            heatingType: cleanText(item.heatingType) || null,
            imageUrl: cleanText(item.imageUrl),
            ...imageCacheFields,
            imageStatus: "REAL",
            imageSource: imageSourceEnum(item.imageSource, item),
            imageFieldSource: fieldSourceEnum(item.imageSource),
            listingUrl: sourceUrl,
            providerRaw: jsonSafe(item),
            parsedRaw: jsonSafe({
                savedBy: "comparable_cache",
                criteria: {
                    city: scope.city,
                    district: scope.district,
                    neighborhood: scope.neighborhood,
                    reportType: scope.category,
                    valuationType: scope.transaction,
                    propertyType: scope.propertyType,
                },
            }),
            rawSearchResultJson: jsonSafe(item.rawSearchResultJson || null),
            rawMetadataJson: jsonSafe({
                sourceMeta: options.sourceMeta || null,
                imageSource: item.imageSource || null,
            }),
            confidenceScore: score,
            missingFields: [],
            comparableGroup: cleanText(item.group) || null,
            pricePerSqm: Number.isFinite(unitPrice) ? unitPrice : null,
            dataQuality: score,
            matchScore: score,
            matchLevel: "NEIGHBORHOOD_EXACT",
            priceSource: fieldSourceEnum(item.priceSource, item.provider === "SERP_SNIPPET" ? "SEARCH_SNIPPET" : "HTML_VISIBLE_TEXT"),
            areaSource: fieldSourceEnum(item.areaSource, item.provider === "SERP_SNIPPET" ? "SEARCH_SNIPPET" : "HTML_VISIBLE_TEXT"),
            roomSource: fieldSourceEnum(item.roomSource, item.provider === "SERP_SNIPPET" ? "SEARCH_SNIPPET" : "HTML_VISIBLE_TEXT"),
            titleSource: fieldSourceEnum(item.titleSource, item.provider === "SERP_SNIPPET" ? "SEARCH_TITLE" : "HTML_VISIBLE_TEXT"),
            freshnessStatus: "FRESH",
            firstSeenAt: now,
            lastSeenAt: now,
            staleAfter: addDays(CACHE_RECHECK_DAYS),
            expiresAt: addDays(CACHE_SAVE_TTL_DAYS),
        },
        update: {
            source,
            externalId: cleanText(item.externalId).slice(0, 160) || null,
            sourceListingId: cleanText(item.sourceListingId || item.externalId).slice(0, 160) || null,
            title: cleanText(item.title).slice(0, 500) || null,
            description: cleanText(item.description || item.snippet).slice(0, 2000) || null,
            price,
            currency: cleanText(item.currency || "TRY") || "TRY",
            pricePerM2: Number.isFinite(unitPrice) ? unitPrice : null,
            city: scope.city,
            district: scope.district,
            neighborhood: scope.neighborhood,
            addressText: cleanText(item.address || item.addressText) || [scope.city, scope.district, scope.neighborhood].filter(Boolean).join(" / "),
            reportType: scope.category,
            valuationType: scope.transaction,
            latitude: toNumber(item.latitude),
            longitude: toNumber(item.longitude),
            grossM2: grossArea,
            netM2: netArea,
            grossAreaM2: grossArea,
            netAreaM2: netArea,
            roomText: cleanText(item.roomText) || null,
            roomCount,
            salonCount,
            propertyType: scope.propertyType,
            buildingAge: toInt(item.buildingAge),
            buildingAgeText: cleanText(item.buildingAgeText) || null,
            floor: toInt(item.floor),
            floorText: cleanText(item.floorText) || null,
            totalFloors: toInt(item.totalFloors),
            totalFloorsText: cleanText(item.totalFloorsText) || null,
            heating: cleanText(item.heating) || null,
            heatingType: cleanText(item.heatingType) || null,
            imageUrl: cleanText(item.imageUrl),
            ...imageCacheFields,
            imageStatus: "REAL",
            imageSource: imageSourceEnum(item.imageSource, item),
            imageFieldSource: fieldSourceEnum(item.imageSource),
            listingUrl: sourceUrl,
            providerRaw: jsonSafe(item),
            parsedRaw: jsonSafe({
                savedBy: "comparable_cache",
                criteria: {
                    city: scope.city,
                    district: scope.district,
                    neighborhood: scope.neighborhood,
                    reportType: scope.category,
                    valuationType: scope.transaction,
                    propertyType: scope.propertyType,
                },
            }),
            rawSearchResultJson: jsonSafe(item.rawSearchResultJson || null),
            rawMetadataJson: jsonSafe({
                sourceMeta: options.sourceMeta || null,
                imageSource: item.imageSource || null,
            }),
            confidenceScore: score,
            missingFields: { set: [] },
            isActive: true,
            comparableGroup: cleanText(item.group) || null,
            pricePerSqm: Number.isFinite(unitPrice) ? unitPrice : null,
            dataQuality: score,
            matchScore: score,
            matchLevel: "NEIGHBORHOOD_EXACT",
            priceSource: fieldSourceEnum(item.priceSource, item.provider === "SERP_SNIPPET" ? "SEARCH_SNIPPET" : "HTML_VISIBLE_TEXT"),
            areaSource: fieldSourceEnum(item.areaSource, item.provider === "SERP_SNIPPET" ? "SEARCH_SNIPPET" : "HTML_VISIBLE_TEXT"),
            roomSource: fieldSourceEnum(item.roomSource, item.provider === "SERP_SNIPPET" ? "SEARCH_SNIPPET" : "HTML_VISIBLE_TEXT"),
            titleSource: fieldSourceEnum(item.titleSource, item.provider === "SERP_SNIPPET" ? "SEARCH_TITLE" : "HTML_VISIBLE_TEXT"),
            freshnessStatus: "FRESH",
            lastSeenAt: now,
            staleAfter: addDays(CACHE_RECHECK_DAYS),
            expiresAt: addDays(CACHE_SAVE_TTL_DAYS),
        },
    };
}

function listingToComparable(row = {}) {
    const netArea = toNumber(row.netM2) ?? toNumber(row.netAreaM2) ?? null;
    const grossArea = toNumber(row.grossM2) ?? toNumber(row.grossAreaM2) ?? null;
    const sourceUrl = row.sourceUrl || row.listingUrl || null;
    const providerRaw = row.providerRaw && typeof row.providerRaw === "object" && !Array.isArray(row.providerRaw)
        ? row.providerRaw
        : {};
    const listingDate = providerRaw.createdAt || providerRaw.listingDate || providerRaw.publishedAt || row.firstSeenAt || row.createdAt;

    return {
        title: row.title || "Cache emsal ilanı",
        source: row.source || "Cache",
        sourceUrl,
        price: toNumber(row.price),
        netArea,
        grossArea,
        roomText: row.roomText || null,
        buildingAge: row.buildingAge ?? null,
        floor: row.floor ?? null,
        floorText: row.floorText || null,
        totalFloors: row.totalFloors ?? null,
        distanceMeters: null,
        imageUrl: row.imageUrl,
        imageOriginalUrl: row.imageOriginalUrl || row.imageUrl || null,
        imageCache: comparableImageCacheFromListing(row),
        imageSource: row.imageSource || "cache",
        address: row.addressText || [row.city, row.district, row.neighborhood].filter(Boolean).join(" / "),
        externalId: row.externalId || `cache:${row.id}`,
        createdAt: listingDate?.toISOString?.() || listingDate || null,
        pricePerSqm: toNumber(row.pricePerSqm) ?? toNumber(row.pricePerM2) ?? comparableUnitPrice({ price: row.price, netArea, grossArea }),
        provider: CACHE_PROVIDER,
        latitude: toNumber(row.latitude),
        longitude: toNumber(row.longitude),
        city: row.city || null,
        district: row.district || null,
        neighborhood: row.neighborhood || null,
        reportType: row.reportType || null,
        valuationType: row.valuationType || null,
        propertyType: row.propertyType || null,
        group: row.comparableGroup || null,
        cacheListingId: row.id,
        isFromCache: true,
    };
}

function cacheWhere(scope = {}) {
    return {
        isActive: true,
        reportType: scope.category,
        valuationType: scope.transaction,
        price: { not: null },
        imageUrl: { not: "" },
        listingUrl: { not: "" },
        OR: [
            { grossAreaM2: { not: null } },
            { netAreaM2: { not: null } },
            { grossM2: { not: null } },
            { netM2: { not: null } },
        ],
        AND: [
            {
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: new Date() } },
                ],
            },
            {
                freshnessStatus: "FRESH",
            },
        ],
        city: { equals: scope.city, mode: "insensitive" },
        district: { equals: scope.district, mode: "insensitive" },
    };
}

function rowMatchesCriteria(row = {}, criteria = {}, options = {}) {
    const scope = cacheScope(criteria);
    if (!sameLocation(row, scope)) return false;
    if (row.reportType !== scope.category) return false;
    if (row.valuationType !== scope.transaction) return false;
    if (!isRealListingImage(row)) return false;
    if (!compatibleArea(row, options.subjectArea, scope.category)) return false;
    if (!compatibleRoom(row, options.subjectRoomText, scope.category)) return false;
    if (!compatiblePropertyType(row, scope)) return false;
    return true;
}

async function queryComparableRows(scope) {
    const baseWhere = cacheWhere(scope);
    const primaryWhere = {
        ...baseWhere,
        AND: [
            ...(baseWhere.AND || []),
            {
                OR: [
                    { neighborhood: { equals: scope.neighborhood, mode: "insensitive" } },
                    { neighborhood: { contains: scope.neighborhood, mode: "insensitive" } },
                ],
            },
        ],
    };

    const primary = await prisma.comparableListing.findMany({
        where: primaryWhere,
        orderBy: [
            { dataQuality: "desc" },
            { lastSeenAt: "desc" },
        ],
        take: CACHE_QUERY_LIMIT,
    });

    if (primary.length) return primary;

    return prisma.comparableListing.findMany({
        where: baseWhere,
        orderBy: [
            { dataQuality: "desc" },
            { lastSeenAt: "desc" },
        ],
        take: CACHE_QUERY_LIMIT,
    });
}

async function findCachedComparables(criteria = {}, options = {}) {
    const scope = cacheScope(criteria);
    if (!isCacheEligibleScope(scope)) {
        console.log("[COMPARABLE_CACHE] skip lookup", {
            reason: "missing_neighborhood_scope",
            city: scope.city,
            district: scope.district,
            neighborhood: scope.neighborhood,
        });
        return [];
    }

    try {
        console.log("[COMPARABLE_CACHE] lookup start", {
            city: scope.city,
            district: scope.district,
            neighborhood: scope.neighborhood,
            reportType: scope.category,
            valuationType: scope.transaction,
            propertyType: scope.propertyType,
            subjectArea: options.subjectArea || null,
            subjectRoomText: options.subjectRoomText || null,
        });

        const rows = await queryComparableRows(scope);
        const comparables = uniqueComparables(rows.map(listingToComparable))
            .filter((item) => rowMatchesCriteria(item, criteria, options))
            .slice(0, Math.max(TARGET_TOTAL * 2, TARGET_TOTAL));

        console.log("[COMPARABLE_CACHE] lookup finish", {
            dbRows: rows.length,
            matched: comparables.length,
            imageCount: comparables.filter(isRealListingImage).length,
        });

        return comparables;
    } catch (error) {
        console.warn("[COMPARABLE_CACHE] lookup failed", {
            message: String(error.message || error),
        });
        return [];
    }
}

function incrementReason(stats, reason) {
    stats.skipped += 1;
    stats.skipReasons[reason] = (stats.skipReasons[reason] || 0) + 1;
}

async function saveComparableListings(comparables = [], criteria = {}, options = {}) {
    const items = uniqueComparables(Array.isArray(comparables) ? comparables : []);
    const stats = {
        attempted: items.length,
        saved: 0,
        skipped: 0,
        skipReasons: {},
    };

    if (!items.length) return stats;

    const scope = cacheScope(criteria);
    if (!isCacheEligibleScope(scope)) {
        stats.skipped = items.length;
        stats.skipReasons.missing_neighborhood_scope = items.length;
        console.log("[COMPARABLE_CACHE] save skipped", {
            reason: "missing_neighborhood_scope",
            attempted: items.length,
        });
        return stats;
    }

    console.log("[COMPARABLE_CACHE] save start", {
        attempted: items.length,
        city: scope.city,
        district: scope.district,
        neighborhood: scope.neighborhood,
        reportType: scope.category,
        valuationType: scope.transaction,
    });

    for (const item of items) {
        const payload = comparableToCreateUpdate(item, criteria, {
            ...options,
            sourceMeta: options.sourceMeta,
        });

        if (!payload) {
            const validation = validateCacheWritable(item, criteria, options);
            incrementReason(stats, validation.reason || "invalid");
            continue;
        }

        try {
            await prisma.comparableListing.upsert(payload);
            stats.saved += 1;
        } catch (error) {
            incrementReason(stats, "db_error");
            console.warn("[COMPARABLE_CACHE] upsert failed", {
                sourceUrl: payload.where?.sourceUrl,
                message: String(error.message || error),
            });
        }
    }

    console.log("[COMPARABLE_CACHE] save finish", stats);
    return stats;
}

function cachedProviderBundle(comparables = []) {
    return {
        comparables,
        groups: {},
        marketProjection: null,
        regionalStats: null,
        priceBand: null,
        warnings: [],
        sourceMeta: {
            provider: CACHE_PROVIDER,
            fetchedAt: new Date().toISOString(),
            scope: "neighborhood",
            recordCount: comparables.length,
            sampleCount: comparables.length,
            cacheHit: comparables.length > 0,
        },
    };
}

export {
    CACHE_PROVIDER,
    cachedProviderBundle,
    findCachedComparables,
    isRealListingImage,
    saveComparableListings,
};
