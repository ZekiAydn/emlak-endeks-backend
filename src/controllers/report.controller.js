import prisma from "../prisma.js";
import { priceIndexPrompt } from "../ai/prompts/priceIndexPrompt.js";
import { normalizePriceIndex } from "../ai/normalize/priceIndexNormalize.js";
import { applyFallbackPriceEstimate } from "../ai/fallback/priceEstimate.js";
import { textToJson } from "../services/geminiTextToJson.js";
import { fetchParcelLookup } from "../services/tkgmParcel.js";
import { captureParcelMapImage, buildParcelHashUrl } from "../services/tkgmParcelScreenshot.js";
import { assertCanCreateReport } from "../services/subscriptionPlans.js";
import {
    sanitizePricingAnalysis,
    sanitizeBuildingDetails,
    sanitizePropertyDetails,
    buildAiNote,
} from "../utils/reportHelpers.js";
import { badRequest, notFound } from "../utils/errors.js";
import { fetchComparableBundle } from "../services/comparableProviders/index.js";
import { enrichComparableImages } from "../services/comparableImageEnrichment.js";
import { saveComparableListings } from "../services/comparableCache.js";
import { propertyCategory } from "../services/propertyCategory.js";
import { applyValuationPolicy } from "../services/valuationPolicy.js";
import { quantile, selectValuationComparables } from "../services/comparablePolicy.js";
import { buildLocationInsights } from "../services/locationInsights.js";
import { buildStoredMediaData, deleteStoredMediaObject } from "../services/mediaStorage.js";
import {
    cacheComparableImages,
    withSignedComparableImagesForReport,
    withSignedComparableImageUrls,
} from "../services/comparableImageCache.js";


const mediaSelect = {
    id: true,
    type: true,
    mime: true,
    filename: true,
    url: true,
    size: true,
    order: true,
    createdAt: true,
    userId: true,
    reportId: true,
};

const reportInclude = {
    user: { include: { media: { orderBy: { order: "asc" }, select: mediaSelect } } },
    client: true,
    property: true,
    media: { orderBy: { order: "asc" }, select: mediaSelect },
    propertyDetails: true,
    buildingDetails: true,
    pricingAnalysis: true,
};

function cleanString(value) {
    return String(value || "").trim();
}

function cleanOptional(value) {
    const text = cleanString(value);
    return text || null;
}

function toNum(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    if (!text) return null;
    let normalized = text.replace(/[^\d.,-]/g, "");
    if (normalized.includes(",")) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
        normalized = normalized.replace(/\./g, "");
    } else if ((normalized.match(/\./g) || []).length > 1) {
        normalized = normalized.replace(/\./g, "");
    }
    if (!normalized || normalized === "-") return null;
    const n = Number(value);
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
    return Number.isFinite(n) ? n : null;
}

function firstPositive(...values) {
    for (const value of values) {
        const n = toNum(value);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

function reportTypeValue(value) {
    const text = cleanString(value || "RESIDENTIAL").toUpperCase();
    if (["RESIDENTIAL", "COMMERCIAL", "LAND"].includes(text)) return text;
    return "RESIDENTIAL";
}

function valuationTypeValue(...values) {
    const found = values.find((value) => value !== undefined && value !== null && value !== "");
    const text = cleanString(found || "SALE").toUpperCase();
    if (["RENTAL", "RENT", "KIRALIK", "KİRALIK"].includes(text)) return "RENTAL";
    return "SALE";
}

function reportLocationData(body = {}, property = null) {
    return {
        reportType: reportTypeValue(body.reportType),
        city: cleanOptional(body.city ?? property?.city),
        district: cleanOptional(body.district ?? property?.district),
        neighborhood: cleanOptional(body.neighborhood ?? property?.neighborhood),
        tkgmCity: cleanOptional(body.tkgmCity ?? property?.tkgmCity ?? body.city ?? property?.city),
        tkgmDistrict: cleanOptional(body.tkgmDistrict ?? property?.tkgmDistrict ?? body.district ?? property?.district),
        tkgmNeighborhood: cleanOptional(body.tkgmNeighborhood ?? property?.tkgmNeighborhood ?? body.neighborhood ?? property?.neighborhood),
        blockNo: cleanOptional(body.blockNo ?? property?.blockNo),
        parcelNo: cleanOptional(body.parcelNo ?? property?.parcelNo),
        landArea: toNum(body.landArea ?? property?.landArea),
        landQuality: cleanOptional(body.landQuality ?? property?.landQuality),
        planInfo: cleanOptional(body.planInfo ?? property?.planInfo),
    };
}

function reportLocationSource(report) {
    const property = report.property || {};

    return {
        reportType: report.reportType || "RESIDENTIAL",
        city: property.city || report.city,
        district: property.district || report.district,
        neighborhood: property.neighborhood || report.neighborhood,
        tkgmCity: property.tkgmCity || report.tkgmCity || property.city || report.city,
        tkgmDistrict: property.tkgmDistrict || report.tkgmDistrict || property.district || report.district,
        tkgmNeighborhood: property.tkgmNeighborhood || report.tkgmNeighborhood || property.neighborhood || report.neighborhood,
        blockNo: property.blockNo || report.blockNo,
        parcelNo: property.parcelNo || report.parcelNo,
        landArea: property.landArea ?? report.landArea,
        landQuality: property.landQuality || report.landQuality,
        planInfo: property.planInfo || report.planInfo,
        addressText: property.addressText || report.addressText,
        parcelText: property.parcelText || report.parcelText,
    };
}

function publicBaseUrl(req) {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.get("host");
    return host ? `${protocol}://${host}` : "";
}

async function getClient(userId, id) {
    if (!id) return null;
    const client = await prisma.client.findFirst({ where: { id, userId } });
    if (!client) throw notFound("Rapor sahibi kaydı bulunamadı.");
    return client;
}

async function getProperty(userId, id) {
    if (!id) return null;
    const property = await prisma.property.findFirst({ where: { id, userId }, include: { client: true } });
    if (!property) throw notFound("Taşınmaz bulunamadı.");
    return property;
}

function reportClientData(body = {}) {
    const client = body.client || body.newClient || {};
    const fullName = cleanString(body.clientFullName || client.fullName);
    const phoneSource = body.clientPhone !== undefined ? body.clientPhone : client.phone;
    const emailSource = body.clientEmail !== undefined ? body.clientEmail : client.email;
    const notesSource = body.clientNotes !== undefined ? body.clientNotes : client.notes;

    return {
        fullName,
        phone: phoneSource === undefined ? undefined : cleanOptional(phoneSource),
        email: emailSource === undefined ? undefined : cleanOptional(emailSource),
        notes: notesSource === undefined ? undefined : cleanOptional(notesSource),
    };
}

async function ensureReportClient(userId, body = {}, currentClient = null) {
    const input = reportClientData(body);
    const hasClientData = Boolean(input.fullName || input.phone !== undefined || input.email !== undefined || input.notes !== undefined);
    if (!hasClientData) return currentClient;

    if (currentClient?.id) {
        return prisma.client.update({
            where: { id: currentClient.id },
            data: {
                fullName: input.fullName || currentClient.fullName,
                ...(input.phone !== undefined ? { phone: input.phone } : {}),
                ...(input.email !== undefined ? { email: input.email } : {}),
                ...(input.notes !== undefined ? { notes: input.notes } : {}),
            },
        });
    }

    if (!input.fullName) return null;

    return prisma.client.create({
        data: {
            userId,
            fullName: input.fullName,
            phone: input.phone ?? null,
            email: input.email ?? null,
            notes: input.notes ?? null,
        },
    });
}

async function findReport(userId, id) {
    const report = await prisma.report.findFirst({
        where: { id, userId, isDeleted: false },
        include: reportInclude,
    });
    if (!report) throw notFound("Rapor bulunamadı.");
    return report;
}

function normalizeComparable(c) {
    const distanceMeters = toNum(c?.distanceMeters);
    const distanceKm = toNum(c?.distanceKm) ?? (distanceMeters !== null ? distanceMeters / 1000 : null);
    const floor = toNum(c?.floor);

    return {
        title: c?.title ?? null,
        source: c?.source ?? null,
        sourceUrl: c?.sourceUrl ?? null,
        price: toNum(c?.price),
        netArea: toNum(c?.netArea),
        grossArea: toNum(c?.grossArea),
        floor,
        floorText: c?.floorText ?? (floor === null && typeof c?.floor === "string" ? c.floor : null),
        totalFloors: toNum(c?.totalFloors),
        buildingAge: toNum(c?.buildingAge),
        distanceKm,
        distanceMeters,
        roomText: c?.roomText ?? null,
        imageUrl: c?.imageUrl ?? null,
        imageOriginalUrl: c?.imageOriginalUrl ?? null,
        imageCache: c?.imageCache ?? null,
        imageSource: c?.imageSource ?? null,
        imageAttribution: c?.imageAttribution ?? null,
        address: c?.address ?? null,
        externalId: c?.externalId ?? null,
        createdAt: c?.createdAt ?? null,
        group: c?.group ?? null,
        provider: c?.provider ?? null,
        pricePerSqm: toNum(c?.pricePerSqm),
        latitude: toNum(c?.latitude),
        longitude: toNum(c?.longitude),
    };
}

function comparableIdentity(c = {}) {
    return [c.externalId, c.sourceUrl, c.id, c.listingUrl]
        .map((value) => cleanString(value))
        .find(Boolean) || null;
}

function idSetFrom(...values) {
    const out = new Set();
    values.flat().forEach((value) => {
        const id = cleanString(value);
        if (id) out.add(id);
    });
    return out;
}

function comparablesFrom(body, report) {
    const explicitBodyComparables = Array.isArray(body.comparables);
    const explicitJsonComparables = Array.isArray(body.comparablesJson?.comparables);
    const raw =
        (explicitBodyComparables ? body.comparables : null) ??
        (explicitJsonComparables ? body.comparablesJson.comparables : null) ??
        (Array.isArray(report?.comparablesJson?.comparables) ? report.comparablesJson.comparables : null) ??
        [];

    const excludedIds = idSetFrom(
        body.excludedComparableIds,
        body.deletedComparableIds,
        body.removedComparableIds,
        body.comparablesJson?.excludedComparableIds,
        body.comparablesJson?.deletedComparableIds,
        body.comparablesJson?.removedComparableIds
    );
    const currentIds = idSetFrom(
        body.activeComparableIds,
        body.currentComparableIds,
        body.selectedComparableIds,
        body.comparablesJson?.activeComparableIds,
        body.comparablesJson?.currentComparableIds,
        body.comparablesJson?.selectedComparableIds
    );

    return raw
        .map(normalizeComparable)
        .filter((item) => {
            const id = comparableIdentity(item);
            if (id && excludedIds.has(id)) return false;
            if (!explicitBodyComparables && !explicitJsonComparables && currentIds.size && (!id || !currentIds.has(id))) return false;
            return true;
        });
}

function mergeComparablesJson(existingValue, incomingValue) {
    if (incomingValue === null) return null;
    if (incomingValue === undefined) return existingValue;

    const merged = {
        ...(existingValue || {}),
        ...(incomingValue || {}),
    };

    if (incomingValue && Object.prototype.hasOwnProperty.call(incomingValue, "comparables")) {
        merged.comparables = incomingValue.comparables;
    }

    return merged;
}

function pickPricingAnalysisFields(value = {}) {
    return {
        minPrice: value.minPrice ?? null,
        expectedPrice: value.expectedPrice ?? value.avgPrice ?? null,
        maxPrice: value.maxPrice ?? null,
        note: value.note ?? null,
        minPricePerSqm: value.minPricePerSqm ?? null,
        expectedPricePerSqm: value.expectedPricePerSqm ?? value.avgPricePerSqm ?? null,
        maxPricePerSqm: value.maxPricePerSqm ?? null,
        confidence: value.confidence ?? null,
        aiJson: value.aiJson ?? null,
    };
}

async function replaceReportMedia(reportId, { type, buffer, mime, filename }) {
    if (!reportId || !type || !buffer || !mime) return null;

    const existingMedia = await prisma.media.findMany({
        where: { reportId, type },
    });
    await Promise.all(existingMedia.map((media) => deleteStoredMediaObject(media)));

    await prisma.media.deleteMany({
        where: { reportId, type },
    });

    return await prisma.media.create({
        data: await buildStoredMediaData({
            reportId,
            type,
            mime,
            filename: filename || null,
            buffer,
            order: 0,
        }),
        select: mediaSelect,
    });
}

async function cacheComparablesJsonImages(comparablesJson, statsTarget = null) {
    if (!comparablesJson || !Array.isArray(comparablesJson.comparables) || !comparablesJson.comparables.length) {
        return comparablesJson;
    }

    const result = await cacheComparableImages(comparablesJson.comparables);
    if (statsTarget && result.stats) statsTarget.imageCache = result.stats;

    return {
        ...comparablesJson,
        comparables: result.comparables,
        comparableImageCache: result.stats,
    };
}

async function cacheBundleComparableImages(bundle, sourceMeta = null) {
    if (!Array.isArray(bundle?.comparables) || !bundle.comparables.length) return bundle;

    const imageCache = await cacheComparableImages(bundle.comparables);
    return {
        ...bundle,
        comparables: imageCache.comparables,
        sourceMeta: {
            ...(bundle.sourceMeta || {}),
            ...(sourceMeta || {}),
            imageCache: imageCache.stats,
        },
    };
}

function publicPricingNote(value) {
    const text = cleanString(value);
    if (!text) return null;
    if (text.includes("minimum satış değeri taban alınarak")) return null;
    return text;
}

function normalizePricingAnalysisForSave(pricingAnalysis, { body = {}, report = null, propertyDetails = null, buildingDetails = null, locationData = null } = {}) {
    const sanitized = sanitizePricingAnalysis(pricingAnalysis);
    if (!sanitized) return null;

    const location = locationData || (report ? reportLocationSource(report) : {});
    const valuationType = valuationTypeValue(
        body.valuationType,
        body.comparablesJson?.valuationType,
        report?.comparablesJson?.valuationType
    );
    const category = propertyCategory({
        reportType: body.reportType ?? location.reportType ?? report?.reportType,
        propertyType: buildingDetails?.propertyType,
    });
    const areaHint = firstPositive(
        body.subjectArea,
        propertyDetails?.netArea,
        propertyDetails?.grossArea,
        body.landArea,
        location.landArea,
        body.comparablesJson?.parcelLookup?.properties?.area,
        report?.comparablesJson?.parcelLookup?.properties?.area
    );

    const normalized = applyValuationPolicy(sanitized, areaHint, valuationType, {
        propertyCategory: category,
        skipAmenityPremium: true,
        suppressPolicyNoteAppend: true,
    });

    const existingAiJson = sanitized.aiJson && typeof sanitized.aiJson === "object" && !Array.isArray(sanitized.aiJson)
        ? sanitized.aiJson
        : {};

    return pickPricingAnalysisFields({
        ...normalized,
        aiJson: {
            ...existingAiJson,
            saleStrategy: normalized.saleStrategy || existingAiJson.saleStrategy || null,
            valuationPolicy: normalized.valuationPolicy || existingAiJson.valuationPolicy || null,
            rentalEstimate: normalized.rentalEstimate || existingAiJson.rentalEstimate || null,
            valuationType: normalized.valuationType || valuationType,
        },
    });
}

function buildExternalDataContext(report, body = {}) {
    const location = reportLocationSource(report);
    const propertyDetails = {
        ...(report.propertyDetails || {}),
        ...(body.propertyDetails || {}),
    };
    const buildingDetails = {
        ...(report.buildingDetails || {}),
        ...(body.buildingDetails || {}),
    };

    const comparableCriteria = {
        city: cleanString(body.city ?? location.city ?? ""),
        district: cleanString(body.district ?? location.district ?? ""),
        neighborhood: cleanString(body.neighborhood ?? location.neighborhood ?? ""),
        propertyType: cleanString(body.propertyType ?? buildingDetails.propertyType ?? ""),
        reportType: cleanString(body.reportType ?? location.reportType ?? report.reportType ?? ""),
        valuationType: valuationTypeValue(body.valuationType, body.comparablesJson?.valuationType, report.comparablesJson?.valuationType),
    };
    const comparableCategory = propertyCategory(comparableCriteria);
    const parcelCriteria = {
        city: cleanString(body.tkgmCity ?? location.tkgmCity ?? comparableCriteria.city),
        district: cleanString(body.tkgmDistrict ?? location.tkgmDistrict ?? comparableCriteria.district),
        neighborhood: cleanString(body.tkgmNeighborhood ?? location.tkgmNeighborhood ?? comparableCriteria.neighborhood),
        blockNo: cleanString(body.blockNo ?? location.blockNo ?? ""),
        parcelNo: cleanString(body.parcelNo ?? location.parcelNo ?? ""),
    };

    const parcelArea = firstPositive(
        body.landArea,
        location.landArea,
        report.comparablesJson?.parcelLookup?.properties?.area
    );
    const subjectArea = comparableCategory === "land"
        ? firstPositive(body.subjectArea, parcelArea, propertyDetails.grossArea, propertyDetails.netArea)
        : firstPositive(body.subjectArea, propertyDetails.grossArea, propertyDetails.netArea, parcelArea);
    const subjectRoomText =
        comparableCategory === "residential" && propertyDetails.roomCount !== undefined && propertyDetails.roomCount !== null
            ? `${propertyDetails.roomCount}${propertyDetails.salonCount !== undefined && propertyDetails.salonCount !== null ? `+${propertyDetails.salonCount}` : ""}`
            : null;

    return {
        location,
        propertyDetails,
        buildingDetails,
        comparableCriteria,
        parcelCriteria,
        subjectArea,
        comparableCategory,
        subjectRoomText,
    };
}

function hasParcelCriteria(parcelCriteria = {}) {
    return Boolean(parcelCriteria.city && parcelCriteria.district && parcelCriteria.neighborhood && parcelCriteria.blockNo && parcelCriteria.parcelNo);
}

async function captureAndStoreParcelMap(reportId, parcelLookup, warnings = []) {
    if (!parcelLookup) return null;

    try {
        console.log("[PARCEL_DATA] map capture start", {
            reportId,
            neighborhoodId: parcelLookup.neighborhoodId,
            blockNo: parcelLookup.properties?.blockNo,
            parcelNo: parcelLookup.properties?.parcelNo,
        });

        const mapCapture = await captureParcelMapImage(parcelLookup, { reportId });
        if (!mapCapture?.buffer) {
            warnings.push("TKGM harita görüntüsü alınamadı: görüntü servisi boş döndü.");
            console.warn("[PARCEL_DATA] map capture empty", { reportId });
            return null;
        }

        const mapMedia = await replaceReportMedia(reportId, {
            type: "MAP_IMAGE",
            buffer: mapCapture.buffer,
            mime: mapCapture.mime,
            filename: mapCapture.filename,
        });

        console.log("[PARCEL_DATA] map capture stored", {
            reportId,
            mediaId: mapMedia?.id,
            sourceUrl: mapCapture.sourceUrl,
        });

        return {
            mapMedia,
            sourceUrl: mapCapture.sourceUrl || null,
        };
    } catch (error) {
        const message = `TKGM harita görüntüsü alınamadı: ${String(error.message || error)}`;
        warnings.push(message);
        console.warn("[PARCEL_DATA] map capture failed", { reportId, message });
        return null;
    }
}

async function buildRegionalStatsForReport(report, context, parcelLookup, warnings = []) {
    const location = {
        city: cleanString(context.comparableCriteria?.city || context.parcelCriteria?.city || context.location?.city || ""),
        district: cleanString(context.comparableCriteria?.district || context.parcelCriteria?.district || context.location?.district || ""),
        neighborhood: cleanString(context.comparableCriteria?.neighborhood || context.parcelCriteria?.neighborhood || context.location?.neighborhood || ""),
    };

    if (!parcelLookup && !location.city && !location.district) {
        return report.regionalStatsJson || null;
    }

    try {
        const regionalStats = await buildLocationInsights({
            location,
            criteria: context.parcelCriteria || context.comparableCriteria || {},
            parcelLookup,
        });

        if (Array.isArray(regionalStats?.warnings) && regionalStats.warnings.length) {
            warnings.push(...regionalStats.warnings.map((warning) => `Konum analizi: ${warning}`));
        }

        return regionalStats;
    } catch (error) {
        warnings.push(`Konum analizi üretilemedi: ${String(error.message || error)}`);
        return report.regionalStatsJson || null;
    }
}

async function updateParcelDataForReport(report, body = {}, { requireInputs = false } = {}) {
    const reportId = report.id;
    const warnings = [];
    const context = buildExternalDataContext(report, body);

    console.log("[PARCEL_DATA] start", {
        reportId,
        city: context.parcelCriteria.city,
        district: context.parcelCriteria.district,
        neighborhood: context.parcelCriteria.neighborhood,
        blockNo: context.parcelCriteria.blockNo,
        parcelNo: context.parcelCriteria.parcelNo,
    });

    if (!hasParcelCriteria(context.parcelCriteria)) {
        const message = "TKGM parsel sorgusu için il, ilçe, mahalle, ada ve parsel bilgileri eksiksiz olmalı.";
        console.warn("[PARCEL_DATA] missing inputs", { reportId });
        if (requireInputs) throw badRequest(message);
        warnings.push(message);
        return {
            parcelLookup: report.comparablesJson?.parcelLookup || null,
            mapMedia: null,
            landArea: null,
            warnings,
        };
    }

    let parcelLookup = null;
    try {
        parcelLookup = await fetchParcelLookup(context.parcelCriteria);
        if (parcelLookup) {
            parcelLookup.sourceUrl = buildParcelHashUrl(parcelLookup);
            const parcelArea = firstPositive(parcelLookup?.properties?.area);
            if (context.comparableCategory === "land" && parcelArea) {
                context.subjectArea = parcelArea;
            } else {
                context.subjectArea = context.subjectArea ?? parcelArea;
            }
        }
        console.log("[PARCEL_DATA] lookup success", {
            reportId,
            hasPolygon: Boolean(parcelLookup?.polygon?.length),
            area: parcelLookup?.properties?.area || null,
            sourceUrl: parcelLookup?.sourceUrl || null,
        });
    } catch (error) {
        const message = String(error.message || error);
        warnings.push(message);
        console.warn("[PARCEL_DATA] lookup failed", { reportId, message });
        if (requireInputs) throw badRequest(message);
    }

    let mapMedia = null;
    if (parcelLookup) {
        const capture = await captureAndStoreParcelMap(reportId, parcelLookup, warnings);
        mapMedia = capture?.mapMedia || null;
        if (capture?.sourceUrl) {
            parcelLookup = {
                ...parcelLookup,
                sourceUrl: capture.sourceUrl,
            };
        }
    }

    const inferredLandArea =
        context.comparableCategory === "land" && context.subjectArea && context.subjectArea > 0
            ? context.subjectArea
            : null;

    const nextComparablesJson = {
        ...(report.comparablesJson || {}),
        ...(body.comparablesJson || {}),
        ...(parcelLookup ? { parcelLookup } : {}),
        parcelDataUpdatedAt: new Date().toISOString(),
        externalDataUpdatedAt: new Date().toISOString(),
    };
    const regionalStats = await buildRegionalStatsForReport(report, context, nextComparablesJson.parcelLookup || parcelLookup, warnings);

    await prisma.report.update({
        where: { id: reportId },
        data: {
            ...(inferredLandArea && !toNum(context.location.landArea) ? { landArea: inferredLandArea } : {}),
            comparablesJson: nextComparablesJson,
            regionalStatsJson: regionalStats,
        },
    });

    console.log("[PARCEL_DATA] finish", {
        reportId,
        hasParcelLookup: Boolean(parcelLookup),
        hasMapMedia: Boolean(mapMedia),
        warnings: warnings.length,
    });

    return {
        parcelLookup,
        mapMedia,
        regionalStats,
        landArea: inferredLandArea,
        warnings,
    };
}

async function updateComparableDataForReport(req, report, body = {}) {
    const reportId = report.id;
    const warnings = [];
    const context = buildExternalDataContext(report, body);
    let parcelLookup = body.comparablesJson?.parcelLookup || report.comparablesJson?.parcelLookup || null;

    console.log("[COMPARABLE_DATA] start", {
        reportId,
        city: context.comparableCriteria.city,
        district: context.comparableCriteria.district,
        neighborhood: context.comparableCriteria.neighborhood,
        reportType: context.comparableCriteria.reportType,
        propertyType: context.comparableCriteria.propertyType,
        valuationType: context.comparableCriteria.valuationType,
    });

    let bundle = null;
    if (context.comparableCriteria.city && context.comparableCriteria.district) {
        try {
            bundle = await fetchComparableBundle(context.comparableCriteria, {
                parcelLookup,
                subjectPoint: parcelLookup?.center || null,
                subjectArea: context.subjectArea,
                subjectRoomText: context.subjectRoomText,
                propertyCategory: context.comparableCategory,
            });

            if (Array.isArray(bundle?.warnings) && bundle.warnings.length) {
                warnings.push(...bundle.warnings);
            }
        } catch (error) {
            const message = String(error.message || error);
            warnings.push(message);
            console.warn("[COMPARABLE_DATA] search failed", { reportId, message });
        }
    } else {
        warnings.push("Emsal araması için il ve ilçe bilgisi gerekli.");
    }

    if (Array.isArray(bundle?.comparables) && bundle.comparables.length > 0) {
        try {
            console.log("[COMPARABLE_DATA] image enrichment start", {
                reportId,
                count: bundle.comparables.length,
            });

            const imageEnrichment = await enrichComparableImages(bundle.comparables, {
                subjectLocation: {
                    city: context.comparableCriteria.city,
                    district: context.comparableCriteria.district,
                    neighborhood: context.comparableCriteria.neighborhood,
                    reportType: context.comparableCriteria.reportType,
                    propertyType: context.comparableCriteria.propertyType,
                    address: context.location.addressText,
                },
                baseUrl: publicBaseUrl(req),
            });

            bundle = {
                ...bundle,
                comparables: imageEnrichment.comparables,
                sourceMeta: {
                    ...(bundle.sourceMeta || {}),
                    enrichment: imageEnrichment.sourceMeta,
                },
            };

            console.log("[COMPARABLE_DATA] image enrichment finish", {
                reportId,
                count: bundle.comparables.length,
                source: imageEnrichment.sourceMeta?.provider || imageEnrichment.sourceMeta?.source || null,
            });
        } catch (error) {
            warnings.push(`Emsal görselleri zenginleştirilemedi: ${String(error.message || error)}`);
        }
    }

    if (Array.isArray(bundle?.comparables) && bundle.comparables.length > 0) {
        bundle = await cacheBundleComparableImages(bundle);
    }

    const hasComparables = Array.isArray(bundle?.comparables) && bundle.comparables.length > 0;
    if (hasComparables) {
        try {
            const cacheSave = await saveComparableListings(bundle.comparables, context.comparableCriteria, {
                subjectArea: context.subjectArea,
                subjectRoomText: context.subjectRoomText,
                sourceMeta: bundle.sourceMeta || null,
            });

            bundle = {
                ...bundle,
                sourceMeta: {
                    ...(bundle.sourceMeta || {}),
                    cacheSave,
                },
            };
        } catch (error) {
            console.warn("[COMPARABLE_DATA] cache save failed", {
                reportId,
                message: String(error.message || error),
            });
        }
    }

    const existingComparables = Array.isArray(report.comparablesJson?.comparables)
        ? report.comparablesJson.comparables
        : [];

    if (!hasComparables && existingComparables.length) {
        warnings.push("Yeni emsal bulunamadı, varsa önceki emsaller korunmuştur.");
    }

    const nextComparablesJson = {
        ...(report.comparablesJson || {}),
        ...(body.comparablesJson || {}),
        valuationType: context.comparableCriteria.valuationType,
        ...(parcelLookup ? { parcelLookup } : {}),
        ...(hasComparables
            ? {
                  comparables: bundle.comparables,
                  groups: bundle.groups,
                  comparableSource: bundle.sourceMeta,
                  apifyEmlakjetSource:
                      bundle.sourceMeta?.provider === "APIFY_EMLAKJET" || bundle.sourceMeta?.providers?.includes("APIFY_EMLAKJET")
                          ? bundle.sourceMeta
                          : report.comparablesJson?.apifyEmlakjetSource || null,
                  serpSnippetSource:
                      bundle.sourceMeta?.provider === "SERP_SNIPPET" || bundle.sourceMeta?.providers?.includes("SERP_SNIPPET")
                          ? bundle.sourceMeta
                          : report.comparablesJson?.serpSnippetSource || null,
              }
            : {
                  comparables: existingComparables,
                  groups: report.comparablesJson?.groups || null,
              }),
        comparableDataUpdatedAt: new Date().toISOString(),
        externalDataUpdatedAt: new Date().toISOString(),
    };

    const policyPriceBand = hasComparables && bundle?.priceBand
        ? applyValuationPolicy(bundle.priceBand, context.subjectArea, context.comparableCriteria.valuationType, {
              buildingDetails: context.buildingDetails,
              propertyDetails: context.propertyDetails,
              propertyCategory: context.comparableCategory,
          })
        : null;
    const inferredLandArea =
        context.comparableCategory === "land" && context.subjectArea && context.subjectArea > 0
            ? context.subjectArea
            : null;

    const pricingUpdate = policyPriceBand
        ? {
              minPrice: policyPriceBand.minPrice,
              expectedPrice: policyPriceBand.expectedPrice,
              maxPrice: policyPriceBand.maxPrice,
              minPricePerSqm: policyPriceBand.minPricePerSqm,
              expectedPricePerSqm: policyPriceBand.expectedPricePerSqm,
              maxPricePerSqm: policyPriceBand.maxPricePerSqm,
              confidence: policyPriceBand.confidence,
              note: publicPricingNote(report.pricingAnalysis?.note) || null,
              aiJson: {
                  ...(report.pricingAnalysis?.aiJson || {}),
                  saleStrategy: policyPriceBand.saleStrategy,
                  valuationPolicy: policyPriceBand.valuationPolicy,
                  rentalEstimate: policyPriceBand.rentalEstimate || null,
                  valuationType: context.comparableCriteria.valuationType,
                  sourcePriceBand: bundle.priceBand,
              },
          }
        : null;
    const regionalStats = await buildRegionalStatsForReport(report, context, nextComparablesJson.parcelLookup || parcelLookup, warnings);

    await prisma.report.update({
        where: { id: reportId },
        data: {
            ...(inferredLandArea && !toNum(context.location.landArea) ? { landArea: inferredLandArea } : {}),
            comparablesJson: nextComparablesJson,
            ...(hasComparables && bundle?.marketProjection ? { marketProjectionJson: bundle.marketProjection } : {}),
            regionalStatsJson: regionalStats,
            ...(pricingUpdate
                ? {
                      pricingAnalysis: {
                          upsert: {
                              create: pricingUpdate,
                              update: pricingUpdate,
                          },
                      },
                  }
                : {}),
        },
    });

    console.log("[COMPARABLE_DATA] finish", {
        reportId,
        count: nextComparablesJson.comparables?.length || 0,
        provider: bundle?.sourceMeta?.provider || null,
        warnings: warnings.length,
    });

    return {
        comparables: await withSignedComparableImageUrls(nextComparablesJson.comparables || []),
        groups: nextComparablesJson.groups || null,
        parcelLookup: nextComparablesJson.parcelLookup || null,
        marketProjection: hasComparables ? bundle?.marketProjection || null : report.marketProjectionJson || null,
        regionalStats,
        landArea: inferredLandArea,
        pricingAnalysis: pricingUpdate || report.pricingAnalysis || null,
        sourceMeta: bundle?.sourceMeta || nextComparablesJson.comparableSource || null,
        warnings,
    };
}


function normalizedDraftData(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function draftMirrorData(draftData = {}) {
    const client = draftData.client || draftData.newClient || {};
    const property = draftData.property || draftData.newProperty || {};
    const comparablesMeta = draftData.comparablesMeta || {};

    return {
        clientFullName: cleanString(draftData.clientFullName || client.fullName || ""),
        addressText: cleanString(draftData.addressText || property.addressText || ""),
        parcelText: cleanString(draftData.parcelText || property.parcelText || ""),
        reportType: reportTypeValue(property.reportType || draftData.reportType || "RESIDENTIAL"),
        city: cleanOptional(property.city || draftData.city),
        district: cleanOptional(property.district || draftData.district),
        neighborhood: cleanOptional(property.neighborhood || draftData.neighborhood),
        tkgmCity: cleanOptional(property.tkgmCity || draftData.tkgmCity || property.city),
        tkgmDistrict: cleanOptional(property.tkgmDistrict || draftData.tkgmDistrict || property.district),
        tkgmNeighborhood: cleanOptional(property.tkgmNeighborhood || draftData.tkgmNeighborhood || property.neighborhood),
        blockNo: cleanOptional(property.blockNo || draftData.blockNo),
        parcelNo: cleanOptional(property.parcelNo || draftData.parcelNo),
        landArea: toNum(property.landArea ?? draftData.landArea),
        landQuality: cleanOptional(property.landQuality || draftData.landQuality),
        planInfo: cleanOptional(property.planInfo || draftData.planInfo),
        consultantOpinion: draftData.consultantOpinion || "",
        comparablesJson: draftData.comparables
            ? {
                ...(comparablesMeta || {}),
                comparables: Array.isArray(draftData.comparables) ? draftData.comparables : [],
            }
            : undefined,
        marketProjectionJson: draftData.aiMarketProjection || null,
        regionalStatsJson: draftData.aiRegionalStats || null,
    };
}

function draftStepValue(value) {
    const parsed = Number(value || 1);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(9, Math.round(parsed)));
}


export const createReport = async (req, res) => {
    const userId = req.user.userId;
    const body = req.body || {};

    await assertCanCreateReport(prisma, userId);

    const property = await getProperty(userId, body.propertyId);
    let client = property?.client || (await getClient(userId, body.clientId));
    client = await ensureReportClient(userId, body, client);

    if (body.clientId && property && property.clientId !== body.clientId) {
        throw badRequest("Seçilen taşınmaz bu rapor sahibi kaydıyla eşleşmiyor.", "propertyId");
    }

    const clientFullName = cleanString(body.clientFullName || client?.fullName);
    const addressText = cleanString(body.addressText || property?.addressText);
    const parcelText = cleanString(body.parcelText ?? property?.parcelText ?? "");

    if (!clientFullName) throw badRequest("Rapor sahibi adı girmeniz gerekiyor.", "clientFullName");
    if (!addressText) throw badRequest("Rapor için taşınmaz adresi gerekiyor.", "addressText");

    const locationData = reportLocationData(body, property);
    const pd = sanitizePropertyDetails(body.propertyDetails);
    const bd = sanitizeBuildingDetails(body.buildingDetails);
    const pa = normalizePricingAnalysisForSave(body.pricingAnalysis, {
        body,
        propertyDetails: pd || body.propertyDetails || {},
        buildingDetails: bd || body.buildingDetails || {},
        locationData,
    });

    const data = {
        userId,
        clientId: client?.id || null,
        propertyId: property?.id || null,
        ...locationData,
        clientFullName,
        addressText,
        parcelText,
        reportDate: body.reportDate ? new Date(body.reportDate) : new Date(),
        status: "COMPLETED",
        draftStep: null,
        draftData: null,
        consultantOpinion: body.consultantOpinion || "",
        comparablesJson: body.comparablesJson || null,
        marketProjectionJson: body.marketProjectionJson || null,
        regionalStatsJson: body.regionalStatsJson || null,
    };

    if (pd) data.propertyDetails = { create: pd };

    if (bd) data.buildingDetails = { create: bd };

    if (pa) data.pricingAnalysis = { create: pa };

    let report = await prisma.report.create({
        data,
        include: reportInclude,
    });

    if (Array.isArray(report.comparablesJson?.comparables) && report.comparablesJson.comparables.length) {
        report = await prisma.report.update({
            where: { id: report.id },
            data: { comparablesJson: await cacheComparablesJsonImages(report.comparablesJson) },
            include: reportInclude,
        });
    }

    res.status(201).json(await withSignedComparableImagesForReport(report));
};

export const listReports = async (req, res) => {
    const userId = req.user.userId;
    const take = Math.min(Number(req.query.take || 50), 100);
    const skip = Number(req.query.skip || 0);

    const list = await prisma.report.findMany({
        where: { userId, isDeleted: false },
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
            client: true,
            property: true,
            pricingAnalysis: true,
        },
    });

    res.json(list);
};


export const listDraftReports = async (req, res) => {
    const userId = req.user.userId;
    const take = Math.min(Number(req.query.take || 20), 50);

    const drafts = await prisma.report.findMany({
        where: { userId, isDeleted: false, status: "DRAFT" },
        orderBy: { updatedAt: "desc" },
        take,
        include: {
            client: true,
            property: true,
            pricingAnalysis: true,
        },
    });

    res.json(drafts);
};

export const getLatestDraftReport = async (req, res) => {
    const userId = req.user.userId;
    const draft = await prisma.report.findFirst({
        where: { userId, isDeleted: false, status: "DRAFT" },
        orderBy: { updatedAt: "desc" },
        include: reportInclude,
    });

    res.json(draft ? await withSignedComparableImagesForReport(draft) : null);
};

export const createDraftReport = async (req, res) => {
    const userId = req.user.userId;
    const body = req.body || {};
    const draftData = normalizedDraftData(body.draftData);
    const mirror = draftMirrorData(draftData);

    const draft = await prisma.report.create({
        data: {
            userId,
            ...mirror,
            clientFullName: mirror.clientFullName || "",
            addressText: mirror.addressText || "",
            parcelText: mirror.parcelText || "",
            status: "DRAFT",
            draftStep: draftStepValue(body.draftStep || draftData.step),
            draftData,
            reportDate: new Date(),
        },
        include: reportInclude,
    });

    res.status(201).json(await withSignedComparableImagesForReport(draft));
};

export const updateDraftReport = async (req, res) => {
    const userId = req.user.userId;
    const id = req.params.id;
    const body = req.body || {};
    const draftData = normalizedDraftData(body.draftData);
    const mirror = draftMirrorData(draftData);

    const existing = await prisma.report.findFirst({
        where: { id, userId, isDeleted: false },
        select: { id: true },
    });
    if (!existing) throw notFound("Taslak bulunamadı.");

    const draft = await prisma.report.update({
        where: { id },
        data: {
            ...mirror,
            clientFullName: mirror.clientFullName || "",
            addressText: mirror.addressText || "",
            parcelText: mirror.parcelText || "",
            status: "DRAFT",
            draftStep: draftStepValue(body.draftStep || draftData.step),
            draftData,
        },
        include: reportInclude,
    });

    res.json(await withSignedComparableImagesForReport(draft));
};

export const deleteReport = async (req, res) => {
    const userId = req.user.userId;
    const id = req.params.id;

    await findReport(userId, id);

    await prisma.report.update({
        where: { id },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    res.json({ ok: true });
};

export const getReport = async (req, res) => {
    const report = await findReport(req.user.userId, req.params.id);
    res.json(await withSignedComparableImagesForReport(report));
};


export const completeReport = async (req, res) => {
    const userId = req.user.userId;
    const id = req.params.id;

    const report = await findReport(userId, id);
    if (report.status !== "COMPLETED") {
        await assertCanCreateReport(prisma, userId);
    }

    const updated = await prisma.report.update({
        where: { id },
        data: {
            status: "COMPLETED",
            draftStep: null,
            draftData: null,
        },
        include: reportInclude,
    });

    res.json(await withSignedComparableImagesForReport(updated));
};

export const updateReport = async (req, res) => {
    const userId = req.user.userId;
    const id = req.params.id;
    const body = req.body || {};

    const existingReport = await findReport(userId, id);

    const data = {};
    let property = null;
    let client = null;

    if (body.propertyId !== undefined) {
        property = await getProperty(userId, body.propertyId);
        data.propertyId = property?.id || null;
        if (property?.clientId) data.clientId = property.clientId;
        if (property?.client) client = property.client;
    }

    if (body.clientId !== undefined) {
        client = await getClient(userId, body.clientId);
        data.clientId = client?.id || null;
    }

    if (property && client && property.clientId !== client.id) {
        throw badRequest("Seçilen taşınmaz bu rapor sahibi kaydıyla eşleşmiyor.", "propertyId");
    }

    if (body.clientFullName !== undefined || body.clientPhone !== undefined || body.clientEmail !== undefined || body.clientNotes !== undefined || body.client || body.newClient) {
        client = await ensureReportClient(userId, body, client || existingReport.client || null);
        if (client?.id) data.clientId = client.id;
    }

    if (body.clientFullName !== undefined) data.clientFullName = cleanString(body.clientFullName || client?.fullName);
    if (body.addressText !== undefined) data.addressText = cleanString(body.addressText || property?.addressText);
    if (body.parcelText !== undefined) data.parcelText = cleanString(body.parcelText ?? property?.parcelText ?? "");
    Object.assign(data, reportLocationData({ ...existingReport, ...body }, property || existingReport.property));
    if (body.consultantOpinion !== undefined) data.consultantOpinion = body.consultantOpinion || "";
    if (body.comparablesJson !== undefined) {
        const incomingComparablesJson = await cacheComparablesJsonImages(body.comparablesJson);
        data.comparablesJson = mergeComparablesJson(existingReport.comparablesJson, incomingComparablesJson);
    }
    if (body.marketProjectionJson !== undefined) data.marketProjectionJson = body.marketProjectionJson;
    if (body.regionalStatsJson !== undefined) data.regionalStatsJson = body.regionalStatsJson;

    const pd = sanitizePropertyDetails(body.propertyDetails);
    if (pd) data.propertyDetails = { upsert: { create: pd, update: pd } };

    const bd = sanitizeBuildingDetails(body.buildingDetails);
    if (bd) data.buildingDetails = { upsert: { create: bd, update: bd } };

    const pa = normalizePricingAnalysisForSave(body.pricingAnalysis, {
        body,
        report: existingReport,
        propertyDetails: {
            ...(existingReport.propertyDetails || {}),
            ...(pd || {}),
        },
        buildingDetails: {
            ...(existingReport.buildingDetails || {}),
            ...(bd || {}),
        },
        locationData: reportLocationData({ ...existingReport, ...body }, property || existingReport.property),
    });
    if (pa) data.pricingAnalysis = { upsert: { create: pa, update: pa } };

    const updated = await prisma.report.update({
        where: { id },
        data,
        include: reportInclude,
    });

    res.json(await withSignedComparableImagesForReport(updated));
};

export const autofillParcelData = async (req, res) => {
    const userId = req.user.userId;
    const reportId = req.params.id;
    const report = await findReport(userId, reportId);
    const result = await updateParcelDataForReport(report, req.body || {}, { requireInputs: true });
    res.json(result);
};

export const autofillComparableData = async (req, res) => {
    const userId = req.user.userId;
    const reportId = req.params.id;
    const report = await findReport(userId, reportId);
    const result = await updateComparableDataForReport(req, report, req.body || {});
    res.json(result);
};

export const autofillExternalData = async (req, res) => {
    const userId = req.user.userId;
    const reportId = req.params.id;
    const body = req.body || {};

    const report = await prisma.report.findFirst({
        where: { id: reportId, userId, isDeleted: false },
        include: {
            property: true,
            propertyDetails: true,
            buildingDetails: true,
            pricingAnalysis: true,
        },
    });
    if (!report) throw notFound("Rapor bulunamadı.");

    const location = reportLocationSource(report);
    const propertyDetails = {
        ...(report.propertyDetails || {}),
        ...(body.propertyDetails || {}),
    };
    const buildingDetails = {
        ...(report.buildingDetails || {}),
        ...(body.buildingDetails || {}),
    };

    const remaxCriteria = {
        city: cleanString(body.city ?? location.city ?? ""),
        district: cleanString(body.district ?? location.district ?? ""),
        neighborhood: cleanString(body.neighborhood ?? location.neighborhood ?? ""),
        propertyType: cleanString(body.propertyType ?? buildingDetails.propertyType ?? ""),
        reportType: cleanString(body.reportType ?? location.reportType ?? report.reportType ?? ""),
        valuationType: valuationTypeValue(body.valuationType, body.comparablesJson?.valuationType, report.comparablesJson?.valuationType),
    };
    const parcelCriteria = {
        city: cleanString(body.tkgmCity ?? location.tkgmCity ?? remaxCriteria.city),
        district: cleanString(body.tkgmDistrict ?? location.tkgmDistrict ?? remaxCriteria.district),
        neighborhood: cleanString(body.tkgmNeighborhood ?? location.tkgmNeighborhood ?? remaxCriteria.neighborhood),
        blockNo: cleanString(body.blockNo ?? location.blockNo ?? ""),
        parcelNo: cleanString(body.parcelNo ?? location.parcelNo ?? ""),
    };

    const comparableCategory = propertyCategory(remaxCriteria);
    const parcelArea = firstPositive(
        body.landArea,
        location.landArea,
        report.comparablesJson?.parcelLookup?.properties?.area
    );
    let subjectArea = comparableCategory === "land"
        ? firstPositive(body.subjectArea, parcelArea, propertyDetails.grossArea, propertyDetails.netArea)
        : firstPositive(body.subjectArea, propertyDetails.grossArea, propertyDetails.netArea, parcelArea);
    const subjectRoomText =
        comparableCategory === "residential" && propertyDetails.roomCount !== undefined && propertyDetails.roomCount !== null
            ? `${propertyDetails.roomCount}${propertyDetails.salonCount !== undefined && propertyDetails.salonCount !== null ? `+${propertyDetails.salonCount}` : ""}`
            : null;

    const warnings = [];
    let parcelLookup = report.comparablesJson?.parcelLookup || null;

    if (parcelCriteria.city && parcelCriteria.district && parcelCriteria.neighborhood && parcelCriteria.blockNo && parcelCriteria.parcelNo) {
        try {
            parcelLookup = await fetchParcelLookup(parcelCriteria);
            if (parcelLookup) {
                parcelLookup.sourceUrl = buildParcelHashUrl(parcelLookup);
                const fetchedParcelArea = firstPositive(parcelLookup?.properties?.area);
                subjectArea = comparableCategory === "land"
                    ? fetchedParcelArea || subjectArea
                    : subjectArea || fetchedParcelArea;
            }
        } catch (error) {
            warnings.push(String(error.message || error));
        }
    }

    let bundle = null;
    if (remaxCriteria.city && remaxCriteria.district) {
        try {
            bundle = await fetchComparableBundle(remaxCriteria, {
                parcelLookup,
                subjectPoint: parcelLookup?.center || null,
                subjectArea,
                subjectRoomText,
                propertyCategory: comparableCategory,
            });

            if (Array.isArray(bundle?.warnings) && bundle.warnings.length) {
                warnings.push(...bundle.warnings);
            }
        } catch (error) {
            warnings.push(String(error.message || error));
        }
    }

    if (Array.isArray(bundle?.comparables) && bundle.comparables.length > 0) {
        try {
            const imageEnrichment = await enrichComparableImages(bundle.comparables, {
                subjectLocation: {
                    city: remaxCriteria.city,
                    district: remaxCriteria.district,
                    neighborhood: remaxCriteria.neighborhood,
                    reportType: remaxCriteria.reportType,
                    propertyType: remaxCriteria.propertyType,
                    address: location.addressText,
                },
                baseUrl: publicBaseUrl(req),
            });

            bundle = {
                ...bundle,
                comparables: imageEnrichment.comparables,
                sourceMeta: {
                    ...(bundle.sourceMeta || {}),
                    enrichment: imageEnrichment.sourceMeta,
                },
            };
        } catch (error) {
            warnings.push(`Emsal görselleri zenginleştirilemedi: ${String(error.message || error)}`);
        }
    }

    if (Array.isArray(bundle?.comparables) && bundle.comparables.length > 0) {
        bundle = await cacheBundleComparableImages(bundle);
    }

    const hasComparables = Array.isArray(bundle?.comparables) && bundle.comparables.length > 0;
    if (hasComparables) {
        try {
            const cacheSave = await saveComparableListings(bundle.comparables, remaxCriteria, {
                subjectArea,
                subjectRoomText,
                sourceMeta: bundle.sourceMeta || null,
            });

            bundle = {
                ...bundle,
                sourceMeta: {
                    ...(bundle.sourceMeta || {}),
                    cacheSave,
                },
            };
        } catch (error) {
            console.warn("[EXTERNAL_DATA] cache save failed", {
                reportId,
                message: String(error.message || error),
            });
        }
    }

    if (!hasComparables && !parcelLookup) {
        throw badRequest(
            warnings[0] ||
                "Otomatik veri çekmek için taşınmazın il, ilçe, mahalle, ada ve parsel bilgileri eksiksiz olmalı."
        );
    }

    const existingComparables = Array.isArray(report.comparablesJson?.comparables)
        ? report.comparablesJson.comparables
        : [];

    if (!hasComparables && existingComparables.length) {
        warnings.push("Yeni emsal bulunamadı, varsa önceki emsaller korunmuştur.");
    }

    const nextComparablesJson = {
        ...(report.comparablesJson || {}),
        ...(body.comparablesJson || {}),
        valuationType: remaxCriteria.valuationType,
        ...(hasComparables
            ? {
                  comparables: bundle.comparables,
                  groups: bundle.groups,
                  comparableSource: bundle.sourceMeta,
                  apifyEmlakjetSource:
                      bundle.sourceMeta?.provider === "APIFY_EMLAKJET" || bundle.sourceMeta?.providers?.includes("APIFY_EMLAKJET")
                          ? bundle.sourceMeta
                          : report.comparablesJson?.apifyEmlakjetSource || null,
                  serpSnippetSource:
                      bundle.sourceMeta?.provider === "SERP_SNIPPET" || bundle.sourceMeta?.providers?.includes("SERP_SNIPPET")
                          ? bundle.sourceMeta
                          : report.comparablesJson?.serpSnippetSource || null,
              }
            : {
                  comparables: existingComparables,
                  groups: report.comparablesJson?.groups || null,
              }),
        ...(parcelLookup ? { parcelLookup } : {}),
        externalDataUpdatedAt: new Date().toISOString(),
    };

    let mapMedia = null;

    if (parcelLookup) {
        try {
            const mapCapture = await captureParcelMapImage(parcelLookup);
            if (mapCapture?.buffer) {
                mapMedia = await replaceReportMedia(reportId, {
                    type: "MAP_IMAGE",
                    buffer: mapCapture.buffer,
                    mime: mapCapture.mime,
                    filename: mapCapture.filename,
                });
                nextComparablesJson.parcelLookup = {
                    ...nextComparablesJson.parcelLookup,
                    sourceUrl: mapCapture.sourceUrl || nextComparablesJson.parcelLookup?.sourceUrl || null,
                };
            }
        } catch (error) {
            warnings.push(`TKGM harita görüntüsü alınamadı: ${String(error.message || error)}`);
        }
    }

    const policyPriceBand = hasComparables && bundle?.priceBand
        ? applyValuationPolicy(bundle.priceBand, subjectArea, remaxCriteria.valuationType, {
              buildingDetails,
              propertyDetails,
              propertyCategory: comparableCategory,
          })
        : null;
    const inferredLandArea = comparableCategory === "land" && subjectArea && subjectArea > 0 ? subjectArea : null;

    const pricingUpdate = policyPriceBand
        ? {
              minPrice: policyPriceBand.minPrice,
              expectedPrice: policyPriceBand.expectedPrice,
              maxPrice: policyPriceBand.maxPrice,
              minPricePerSqm: policyPriceBand.minPricePerSqm,
              expectedPricePerSqm: policyPriceBand.expectedPricePerSqm,
              maxPricePerSqm: policyPriceBand.maxPricePerSqm,
              confidence: policyPriceBand.confidence,
              note: publicPricingNote(report.pricingAnalysis?.note) || null,
              aiJson: {
                  ...(report.pricingAnalysis?.aiJson || {}),
                  saleStrategy: policyPriceBand.saleStrategy,
                  valuationPolicy: policyPriceBand.valuationPolicy,
                  rentalEstimate: policyPriceBand.rentalEstimate || null,
                  valuationType: remaxCriteria.valuationType,
                  sourcePriceBand: bundle.priceBand,
              },
          }
        : null;
    const regionalStats = await buildRegionalStatsForReport(
        report,
        {
            location,
            comparableCriteria: remaxCriteria,
            parcelCriteria,
        },
        nextComparablesJson.parcelLookup || parcelLookup,
        warnings
    );

    await prisma.report.update({
        where: { id: reportId },
        data: {
            ...(inferredLandArea && !toNum(location.landArea) ? { landArea: inferredLandArea } : {}),
            comparablesJson: nextComparablesJson,
            ...(hasComparables && bundle?.marketProjection ? { marketProjectionJson: bundle.marketProjection } : {}),
            regionalStatsJson: regionalStats,
            ...(pricingUpdate
                ? {
                      pricingAnalysis: {
                          upsert: {
                              create: pricingUpdate,
                              update: pricingUpdate,
                          },
                      },
                  }
                : {}),
        },
    });

    res.json({
        comparables: await withSignedComparableImageUrls(nextComparablesJson.comparables || []),
        groups: nextComparablesJson.groups || null,
        parcelLookup: nextComparablesJson.parcelLookup || null,
        marketProjection: hasComparables ? bundle?.marketProjection || null : report.marketProjectionJson || null,
        regionalStats,
        landArea: inferredLandArea,
        pricingAnalysis: pricingUpdate || report.pricingAnalysis || null,
        sourceMeta: bundle?.sourceMeta || nextComparablesJson.comparableSource || null,
        mapMedia,
        warnings,
    });
};

export const autofillLocationInsights = async (req, res) => {
    const userId = req.user.userId;
    const reportId = req.params.id;
    const body = req.body || {};
    const report = await findReport(userId, reportId);
    const context = buildExternalDataContext(report, body);
    const warnings = [];

    let parcelLookup = body.parcelLookup || body.comparablesJson?.parcelLookup || report.comparablesJson?.parcelLookup || null;
    if (!parcelLookup && hasParcelCriteria(context.parcelCriteria)) {
        try {
            parcelLookup = await fetchParcelLookup(context.parcelCriteria);
            if (parcelLookup) parcelLookup.sourceUrl = buildParcelHashUrl(parcelLookup);
        } catch (error) {
            warnings.push(`TKGM parsel sorgusu başarısız: ${String(error.message || error)}`);
        }
    }

    const regionalStats = await buildRegionalStatsForReport(report, context, parcelLookup, warnings);
    const nextComparablesJson = {
        ...(report.comparablesJson || {}),
        ...(body.comparablesJson || {}),
        ...(parcelLookup ? { parcelLookup } : {}),
        locationInsightsUpdatedAt: new Date().toISOString(),
        externalDataUpdatedAt: new Date().toISOString(),
    };

    await prisma.report.update({
        where: { id: reportId },
        data: {
            regionalStatsJson: regionalStats,
            comparablesJson: nextComparablesJson,
        },
    });

    res.json({
        regionalStats,
        parcelLookup,
        warnings,
    });
};

export const aiPriceIndex = async (req, res) => {
    const userId = req.user.userId;
    const reportId = req.params.id;

    const report = await prisma.report.findFirst({
        where: { id: reportId, userId, isDeleted: false },
        include: {
            propertyDetails: true,
            buildingDetails: true,
            pricingAnalysis: true,
            client: true,
            property: true,
        },
    });
    if (!report) throw notFound("Rapor bulunamadı.");

    const body = req.body || {};
    const location = reportLocationSource(report);
    const addressText = body.addressText ?? location.addressText ?? null;
    const valuationType = valuationTypeValue(body.valuationType, body.comparablesJson?.valuationType, report.comparablesJson?.valuationType);

    const propertyDetails = {
        ...(report.propertyDetails || {}),
        ...(body.propertyDetails || {}),
    };
    const regionalStats = body.regionalStatsJson || body.regionalStats || report.regionalStatsJson || null;

    const buildingDetails = {
        ...(report.buildingDetails || {}),
        ...(body.buildingDetails || {}),
    };

    const netArea = toNum(propertyDetails?.netArea);
    const grossArea = toNum(propertyDetails?.grossArea);
    const landArea = toNum(body.landArea ?? location.landArea ?? report.comparablesJson?.parcelLookup?.properties?.area);
    const areaForSqm = netArea || grossArea || landArea || null;

    if (!addressText) throw badRequest("AI analizi için taşınmaz adresi gerekli.", "addressText");
    if (!areaForSqm) throw badRequest("AI analizi için m² bilgisi gerekli.", "netArea");

    const comparableCategory = propertyCategory({
        reportType: body.reportType ?? location.reportType ?? report.reportType,
        propertyType: buildingDetails.propertyType,
    });
    const subjectRoomText =
        comparableCategory === "residential" && propertyDetails.roomCount !== undefined && propertyDetails.roomCount !== null
            ? `${propertyDetails.roomCount}${propertyDetails.salonCount !== undefined && propertyDetails.salonCount !== null ? `+${propertyDetails.salonCount}` : ""}`
            : null;
    const incomingComparables = comparablesFrom(body, report);
    const userComparables = selectValuationComparables(incomingComparables, {
        subjectArea: areaForSqm,
        subjectRoomText,
        propertyCategory: comparableCategory,
    });

    const input = {
        client: {
            fullName: report.client?.fullName || report.clientFullName,
        },
        addressText,
        parcelText: body.parcelText ?? location.parcelText ?? null,
        propertyDetails: {
            roomCount: propertyDetails.roomCount ?? null,
            salonCount: propertyDetails.salonCount ?? null,
            bathCount: propertyDetails.bathCount ?? null,
            grossArea: propertyDetails.grossArea ?? null,
            netArea: propertyDetails.netArea ?? null,
            landArea: landArea ?? null,
            floor: propertyDetails.floor ?? null,
            heating: propertyDetails.heating ?? null,
            terraceArea: propertyDetails.terraceArea ?? null,
            facadeDirections: propertyDetails.facadeDirections ?? null,
            viewTags: propertyDetails.viewTags ?? null,
            usageStatus: propertyDetails.usageStatus ?? null,
        },
        buildingDetails: {
            propertyType: buildingDetails.propertyType ?? null,
            buildingAge: buildingDetails.buildingAge ?? null,
            buildingFloors: buildingDetails.buildingFloors ?? null,
            isOnMainRoad: buildingDetails.isOnMainRoad ?? null,
            isOnStreet: buildingDetails.isOnStreet ?? null,
            isSite: buildingDetails.isSite ?? null,
            hasElevator: buildingDetails.hasElevator ?? null,
            openParking: buildingDetails.openParking ?? null,
            closedParking: buildingDetails.closedParking ?? null,
            hasSportsArea: buildingDetails.hasSportsArea ?? null,
            hasFitnessCenter: buildingDetails.hasFitnessCenter ?? buildingDetails.hasSportsArea ?? null,
            hasCaretaker: buildingDetails.hasCaretaker ?? null,
            hasChildrenPark: buildingDetails.hasChildrenPark ?? null,
            security: buildingDetails.security ?? null,
            openPool: buildingDetails.openPool ?? null,
            closedPool: buildingDetails.closedPool ?? null,
            hasGenerator: buildingDetails.hasGenerator ?? null,
            hasHydrophore: buildingDetails.hasHydrophore ?? null,
            hasThermalInsulation: buildingDetails.hasThermalInsulation ?? null,
            hasWaterTank: buildingDetails.hasWaterTank ?? null,
            hasAC: buildingDetails.hasAC ?? null,
            hasFireplace: buildingDetails.hasFireplace ?? null,
            buildingCondition: buildingDetails.buildingCondition ?? null,
        },
        comparables: userComparables,
        locationInsights: regionalStats
            ? {
                  summarySections: regionalStats.summarySections || null,
                  locationScore: regionalStats.locationScore || null,
                  poiSummary: regionalStats.poiSummary || regionalStats.nearbyPlacesSummary || null,
                  transitSummary: regionalStats.transitSummary || regionalStats.saleMarketSummary || null,
                  neighborhoodProfileSummary: regionalStats.neighborhoodProfileSummary || regionalStats.demographicsSummary || null,
              }
            : null,
        valuationType,
    };

    const { rawText, json } = await textToJson({
        apiKey: process.env.GEMINI_API_KEY,
        modelName: process.env.GEMINI_MODEL,
        prompt: priceIndexPrompt(),
        input,
        temperature: 0,
    });

    if (!json) {
        throw badRequest("Gemini analizi okunabilir JSON formatında üretemedi. Lütfen tekrar deneyin.", null, "GEMINI_JSON_PARSE_FAILED");
    }

    let normalized = normalizePriceIndex(json, areaForSqm);
    const compPrices = userComparables.map((c) => Number(c.price)).filter(Number.isFinite);
    const hasComparableCalibration = compPrices.length >= 2;
    const round1000 = (x) => Math.round(x / 1000) * 1000;

    if (hasComparableCalibration) {
        normalized.minPrice = round1000(quantile(compPrices, 0.2) * 0.97);
        normalized.avgPrice = round1000(quantile(compPrices, 0.5));
        normalized.maxPrice = round1000(quantile(compPrices, 0.8) * 1.03);

        if (normalized.minPrice > normalized.avgPrice) normalized.avgPrice = normalized.minPrice;
        if (normalized.avgPrice > normalized.maxPrice) normalized.maxPrice = normalized.avgPrice;

        if (areaForSqm && Number.isFinite(Number(areaForSqm)) && Number(areaForSqm) > 0) {
            normalized.minPricePerSqm = Math.round(normalized.minPrice / areaForSqm);
            normalized.avgPricePerSqm = Math.round(normalized.avgPrice / areaForSqm);
            normalized.maxPricePerSqm = Math.round(normalized.maxPrice / areaForSqm);
        }

        normalized.comps = userComparables;
        normalized.missingData = [];
        normalized.assumptions = Array.isArray(normalized.assumptions) ? normalized.assumptions : [];
        normalized.assumptions.unshift("Fiyat aralığı kullanıcı tarafından girilen emsallere göre kalibre edilmiştir.");
        if (incomingComparables.length > userComparables.length) {
            normalized.assumptions.unshift(`${incomingComparables.length - userComparables.length} uyumsuz veya silinmiş emsal AI kalibrasyonuna dahil edilmemiştir.`);
        }
        normalized.confidence = normalized.confidence ?? null;
        normalized.confidence = Number.isFinite(Number(normalized.confidence))
            ? Math.max(Number(normalized.confidence), 0.6)
            : 0.65;
    } else {
        applyFallbackPriceEstimate(normalized, {
            addressText,
            property: location,
            propertyDetails,
            buildingDetails,
            areaForSqm,
        });

        normalized.comps = userComparables;
        normalized.assumptions = Array.isArray(normalized.assumptions) ? normalized.assumptions : [];
        normalized.missingData = Array.isArray(normalized.missingData) ? normalized.missingData : [];

        if (!normalized.assumptions.some((x) => String(x).toLowerCase().includes("emsal"))) {
            normalized.assumptions.unshift("Manuel emsal girilmediği için fiyat aralığı düşük güvenli ön tahmindir.");
        }

        normalized.missingData = normalized.missingData
            .map(String)
            .filter((x) => !x.toLowerCase().includes("fiyat endeksi oluşturulamadı"));

        if (!normalized.missingData.some((x) => x.toLowerCase().includes("emsal"))) {
            normalized.missingData.unshift("Manuel emsal verisi");
        }

        normalized.confidence = Number.isFinite(Number(normalized.confidence))
            ? Math.min(Number(normalized.confidence), 0.45)
            : 0.35;
    }

    normalized = applyValuationPolicy(
        {
            ...normalized,
            expectedPrice: normalized.avgPrice,
            expectedPricePerSqm: normalized.avgPricePerSqm,
        },
        areaForSqm,
        valuationType,
        {
            buildingDetails,
            propertyDetails,
            propertyCategory: comparableCategory,
            skipAmenityPremium: !hasComparableCalibration,
        }
    );

    const note = buildAiNote(normalized);

    await prisma.report.update({
        where: { id: reportId },
        data: {
            marketProjectionJson: normalized.marketProjection || null,
            regionalStatsJson: regionalStats,
            pricingAnalysis: {
                upsert: {
                    create: {
                        minPrice: normalized.minPrice,
                        expectedPrice: normalized.expectedPrice ?? normalized.avgPrice,
                        maxPrice: normalized.maxPrice,
                        minPricePerSqm: normalized.minPricePerSqm,
                        expectedPricePerSqm: normalized.expectedPricePerSqm ?? normalized.avgPricePerSqm,
                        maxPricePerSqm: normalized.maxPricePerSqm,
                        confidence: normalized.confidence,
                        note,
                        aiJson: { raw: json, rawText, normalized, saleStrategy: normalized.saleStrategy, valuationPolicy: normalized.valuationPolicy, rentalEstimate: normalized.rentalEstimate || null, valuationType, meta: { at: new Date().toISOString(), review: "USER_CONTROLLED" } },
                    },
                    update: {
                        minPrice: normalized.minPrice,
                        expectedPrice: normalized.expectedPrice ?? normalized.avgPrice,
                        maxPrice: normalized.maxPrice,
                        minPricePerSqm: normalized.minPricePerSqm,
                        expectedPricePerSqm: normalized.expectedPricePerSqm ?? normalized.avgPricePerSqm,
                        maxPricePerSqm: normalized.maxPricePerSqm,
                        confidence: normalized.confidence,
                        note,
                        aiJson: { raw: json, rawText, normalized, saleStrategy: normalized.saleStrategy, valuationPolicy: normalized.valuationPolicy, rentalEstimate: normalized.rentalEstimate || null, valuationType, meta: { at: new Date().toISOString(), review: "USER_CONTROLLED" } },
                    },
                },
            },
            comparablesJson: {
                ...(report.comparablesJson || {}),
                ...(body.comparablesJson || {}),
                valuationType,
                comparables: userComparables,
                priceIndex: {
                    at: new Date().toISOString(),
                    input,
                    output: normalized,
                    review: "USER_CONTROLLED",
                },
            },
        },
    });

    res.json({
        ...normalized,
        regionalStats,
        aiNote: note,
        needsUserApproval: true,
        reviewMode: "USER_CONTROLLED",
    });
};
