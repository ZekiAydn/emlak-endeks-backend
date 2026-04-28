import prisma from "../prisma.js";
import SerpListingProvider from "../providers/serpListingProvider.js";
import { sanitizeListingUrl } from "../helpers/dedupeComparableListings.js";
import { detectComparableSource } from "../helpers/normalizeComparableListing.js";
import { getDefaultComparableImage } from "../helpers/defaultComparableImage.js";
import { generateComparableDiscoveryQueries } from "../helpers/comparableDiscoveryQueries.js";
import {
    extractSearchResultComparableData,
    normalizeTurkishText,
    roomTextToCounts,
} from "../helpers/comparableExtraction.js";
import {
    detectBlockedHtml,
    parseGalleryImages,
    parseJsonLd,
    parseOpenGraph,
    parseTwitterMeta,
    parseVisibleHtmlText,
} from "../helpers/comparableMetadataParsers.js";
import { buildLaunchOptions } from "./headlessBrowser.js";

const SEARCH_ENGINE = "SERPAPI";

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function jsonSafe(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

function addDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
}

function freshnessDates(now = new Date()) {
    return {
        staleAfter: addDays(now, envNumber("COMPARABLE_LISTING_FRESH_DAYS", 90)),
        expiresAt: addDays(now, envNumber("COMPARABLE_STALE_FALLBACK_DAYS", 180)),
    };
}

function emptySummary() {
    return {
        queriesGenerated: 0,
        searchResultsReceived: 0,
        uniqueUrls: 0,
        sourceUrlsCreated: 0,
        sourceUrlsUpdated: 0,
        fetched: 0,
        parsed: 0,
        blocked: 0,
        failed: 0,
        listingsCreated: 0,
        listingsUpdated: 0,
        duplicatesMerged: 0,
    };
}

function sourceFromUrl(url) {
    return detectComparableSource(url || "OTHER");
}

function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
}

function isDefaultImage(url) {
    return cleanString(url) === getDefaultComparableImage();
}

function normalizeImage(url) {
    const cleaned = cleanString(url);
    return cleaned || getDefaultComparableImage();
}

function pricePerM2(price, grossAreaM2, netAreaM2) {
    const area = Number(grossAreaM2) > 0 ? Number(grossAreaM2) : Number(netAreaM2) > 0 ? Number(netAreaM2) : null;
    return Number(price) > 0 && area ? Math.round((Number(price) / area) * 100) / 100 : null;
}

export function calculateComparableDataQuality(listing = {}) {
    let score = 0;
    if (Number(listing.price) > 0) score += 25;
    if (Number(listing.grossAreaM2) > 0 || Number(listing.netAreaM2) > 0 || Number(listing.grossM2) > 0 || Number(listing.netM2) > 0) score += 20;
    if (cleanString(listing.roomText)) score += 15;
    if (cleanString(listing.imageUrl) && !isDefaultImage(listing.imageUrl)) score += 15;
    if (cleanString(listing.city) && cleanString(listing.district) && cleanString(listing.neighborhood)) score += 15;
    if (cleanString(listing.sourceUrl || listing.listingUrl)) score += 10;
    return Math.min(100, score);
}

function sameText(a, b) {
    const left = normalizeTurkishText(a);
    const right = normalizeTurkishText(b);
    return Boolean(left && right && left === right);
}

function similarText(a, b) {
    const left = normalizeTurkishText(a);
    const right = normalizeTurkishText(b);
    if (!left || !right) return false;
    return left.includes(right) || right.includes(left);
}

function comparableArea(listing) {
    return Number(listing?.grossAreaM2) > 0
        ? Number(listing.grossAreaM2)
        : Number(listing?.grossM2) > 0
            ? Number(listing.grossM2)
            : Number(listing?.netAreaM2) > 0
                ? Number(listing.netAreaM2)
                : Number(listing?.netM2) > 0
                    ? Number(listing.netM2)
                    : null;
}

export function calculateComparableMatchScore(listing = {}, input = {}) {
    let score = 0;
    const sameCompound = similarText(listing.compoundName, input.compoundName);
    const sameNeighborhood = sameText(listing.neighborhood, input.neighborhood);
    const sameDistrict = sameText(listing.district, input.district);
    const sameCity = sameText(listing.city, input.city);
    const sameRoom = sameText(listing.roomText, input.roomText);
    const area = comparableArea(listing);
    const subjectArea = Number(input.subjectArea);
    const areaRatio = area && Number.isFinite(subjectArea) && subjectArea > 0
        ? Math.abs(area - subjectArea) / subjectArea
        : null;

    if (sameCompound) score += 35;
    if (sameNeighborhood) score += 25;
    if (sameDistrict) score += 10;
    if (sameRoom) score += 20;
    if (areaRatio !== null && areaRatio <= 0.2) score += 15;
    else if (areaRatio !== null && areaRatio <= 0.3) score += 10;
    if (cleanString(listing.imageUrl) && !isDefaultImage(listing.imageUrl)) score += 5;
    if (Number(listing.dataQuality) >= 80) score += 10;
    else if (Number(listing.dataQuality) >= 60) score += 5;

    let matchLevel = "UNKNOWN";
    if (sameCompound && (sameDistrict || sameNeighborhood) && sameRoom) matchLevel = "PROJECT_EXACT";
    else if (sameNeighborhood && sameRoom) matchLevel = "NEIGHBORHOOD_EXACT";
    else if (sameNeighborhood) matchLevel = "NEIGHBORHOOD_RELAXED";
    else if (sameDistrict && sameRoom && areaRatio !== null && areaRatio <= 0.3) matchLevel = "DISTRICT_ROOM_AREA";
    else if (sameDistrict) matchLevel = "DISTRICT_GENERAL";
    else if (sameCity) matchLevel = "CITY_GENERAL";

    return {
        matchScore: Math.max(0, Math.min(100, score)),
        matchLevel,
    };
}

function enoughSearchData(searchData = {}) {
    const hasPrice = Number(searchData.price) > 0;
    const hasArea = Number(searchData.grossAreaM2 || searchData.netAreaM2) > 0;
    const hasRoom = Boolean(cleanString(searchData.roomText));
    const hasImage = Boolean(cleanString(searchData.imageUrl));
    return (hasPrice && hasArea) || (hasPrice && hasRoom && hasImage) || (hasArea && hasRoom && hasImage);
}

function searchDataFromResult(searchResult = null, fallback = {}) {
    if (!searchResult) return null;
    const extracted = extractSearchResultComparableData(
        {
            title: searchResult.title,
            snippet: searchResult.snippet,
            thumbnailUrl: searchResult.thumbnailUrl,
        },
        {
            city: firstValue(searchResult.city, fallback.city),
            district: firstValue(searchResult.district, fallback.district),
            neighborhood: firstValue(searchResult.neighborhood, fallback.neighborhood),
            compoundName: firstValue(searchResult.compoundName, fallback.compoundName),
            propertyType: firstValue(searchResult.propertyType, fallback.propertyType),
            roomText: firstValue(searchResult.roomText, fallback.roomText),
        }
    );

    return {
        source: sourceFromUrl(searchResult.url),
        sourceUrl: sanitizeListingUrl(searchResult.url),
        title: cleanString(searchResult.title) || null,
        description: cleanString(searchResult.snippet) || null,
        city: extracted.city,
        district: extracted.district,
        neighborhood: extracted.neighborhood,
        compoundName: extracted.compoundName,
        propertyType: extracted.propertyType,
        roomText: extracted.roomText,
        price: extracted.price,
        currency: extracted.currency || "TRY",
        grossAreaM2: extracted.areaM2,
        netAreaM2: null,
        imageUrl: extracted.imageUrl,
        imageSource: extracted.imageUrl ? "SEARCH_THUMBNAIL" : "DEFAULT",
        priceSource: extracted.sources.price,
        areaSource: extracted.sources.area,
        roomSource: extracted.sources.room,
        imageFieldSource: extracted.sources.image,
        titleSource: extracted.sources.title,
        rawSearchResultJson: jsonSafe(searchResult),
        rawExtractedJson: jsonSafe(extracted),
    };
}

function sourceDataFromSourceUrl(record = {}) {
    return {
        source: record.source || sourceFromUrl(record.url),
        sourceUrl: sanitizeListingUrl(record.url),
        title: null,
        description: null,
        city: record.city || null,
        district: record.district || null,
        neighborhood: record.neighborhood || null,
        compoundName: record.compoundName || null,
        propertyType: record.propertyType || null,
        roomText: record.roomText || null,
        price: null,
        currency: "TRY",
        grossAreaM2: null,
        netAreaM2: null,
        imageUrl: null,
        imageSource: "DEFAULT",
        priceSource: "UNKNOWN",
        areaSource: "UNKNOWN",
        roomSource: record.roomText ? "MANUAL" : "UNKNOWN",
        imageFieldSource: "UNKNOWN",
        titleSource: "UNKNOWN",
        rawSearchResultJson: null,
        rawExtractedJson: null,
    };
}

export function mergeExtractedComparable(searchData = {}, metadataData = {}, visibleData = {}, galleryData = {}) {
    const jsonLd = metadataData.jsonLd || {};
    const openGraph = metadataData.openGraph || {};
    const twitter = metadataData.twitter || {};
    const defaultImage = getDefaultComparableImage(searchData.propertyType);

    const title = firstValue(jsonLd.title, openGraph.title, twitter.title, searchData.title);
    const description = firstValue(jsonLd.description, openGraph.description, twitter.description, searchData.description);
    const price = firstValue(jsonLd.price, visibleData.price, openGraph.price, twitter.price, searchData.price);
    const currency = firstValue(jsonLd.currency, visibleData.currency, openGraph.currency, twitter.currency, searchData.currency, "TRY");
    const grossAreaM2 = firstValue(visibleData.areaM2, searchData.grossAreaM2, openGraph.areaM2, twitter.areaM2, jsonLd.areaM2);
    const roomText = firstValue(visibleData.roomText, searchData.roomText, openGraph.roomText, twitter.roomText, jsonLd.roomText);
    const imageUrl = normalizeImage(firstValue(
        jsonLd.imageUrl,
        openGraph.imageUrl,
        twitter.imageUrl,
        galleryData.imageUrl,
        searchData.imageUrl,
        defaultImage
    ));

    let imageSource = "DEFAULT";
    let imageFieldSource = "DEFAULT";
    if (imageUrl === jsonLd.imageUrl) {
        imageSource = "JSON_LD";
        imageFieldSource = "JSON_LD";
    } else if (imageUrl === openGraph.imageUrl) {
        imageSource = "OG_IMAGE";
        imageFieldSource = "OG_META";
    } else if (imageUrl === twitter.imageUrl) {
        imageSource = "TWITTER_IMAGE";
        imageFieldSource = "TWITTER_META";
    } else if (imageUrl === galleryData.imageUrl) {
        imageSource = "PAGE_GALLERY";
        imageFieldSource = "PAGE_GALLERY";
    } else if (imageUrl === searchData.imageUrl) {
        imageSource = "SEARCH_THUMBNAIL";
        imageFieldSource = "SEARCH_THUMBNAIL";
    }

    const priceSource = jsonLd.price
        ? "JSON_LD"
        : visibleData.price
            ? "HTML_VISIBLE_TEXT"
            : openGraph.price
                ? "OG_META"
                : twitter.price
                    ? "TWITTER_META"
                    : searchData.priceSource || "UNKNOWN";

    const areaSource = visibleData.areaM2
        ? "HTML_VISIBLE_TEXT"
        : searchData.grossAreaM2
            ? searchData.areaSource || "SEARCH_SNIPPET"
            : openGraph.areaM2
                ? "OG_META"
                : twitter.areaM2
                    ? "TWITTER_META"
                    : jsonLd.areaM2
                        ? "JSON_LD"
                        : "UNKNOWN";

    const roomSource = visibleData.roomText
        ? "HTML_VISIBLE_TEXT"
        : searchData.roomText
            ? searchData.roomSource || "SEARCH_SNIPPET"
            : openGraph.roomText
                ? "OG_META"
                : twitter.roomText
                    ? "TWITTER_META"
                    : jsonLd.roomText
                        ? "JSON_LD"
                        : "UNKNOWN";

    const titleSource = jsonLd.title
        ? "JSON_LD"
        : openGraph.title
            ? "OG_META"
            : twitter.title
                ? "TWITTER_META"
                : searchData.titleSource || "UNKNOWN";

    return {
        ...searchData,
        title: cleanString(title) || searchData.title || null,
        description: cleanString(description) || searchData.description || null,
        price: Number(price) > 0 ? Number(price) : null,
        currency: cleanString(currency) || "TRY",
        grossAreaM2: Number(grossAreaM2) > 0 ? Number(grossAreaM2) : null,
        netAreaM2: Number(searchData.netAreaM2) > 0 ? Number(searchData.netAreaM2) : null,
        roomText: cleanString(roomText) || null,
        imageUrl,
        imageSource,
        imageFieldSource,
        priceSource,
        areaSource,
        roomSource,
        titleSource,
        propertyType: firstValue(searchData.propertyType, visibleData.propertyType, openGraph.propertyType, twitter.propertyType, jsonLd.propertyType),
        rawMetadataJson: jsonSafe(metadataData),
        rawExtractedJson: jsonSafe({
            searchData,
            visibleData,
            galleryData,
            mergedAt: new Date().toISOString(),
        }),
    };
}

function missingFieldsFor(data = {}) {
    const missing = [];
    if (!(Number(data.price) > 0)) missing.push("price");
    if (!(Number(data.grossAreaM2) > 0) && !(Number(data.netAreaM2) > 0)) missing.push("area");
    if (!cleanString(data.roomText)) missing.push("roomText");
    if (!cleanString(data.city)) missing.push("city");
    if (!cleanString(data.district)) missing.push("district");
    if (!cleanString(data.neighborhood)) missing.push("neighborhood");
    if (!cleanString(data.sourceUrl)) missing.push("sourceUrl");
    return missing;
}

function alternateUrls(existing, nextUrl) {
    const current = Array.isArray(existing) ? existing : [];
    const url = sanitizeListingUrl(nextUrl);
    return [...new Set([...current, url].filter(Boolean))];
}

export async function findPossibleDuplicateComparable(listing = {}) {
    if (!cleanString(listing.sourceUrl)) return null;

    const exact = await prisma.comparableListing.findFirst({
        where: { sourceUrl: listing.sourceUrl },
    });
    if (exact) return exact;

    const price = Number(listing.price);
    const area = Number(listing.grossAreaM2 || listing.netAreaM2);
    if (!price || !area || !listing.district || !listing.roomText) return null;

    const candidates = await prisma.comparableListing.findMany({
        where: {
            district: { equals: listing.district, mode: "insensitive" },
            neighborhood: listing.neighborhood ? { equals: listing.neighborhood, mode: "insensitive" } : undefined,
            roomText: listing.roomText,
            price: { gte: price * 0.95, lte: price * 1.05 },
            OR: [
                { grossAreaM2: { gte: area * 0.9, lte: area * 1.1 } },
                { netAreaM2: { gte: area * 0.9, lte: area * 1.1 } },
                { grossM2: { gte: area * 0.9, lte: area * 1.1 } },
                { netM2: { gte: area * 0.9, lte: area * 1.1 } },
            ],
        },
        take: 10,
    });

    const titleKey = normalizeTurkishText(listing.title).slice(0, 40);
    return candidates.find((candidate) => {
        if (!titleKey) return true;
        return normalizeTurkishText(candidate.title).includes(titleKey) || titleKey.includes(normalizeTurkishText(candidate.title).slice(0, 40));
    }) || null;
}

function comparableDbData(merged = {}, input = {}) {
    const now = new Date();
    const dates = freshnessDates(now);
    const roomCounts = roomTextToCounts(merged.roomText);
    const imageUrl = normalizeImage(merged.imageUrl);
    const priceM2 = pricePerM2(merged.price, merged.grossAreaM2, merged.netAreaM2);
    const dataQuality = calculateComparableDataQuality({ ...merged, imageUrl });
    const match = calculateComparableMatchScore({ ...merged, imageUrl, dataQuality }, input);

    return {
        source: merged.source || sourceFromUrl(merged.sourceUrl),
        externalId: merged.sourceListingId || null,
        sourceListingId: merged.sourceListingId || null,
        sourceUrl: merged.sourceUrl,
        title: merged.title || null,
        description: merged.description || null,
        price: Number(merged.price) > 0 ? Number(merged.price) : null,
        currency: merged.currency || "TRY",
        pricePerM2: priceM2,
        pricePerSqm: priceM2,
        city: merged.city || input.city || null,
        district: merged.district || input.district || null,
        neighborhood: merged.neighborhood || input.neighborhood || null,
        compoundName: merged.compoundName || input.compoundName || null,
        addressText: [merged.city || input.city, merged.district || input.district, merged.neighborhood || input.neighborhood].filter(Boolean).join(" / ") || null,
        grossAreaM2: Number(merged.grossAreaM2) > 0 ? Number(merged.grossAreaM2) : null,
        netAreaM2: Number(merged.netAreaM2) > 0 ? Number(merged.netAreaM2) : null,
        grossM2: Number(merged.grossAreaM2) > 0 ? Number(merged.grossAreaM2) : null,
        netM2: Number(merged.netAreaM2) > 0 ? Number(merged.netAreaM2) : null,
        roomText: merged.roomText || null,
        roomCount: roomCounts.roomCount,
        salonCount: roomCounts.salonCount,
        propertyType: merged.propertyType || input.propertyType || null,
        heatingType: merged.heatingType || null,
        heating: merged.heatingType || null,
        imageUrl,
        imageStatus: isDefaultImage(imageUrl) ? "DEFAULT" : "REAL",
        imageSource: isDefaultImage(imageUrl) ? "DEFAULT" : merged.imageSource || "UNKNOWN",
        imageFieldSource: isDefaultImage(imageUrl) ? "DEFAULT" : merged.imageFieldSource || "UNKNOWN",
        fallbackImageUrl: getDefaultComparableImage(merged.propertyType || input.propertyType),
        listingUrl: merged.sourceUrl,
        providerRaw: merged.rawSearchResultJson || null,
        parsedRaw: merged.rawExtractedJson || null,
        rawSearchResultJson: merged.rawSearchResultJson || null,
        rawMetadataJson: merged.rawMetadataJson || null,
        rawExtractedJson: merged.rawExtractedJson || null,
        missingFields: missingFieldsFor(merged),
        confidenceScore: dataQuality,
        dataQuality,
        matchScore: match.matchScore,
        matchLevel: match.matchLevel,
        priceSource: merged.priceSource || "UNKNOWN",
        areaSource: merged.areaSource || "UNKNOWN",
        roomSource: merged.roomSource || "UNKNOWN",
        titleSource: merged.titleSource || "UNKNOWN",
        isActive: true,
        freshnessStatus: "FRESH",
        firstSeenAt: now,
        lastSeenAt: now,
        staleAfter: dates.staleAfter,
        expiresAt: dates.expiresAt,
    };
}

export async function upsertComparableListingFromMerged(merged = {}, input = {}) {
    if (!cleanString(merged.sourceUrl)) return { record: null, action: "skipped", duplicateMerged: false };

    const data = comparableDbData(merged, input);
    const existing = await prisma.comparableListing.findFirst({ where: { sourceUrl: data.sourceUrl } });
    if (existing) {
        const updated = await prisma.comparableListing.update({
            where: { id: existing.id },
            data: {
                ...data,
                firstSeenAt: existing.firstSeenAt || data.firstSeenAt,
                alternateSourceUrls: existing.alternateSourceUrls || undefined,
            },
        });
        return { record: updated, action: "updated", duplicateMerged: false };
    }

    const duplicate = await findPossibleDuplicateComparable(data);
    if (duplicate) {
        const shouldUseIncomingImage = isDefaultImage(duplicate.imageUrl) && !isDefaultImage(data.imageUrl);
        const mergedData = {
            lastSeenAt: new Date(),
            alternateSourceUrls: alternateUrls(duplicate.alternateSourceUrls, data.sourceUrl),
            price: duplicate.price ?? data.price,
            grossAreaM2: duplicate.grossAreaM2 ?? data.grossAreaM2,
            netAreaM2: duplicate.netAreaM2 ?? data.netAreaM2,
            grossM2: duplicate.grossM2 ?? data.grossM2,
            netM2: duplicate.netM2 ?? data.netM2,
            roomText: duplicate.roomText ?? data.roomText,
            roomCount: duplicate.roomCount ?? data.roomCount,
            salonCount: duplicate.salonCount ?? data.salonCount,
            imageUrl: shouldUseIncomingImage ? data.imageUrl : duplicate.imageUrl,
            imageStatus: shouldUseIncomingImage ? data.imageStatus : duplicate.imageStatus,
            imageSource: shouldUseIncomingImage ? "DUPLICATE_MERGE" : duplicate.imageSource,
            imageFieldSource: shouldUseIncomingImage ? "DUPLICATE_MERGE" : duplicate.imageFieldSource,
            dataQuality: Math.max(Number(duplicate.dataQuality || 0), Number(data.dataQuality || 0)),
            confidenceScore: Math.max(Number(duplicate.confidenceScore || 0), Number(data.confidenceScore || 0)),
            rawExtractedJson: {
                previous: duplicate.rawExtractedJson || null,
                duplicateMerge: data.rawExtractedJson || null,
            },
        };
        const updated = await prisma.comparableListing.update({
            where: { id: duplicate.id },
            data: mergedData,
        });
        return { record: updated, action: "updated", duplicateMerged: true };
    }

    const created = await prisma.comparableListing.create({ data });
    return { record: created, action: "created", duplicateMerged: false };
}

export async function discoverComparableUrls(input = {}, options = {}) {
    const startedAt = Date.now();
    const summary = emptySummary();
    const queries = generateComparableDiscoveryQueries({
        ...input,
        maxQueries: options.maxQueries,
    });
    summary.queriesGenerated = queries.length;
    console.log("[DISCOVERY] queries generated", { count: queries.length, city: input.city, district: input.district });

    const provider = new SerpListingProvider({
        maxResults: options.maxResults || envNumber("SERPAPI_MAX_RESULTS", 10),
        timeoutMs: options.timeoutMs || envNumber("SERPAPI_TIMEOUT_MS", 10_000),
    });
    const providerResponse = await provider.search(queries);
    const targetResults = options.targetResults || envNumber("COMPARABLE_DISCOVERY_TARGET_RESULTS", 300);
    const targetUrls = options.targetUrls || envNumber("COMPARABLE_DISCOVERY_TARGET_URLS", 150);
    const rawResults = providerResponse.results.slice(0, targetResults);
    summary.searchResultsReceived = rawResults.length;
    console.log("[DISCOVERY] search results received", { count: rawResults.length, errors: providerResponse.errors.length });

    const seenUrls = new Set();
    const results = rawResults
        .map((item) => ({
            ...item,
            url: sanitizeListingUrl(item.link || item.url),
            displayUrl: cleanString(item.displayed_link || item.displayUrl),
            thumbnailUrl: cleanString(item.imageUrl || item.thumbnailUrl),
        }))
        .filter((item) => item.url)
        .filter((item) => {
            if (seenUrls.has(item.url)) return false;
            seenUrls.add(item.url);
            return true;
        })
        .slice(0, targetUrls);

    summary.uniqueUrls = results.length;
    console.log("[DISCOVERY] unique urls", { count: results.length });

    for (const [index, result] of results.entries()) {
        const extracted = extractSearchResultComparableData(
            {
                title: result.title,
                snippet: result.snippet,
                thumbnailUrl: result.thumbnailUrl,
            },
            input
        );
        const status = enoughSearchData({
            price: extracted.price,
            grossAreaM2: extracted.areaM2,
            roomText: extracted.roomText,
            imageUrl: extracted.imageUrl,
        })
            ? "CANDIDATE"
            : "DISCOVERED";

        const searchResult = await prisma.comparableSearchResult.upsert({
            where: { url: result.url },
            create: {
                query: result.raw?.query || result.query || queries[0] || "",
                sourceEngine: SEARCH_ENGINE,
                resultRank: Number(result.raw?.serpapiPosition || index + 1),
                title: cleanString(result.title) || null,
                snippet: cleanString(result.snippet) || null,
                url: result.url,
                displayUrl: result.displayUrl || null,
                thumbnailUrl: result.thumbnailUrl || null,
                city: input.city || null,
                district: input.district || null,
                neighborhood: input.neighborhood || null,
                compoundName: extracted.compoundName || input.compoundName || null,
                propertyType: extracted.propertyType || input.propertyType || null,
                roomText: extracted.roomText || input.roomText || null,
                status,
                extractedPrice: extracted.price,
                extractedCurrency: extracted.currency || null,
                extractedAreaM2: extracted.areaM2,
                extractedRoomText: extracted.roomText,
                extractedImageUrl: extracted.imageUrl,
                extractedDataJson: jsonSafe(extracted),
            },
            update: {
                query: result.raw?.query || result.query || queries[0] || "",
                sourceEngine: SEARCH_ENGINE,
                resultRank: Number(result.raw?.serpapiPosition || index + 1),
                title: cleanString(result.title) || null,
                snippet: cleanString(result.snippet) || null,
                displayUrl: result.displayUrl || null,
                thumbnailUrl: result.thumbnailUrl || null,
                city: input.city || null,
                district: input.district || null,
                neighborhood: input.neighborhood || null,
                compoundName: extracted.compoundName || input.compoundName || null,
                propertyType: extracted.propertyType || input.propertyType || null,
                roomText: extracted.roomText || input.roomText || null,
                status,
                extractedPrice: extracted.price,
                extractedCurrency: extracted.currency || null,
                extractedAreaM2: extracted.areaM2,
                extractedRoomText: extracted.roomText,
                extractedImageUrl: extracted.imageUrl,
                extractedDataJson: jsonSafe(extracted),
            },
        });

        const existingSource = await prisma.comparableSourceUrl.findUnique({ where: { url: result.url }, select: { id: true } });
        await prisma.comparableSourceUrl.upsert({
            where: { url: result.url },
            create: {
                source: sourceFromUrl(result.url),
                url: result.url,
                query: searchResult.query,
                searchResultId: searchResult.id,
                city: input.city || null,
                district: input.district || null,
                neighborhood: input.neighborhood || null,
                compoundName: extracted.compoundName || input.compoundName || null,
                propertyType: extracted.propertyType || input.propertyType || null,
                roomText: extracted.roomText || input.roomText || null,
                status,
            },
            update: {
                source: sourceFromUrl(result.url),
                query: searchResult.query,
                searchResultId: searchResult.id,
                city: input.city || null,
                district: input.district || null,
                neighborhood: input.neighborhood || null,
                compoundName: extracted.compoundName || input.compoundName || null,
                propertyType: extracted.propertyType || input.propertyType || null,
                roomText: extracted.roomText || input.roomText || null,
                status,
            },
        });

        if (existingSource) summary.sourceUrlsUpdated += 1;
        else summary.sourceUrlsCreated += 1;

        console.log("[EXTRACT] search result parsed", { url: result.url, status });

        if (status === "CANDIDATE") {
            const searchData = searchDataFromResult(searchResult, input);
            if (searchData && enoughSearchData(searchData)) {
                const merged = mergeExtractedComparable(searchData, {}, {}, {});
                const listingResult = await upsertComparableListingFromMerged(merged, input);
                if (listingResult.action === "created") summary.listingsCreated += 1;
                if (listingResult.action === "updated") summary.listingsUpdated += 1;
                if (listingResult.duplicateMerged) summary.duplicatesMerged += 1;
            }
        }
    }

    console.log("[DISCOVERY] candidate urls", {
        count: summary.sourceUrlsCreated + summary.sourceUrlsUpdated,
        elapsedMs: Date.now() - startedAt,
    });

    return {
        queries,
        providerErrors: providerResponse.errors,
        summary,
    };
}

function titleFromHtml(html = "") {
    return cleanString(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " "));
}

async function fetchHtml(url) {
    const timeoutMs = envNumber("COMPARABLE_FETCH_TIMEOUT_MS", 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            redirect: "follow",
            cache: "no-store",
            signal: controller.signal,
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "user-agent": "Mozilla/5.0 (compatible; EmlakEndeksComparableIngestion/1.0; +https://emlakskor.com)",
            },
        });
        const html = await response.text().catch(() => "");
        return {
            status: response.status,
            ok: response.ok,
            html,
            title: titleFromHtml(html),
            contentType: response.headers.get("content-type") || "",
        };
    } finally {
        clearTimeout(timeout);
    }
}

function htmlNeedsRender(fetchResult = {}) {
    const html = cleanString(fetchResult.html);
    if (!html || html.length < 1200) return true;
    return /enable javascript|javascript is disabled|app-root|__next/i.test(html) && !/<meta\b|application\/ld\+json/i.test(html);
}

async function fetchHtmlWithHeadless(url) {
    if (process.env.ENABLE_HEADLESS_FETCH !== "true") return null;

    const { chromium } = await import("playwright");
    const browser = await chromium.launch(await buildLaunchOptions());
    try {
        const page = await browser.newPage();
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: envNumber("COMPARABLE_FETCH_TIMEOUT_MS", 8000),
        });
        const html = await page.content();
        return {
            status: 200,
            ok: true,
            html,
            title: await page.title().catch(() => titleFromHtml(html)),
            contentType: "text/html",
        };
    } finally {
        await browser.close().catch(() => {});
    }
}

async function markSource(record, data) {
    await prisma.comparableSourceUrl.update({
        where: { id: record.id },
        data: {
            ...data,
            fetchedAt: data.fetchedAt === undefined ? new Date() : data.fetchedAt,
        },
    });
    if (record.searchResultId) {
        await prisma.comparableSearchResult.update({
            where: { id: record.searchResultId },
            data: {
                status: data.status,
                rejectReason: data.blockedReason || data.lastError || undefined,
                fetchedAt: new Date(),
            },
        }).catch(() => null);
    }
}

export async function fetchAndParseComparableUrl(sourceUrlRecord, input = {}) {
    const record = sourceUrlRecord?.searchResult
        ? sourceUrlRecord
        : await prisma.comparableSourceUrl.findUnique({
            where: { id: sourceUrlRecord.id },
            include: { searchResult: true },
        });
    if (!record) return { status: "failed", action: "missing" };

    const fallbackData = sourceDataFromSourceUrl(record);
    const searchData = searchDataFromResult(record.searchResult, { ...fallbackData, ...input }) || fallbackData;

    let fetched = null;
    try {
        fetched = await fetchHtml(record.url);
        let blocked = detectBlockedHtml({ status: fetched.status, html: fetched.html, title: fetched.title });

        if (!blocked.blocked && htmlNeedsRender(fetched)) {
            const rendered = await fetchHtmlWithHeadless(record.url);
            if (rendered) fetched = rendered;
            blocked = detectBlockedHtml({ status: fetched.status, html: fetched.html, title: fetched.title });
        }

        if (blocked.blocked) {
            const canUseSearch = enoughSearchData(searchData);
            let listingResult = null;
            if (canUseSearch) {
                const merged = mergeExtractedComparable(searchData, {}, {}, {});
                listingResult = await upsertComparableListingFromMerged(merged, input);
            }

            await markSource(record, {
                status: canUseSearch ? "BLOCKED_WITH_SEARCH_DATA" : "BLOCKED",
                httpStatus: fetched.status,
                blockedReason: blocked.reason,
            });
            console.log("[FETCH] blocked skipped", { url: record.url, reason: blocked.reason, withSearchData: canUseSearch });
            return {
                status: canUseSearch ? "blocked_with_search_data" : "blocked",
                listingResult,
            };
        }

        if (!fetched.ok) {
            throw new Error(`HTTP_${fetched.status}`);
        }

        await markSource(record, {
            status: "FETCHED",
            httpStatus: fetched.status,
            blockedReason: null,
            lastError: null,
        });
        console.log("[FETCH] detail success", { url: record.url, status: fetched.status });

        const metadataData = {
            jsonLd: parseJsonLd(fetched.html, record.url),
            openGraph: parseOpenGraph(fetched.html, record.url),
            twitter: parseTwitterMeta(fetched.html, record.url),
        };
        const visibleData = parseVisibleHtmlText(fetched.html);
        const galleryData = parseGalleryImages(fetched.html, record.url);
        console.log("[PARSE] metadata extracted", {
            url: record.url,
            hasJsonLd: Boolean(metadataData.jsonLd?.raw?.length),
            hasOgImage: Boolean(metadataData.openGraph?.imageUrl),
            galleryCount: galleryData.images?.length || 0,
        });

        const merged = mergeExtractedComparable(searchData, metadataData, visibleData, galleryData);
        const listingResult = await upsertComparableListingFromMerged(merged, input);
        await markSource(record, {
            status: listingResult.duplicateMerged ? "DUPLICATE" : "PARSED",
            httpStatus: fetched.status,
            blockedReason: null,
            lastError: null,
        });

        if (listingResult.duplicateMerged) {
            console.log("[MERGE] duplicate merged", { url: record.url, listingId: listingResult.record?.id });
        }

        return {
            status: "parsed",
            listingResult,
        };
    } catch (error) {
        const canUseSearch = enoughSearchData(searchData);
        let listingResult = null;
        if (canUseSearch) {
            const merged = mergeExtractedComparable(searchData, {}, {}, {});
            listingResult = await upsertComparableListingFromMerged(merged, input);
        }

        await markSource(record, {
            status: canUseSearch ? "PARSED" : "FAILED",
            httpStatus: fetched?.status || null,
            lastError: String(error.message || error).slice(0, 1_000),
        });
        console.warn("[FETCH] failed", { url: record.url, message: String(error.message || error), withSearchData: canUseSearch });
        return {
            status: canUseSearch ? "parsed_from_search" : "failed",
            listingResult,
            error: String(error.message || error),
        };
    }
}

export async function fetchPendingComparableUrls({ limit = null, input = {}, timeoutMs = null } = {}) {
    const summary = emptySummary();
    const maxLimit = Math.min(Number(limit || envNumber("COMPARABLE_FETCH_PENDING_LIMIT", 50)), 200);
    const startedAt = Date.now();
    const globalTimeoutMs = Number(timeoutMs || envNumber("COMPARABLE_GLOBAL_JOB_TIMEOUT_MS", 60_000));
    const where = {
        status: { in: ["DISCOVERED", "CANDIDATE", "FAILED"] },
        ...(cleanString(input.city) ? { city: { equals: cleanString(input.city), mode: "insensitive" } } : {}),
        ...(cleanString(input.district) ? { district: { equals: cleanString(input.district), mode: "insensitive" } } : {}),
        ...(cleanString(input.neighborhood) ? { neighborhood: { equals: cleanString(input.neighborhood), mode: "insensitive" } } : {}),
        ...(cleanString(input.propertyType) ? { propertyType: { equals: cleanString(input.propertyType), mode: "insensitive" } } : {}),
        ...(cleanString(input.roomText) ? { roomText: cleanString(input.roomText) } : {}),
    };

    const records = await prisma.comparableSourceUrl.findMany({
        where,
        orderBy: [{ status: "asc" }, { discoveredAt: "desc" }],
        take: maxLimit,
        include: { searchResult: true },
    });

    for (const record of records) {
        if (Date.now() - startedAt > globalTimeoutMs) break;
        const result = await fetchAndParseComparableUrl(record, input);
        if (["parsed", "parsed_from_search"].includes(result.status)) summary.parsed += 1;
        if (result.status === "parsed") summary.fetched += 1;
        if (result.status.startsWith("blocked")) summary.blocked += 1;
        if (result.status === "failed") summary.failed += 1;
        if (result.listingResult?.action === "created") summary.listingsCreated += 1;
        if (result.listingResult?.action === "updated") summary.listingsUpdated += 1;
        if (result.listingResult?.duplicateMerged) summary.duplicatesMerged += 1;
    }

    return {
        attempted: records.length,
        summary,
    };
}

export async function createComparableIngestionJob(params = {}) {
    return await prisma.comparableIngestionJob.create({
        data: {
            status: "PENDING",
            city: params.city || null,
            district: params.district || null,
            neighborhood: params.neighborhood || null,
            compoundName: params.compoundName || null,
            propertyType: params.propertyType || null,
            roomText: params.roomText || null,
            subjectArea: Number(params.subjectArea) || null,
            payloadJson: jsonSafe(params),
        },
    });
}

export async function refreshComparableFreshnessStatuses(now = new Date()) {
    const [fresh, stale, expired] = await prisma.$transaction([
        prisma.comparableListing.updateMany({
            where: {
                staleAfter: { gt: now },
                freshnessStatus: { not: "FRESH" },
            },
            data: { freshnessStatus: "FRESH" },
        }),
        prisma.comparableListing.updateMany({
            where: {
                staleAfter: { lte: now },
                expiresAt: { gt: now },
                freshnessStatus: { not: "STALE" },
            },
            data: { freshnessStatus: "STALE" },
        }),
        prisma.comparableListing.updateMany({
            where: {
                expiresAt: { lte: now },
                freshnessStatus: { not: "EXPIRED" },
            },
            data: { freshnessStatus: "EXPIRED", isActive: false },
        }),
    ]);

    const summary = { fresh: fresh.count, stale: stale.count, expired: expired.count };
    console.log("[FRESHNESS] statuses updated", summary);
    return summary;
}

export async function cleanupComparableSearchCache(now = new Date()) {
    const result = await prisma.comparableSearchCache.deleteMany({
        where: { expiresAt: { lte: now } },
    });
    return { deleted: result.count };
}

export async function runComparableIngestionJob(params = {}) {
    const job = params.jobId
        ? await prisma.comparableIngestionJob.update({
            where: { id: params.jobId },
            data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
        })
        : await prisma.comparableIngestionJob.create({
            data: {
                status: "RUNNING",
                startedAt: new Date(),
                city: params.city || null,
                district: params.district || null,
                neighborhood: params.neighborhood || null,
                compoundName: params.compoundName || null,
                propertyType: params.propertyType || null,
                roomText: params.roomText || null,
                subjectArea: Number(params.subjectArea) || null,
                payloadJson: jsonSafe(params),
            },
        });

    try {
        const payload = {
            ...(job.payloadJson || {}),
            ...params,
            city: params.city || job.city,
            district: params.district || job.district,
            neighborhood: params.neighborhood || job.neighborhood,
            compoundName: params.compoundName || job.compoundName,
            propertyType: params.propertyType || job.propertyType,
            roomText: params.roomText || job.roomText,
            subjectArea: params.subjectArea ?? job.subjectArea,
        };
        const discovery = payload.city && payload.district ? await discoverComparableUrls(payload) : { summary: emptySummary(), queries: [] };
        const fetch = await fetchPendingComparableUrls({
            limit: payload.fetchLimit || envNumber("COMPARABLE_FETCH_PENDING_LIMIT", 50),
            input: payload,
        });
        const freshness = await refreshComparableFreshnessStatuses();
        const cacheCleanup = await cleanupComparableSearchCache();
        const resultJson = {
            discovery: discovery.summary,
            fetch: fetch.summary,
            freshness,
            cacheCleanup,
        };

        await prisma.comparableIngestionJob.update({
            where: { id: job.id },
            data: {
                status: "COMPLETED",
                completedAt: new Date(),
                resultJson,
            },
        });

        return { jobId: job.id, status: "COMPLETED", result: resultJson };
    } catch (error) {
        await prisma.comparableIngestionJob.update({
            where: { id: job.id },
            data: {
                status: "FAILED",
                completedAt: new Date(),
                errorMessage: String(error.message || error),
            },
        });
        throw error;
    }
}

export async function runComparableCronCycle(params = {}) {
    const pendingJob = await prisma.comparableIngestionJob.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
    });

    if (pendingJob) {
        return await runComparableIngestionJob({
            ...(pendingJob.payloadJson || {}),
            jobId: pendingJob.id,
            fetchLimit: params.fetchLimit || envNumber("COMPARABLE_FETCH_PENDING_LIMIT", 50),
        });
    }

    const fetch = await fetchPendingComparableUrls({
        limit: params.fetchLimit || envNumber("COMPARABLE_FETCH_PENDING_LIMIT", 50),
    });
    const freshness = await refreshComparableFreshnessStatuses();
    const cacheCleanup = await cleanupComparableSearchCache();

    return {
        status: "COMPLETED",
        result: {
            fetch: fetch.summary,
            freshness,
            cacheCleanup,
        },
    };
}
