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
import { propertyCategory } from "../services/propertyCategory.js";
import { applyValuationPolicy } from "../services/valuationPolicy.js";
import {
    buildComparableBundleFromDbSelection,
    createIngestionJobIfComparablePoolLow,
    selectComparablesForReport,
} from "../services/comparableDbSelectionService.js";
import {
    discoverComparableUrls,
    fetchPendingComparableUrls,
} from "../services/comparableIngestionService.js";


const mediaSelect = {
    id: true,
    type: true,
    mime: true,
    filename: true,
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

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function cleanOptional(value) {
    const text = cleanString(value);
    return text || null;
}

function uniqueCleanStrings(values = []) {
    const seen = new Set();
    const out = [];
    for (const value of values.map(cleanString).filter(Boolean)) {
        const key = value.toLocaleLowerCase("tr-TR");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}

function comparableIsPlaceholder(item = {}) {
    return item?.source === "DEFAULT_PLACEHOLDER";
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
    const configured = process.env.BACKEND_PUBLIC_URL || process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
    if (configured) return configured.replace(/\/$/, "");

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
        netArea: toNum(c?.netArea ?? c?.netAreaM2 ?? c?.netM2),
        grossArea: toNum(c?.grossArea ?? c?.grossAreaM2 ?? c?.grossM2),
        floor,
        floorText: c?.floorText ?? (floor === null && typeof c?.floor === "string" ? c.floor : null),
        totalFloors: toNum(c?.totalFloors),
        buildingAge: toNum(c?.buildingAge),
        distanceKm,
        distanceMeters,
        listingAgeDays: toNum(c?.listingAgeDays),
        roomText: c?.roomText ?? null,
        imageUrl: c?.imageUrl ?? null,
        imageSource: c?.imageSource ?? null,
        imageAttribution: c?.imageAttribution ?? null,
        address: c?.address ?? null,
        city: c?.city ?? null,
        district: c?.district ?? null,
        neighborhood: c?.neighborhood ?? null,
        compoundName: c?.compoundName ?? null,
        propertyType: c?.propertyType ?? null,
        externalId: c?.externalId ?? null,
        createdAt: c?.createdAt ?? null,
        group: c?.group ?? null,
        comparableGroup: c?.comparableGroup ?? c?.group ?? null,
        provider: c?.provider ?? null,
        pricePerSqm: toNum(c?.pricePerSqm ?? c?.pricePerM2),
        dataQuality: toNum(c?.dataQuality),
        matchScore: toNum(c?.matchScore),
        matchLevel: c?.matchLevel ?? null,
        freshnessStatus: c?.freshnessStatus ?? null,
        latitude: toNum(c?.latitude),
        longitude: toNum(c?.longitude),
    };
}

const GENERATED_IMAGE_SOURCES = new Set([
    "brand-mock",
    "google-street-view",
    "nearby-listing-pool",
]);

function hasListingPhoto(item) {
    const imageUrl = cleanString(item?.imageUrl || "");
    if (!imageUrl) return false;

    const imageSource = cleanString(item?.imageSource || "").toLowerCase();
    if (GENERATED_IMAGE_SOURCES.has(imageSource)) return false;
    if (/\/comparables\/(?:mock-image|street-view)\b/i.test(imageUrl)) return false;

    return true;
}

function filterComparablesWithPhotos(comparables = []) {
    const input = Array.isArray(comparables) ? comparables : [];
    const filtered = input.filter(hasListingPhoto);
    const minKeep = Number(process.env.COMPARABLE_MIN_PHOTO_FILTERED || 12);

    if (input.length > 0 && filtered.length < Math.min(minKeep, input.length)) {
        return {
            comparables: input,
            removedCount: 0,
            skipped: true,
            realPhotoCount: filtered.length,
        };
    }

    return {
        comparables: filtered,
        removedCount: Math.max(0, input.length - filtered.length),
        skipped: false,
        realPhotoCount: filtered.length,
    };
}

function comparablesFrom(body, report) {
    const raw =
        (Array.isArray(body.comparables) ? body.comparables : null) ??
        (Array.isArray(body.comparablesJson?.comparables) ? body.comparablesJson.comparables : null) ??
        (Array.isArray(report?.comparablesJson?.comparables) ? report.comparablesJson.comparables : null) ??
        [];

    return raw.map(normalizeComparable);
}

function averageNumber(values = []) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return null;
    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

function buildComparableAiSummary(comparables = [], meta = {}) {
    const list = Array.isArray(comparables) ? comparables : [];
    const byGroup = (group) => list.filter((item) => cleanString(item.group || item.comparableGroup).toLowerCase() === group);
    const sameLevelCount = (levels = []) => list.filter((item) => levels.includes(item.matchLevel)).length;

    return {
        totalCandidateCount: meta?.candidateCount ?? null,
        selectedComparableCount: list.length,
        lowBandAveragePricePerM2: averageNumber(byGroup("low").map((item) => item.pricePerM2)),
        midBandAveragePricePerM2: averageNumber(byGroup("mid").map((item) => item.pricePerM2)),
        highBandAveragePricePerM2: averageNumber(byGroup("high").map((item) => item.pricePerM2)),
        averagePricePerM2: averageNumber(list.map((item) => item.pricePerM2)),
        imageCount: meta?.imageCount ?? list.filter((item) => cleanString(item.imageUrl) && item.imageSource !== "DEFAULT").length,
        freshCount: meta?.freshCount ?? list.filter((item) => item.freshnessStatus === "FRESH").length,
        staleCount: meta?.staleCount ?? list.filter((item) => item.freshnessStatus === "STALE").length,
        matchLevelSummary: meta?.matchLevelSummary || {},
        projectOrNeighborhoodCount: sameLevelCount(["PROJECT_EXACT", "NEIGHBORHOOD_EXACT", "NEIGHBORHOOD_RELAXED"]),
        districtCount: sameLevelCount(["DISTRICT_ROOM_AREA", "DISTRICT_GENERAL"]),
    };
}

function reportSyncIngestionEnabled() {
    return process.env.COMPARABLE_REPORT_SYNC_INGESTION !== "false";
}

async function warmComparablePoolForReport(input = {}) {
    if (!reportSyncIngestionEnabled()) return null;
    if (!cleanString(input.city) || !cleanString(input.district)) return null;

    const startedAt = Date.now();
    const timeoutMs = envNumber("COMPARABLE_REPORT_SYNC_TIMEOUT_MS", 110000);
    const maxQueries = envNumber("COMPARABLE_REPORT_SYNC_MAX_QUERIES", 24);
    const targetUrls = envNumber("COMPARABLE_REPORT_SYNC_TARGET_URLS", 80);
    const fetchLimit = envNumber("COMPARABLE_REPORT_SYNC_FETCH_LIMIT", 24);
    const searchTimeoutMs = Math.min(
        envNumber("SERPAPI_TIMEOUT_MS", 12000),
        Math.max(4000, Math.floor(timeoutMs / Math.max(maxQueries, 1)) - 500)
    );

    const discovery = await discoverComparableUrls(input, {
        maxQueries,
        targetResults: targetUrls,
        targetUrls,
        timeoutMs: searchTimeoutMs,
    });

    const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const fetch = remainingMs > 5000
        ? await fetchPendingComparableUrls({
              limit: fetchLimit,
              input,
              timeoutMs: remainingMs,
          })
        : null;

    return {
        elapsedMs: Date.now() - startedAt,
        discovery: discovery?.summary || null,
        providerErrors: Array.isArray(discovery?.providerErrors) ? discovery.providerErrors.slice(0, 3) : [],
        fetch: fetch?.summary || null,
    };
}

function sourceMetaForProvider(sourceMeta, providerName) {
    if (!sourceMeta || !providerName) return null;
    if (sourceMeta.provider === providerName) return sourceMeta;

    const detail = Array.isArray(sourceMeta.providerDetails)
        ? sourceMeta.providerDetails.find((item) => item?.provider === providerName)
        : null;

    return detail || null;
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

async function replaceReportMedia(reportId, { type, buffer, mime, filename }) {
    if (!reportId || !type || !buffer || !mime) return null;

    await prisma.media.deleteMany({
        where: { reportId, type },
    });

    return await prisma.media.create({
        data: {
            reportId,
            type,
            data: buffer,
            mime,
            filename: filename || null,
            order: 0,
        },
        select: mediaSelect,
    });
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
    const client = property?.client || (await getClient(userId, body.clientId));

    if (body.clientId && property && property.clientId !== body.clientId) {
        throw badRequest("Seçilen taşınmaz bu rapor sahibi kaydıyla eşleşmiyor.", "propertyId");
    }

    const clientFullName = cleanString(body.clientFullName || client?.fullName);
    const addressText = cleanString(body.addressText || property?.addressText);
    const parcelText = cleanString(body.parcelText ?? property?.parcelText ?? "");

    if (!clientFullName) throw badRequest("Rapor sahibi adı girmeniz gerekiyor.", "clientFullName");
    if (!addressText) throw badRequest("Rapor için taşınmaz adresi gerekiyor.", "addressText");

    const data = {
        userId,
        clientId: client?.id || null,
        propertyId: property?.id || null,
        ...reportLocationData(body, property),
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

    const pd = sanitizePropertyDetails(body.propertyDetails);
    if (pd) data.propertyDetails = { create: pd };

    const bd = sanitizeBuildingDetails(body.buildingDetails);
    if (bd) data.buildingDetails = { create: bd };

    const pa = sanitizePricingAnalysis(body.pricingAnalysis);
    if (pa) data.pricingAnalysis = { create: pa };

    const report = await prisma.report.create({
        data,
        include: reportInclude,
    });

    res.status(201).json(report);
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

    res.json(draft || null);
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

    res.status(201).json(draft);
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

    res.json(draft);
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
    res.json(report);
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

    res.json(updated);
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
    }

    if (body.clientId !== undefined) {
        client = await getClient(userId, body.clientId);
        data.clientId = client?.id || null;
    }

    if (property && client && property.clientId !== client.id) {
        throw badRequest("Seçilen taşınmaz bu rapor sahibi kaydıyla eşleşmiyor.", "propertyId");
    }

    if (body.clientFullName !== undefined) data.clientFullName = cleanString(body.clientFullName || client?.fullName);
    if (body.addressText !== undefined) data.addressText = cleanString(body.addressText || property?.addressText);
    if (body.parcelText !== undefined) data.parcelText = cleanString(body.parcelText ?? property?.parcelText ?? "");
    Object.assign(data, reportLocationData({ ...existingReport, ...body }, property || existingReport.property));
    if (body.consultantOpinion !== undefined) data.consultantOpinion = body.consultantOpinion || "";
    if (body.comparablesJson !== undefined) data.comparablesJson = mergeComparablesJson(existingReport.comparablesJson, body.comparablesJson);
    if (body.marketProjectionJson !== undefined) data.marketProjectionJson = body.marketProjectionJson;
    if (body.regionalStatsJson !== undefined) data.regionalStatsJson = body.regionalStatsJson;

    const pd = sanitizePropertyDetails(body.propertyDetails);
    if (pd) data.propertyDetails = { upsert: { create: pd, update: pd } };

    const bd = sanitizeBuildingDetails(body.buildingDetails);
    if (bd) data.buildingDetails = { upsert: { create: bd, update: bd } };

    const pa = sanitizePricingAnalysis(body.pricingAnalysis);
    if (pa) data.pricingAnalysis = { upsert: { create: pa, update: pa } };

    const updated = await prisma.report.update({
        where: { id },
        data,
        include: reportInclude,
    });

    res.json(updated);
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
        searchText: cleanString(
            body.searchText ??
                body.listingTitle ??
                body.title ??
                body.comparablesJson?.searchText ??
                report.property?.title ??
                ""
        ),
        addressText: cleanString(body.addressText ?? location.addressText ?? report.addressText ?? ""),
    };
    const parcelCriteria = {
        city: cleanString(body.tkgmCity ?? location.tkgmCity ?? remaxCriteria.city),
        district: cleanString(body.tkgmDistrict ?? location.tkgmDistrict ?? remaxCriteria.district),
        neighborhood: cleanString(body.tkgmNeighborhood ?? location.tkgmNeighborhood ?? remaxCriteria.neighborhood),
        blockNo: cleanString(body.blockNo ?? location.blockNo ?? ""),
        parcelNo: cleanString(body.parcelNo ?? location.parcelNo ?? ""),
    };

    let subjectArea =
        toNum(body.subjectArea) ??
        toNum(propertyDetails.netArea) ??
        toNum(propertyDetails.grossArea) ??
        toNum(body.landArea) ??
        toNum(location.landArea) ??
        null;
    const comparableCategory = propertyCategory(remaxCriteria);
    const subjectRoomText =
        comparableCategory === "residential" && propertyDetails.roomCount !== undefined && propertyDetails.roomCount !== null
            ? `${propertyDetails.roomCount}${propertyDetails.salonCount !== undefined && propertyDetails.salonCount !== null ? `+${propertyDetails.salonCount}` : ""}`
            : null;
    if (subjectRoomText) remaxCriteria.roomText = subjectRoomText;

    const warnings = [];
    let parcelLookup = report.comparablesJson?.parcelLookup || null;

    if (parcelCriteria.city && parcelCriteria.district && parcelCriteria.neighborhood && parcelCriteria.blockNo && parcelCriteria.parcelNo) {
        try {
            parcelLookup = await fetchParcelLookup(parcelCriteria);
            if (parcelLookup) {
                parcelLookup.sourceUrl = buildParcelHashUrl(parcelLookup);
                subjectArea = subjectArea ?? toNum(parcelLookup?.properties?.area);
            }
        } catch (error) {
            warnings.push(String(error.message || error));
        }
    }

    let bundle = null;
    let comparableSelection = null;
    let ingestionJob = null;
    let syncIngestion = null;
    if (remaxCriteria.city && remaxCriteria.district) {
        try {
            const comparableInput = {
                city: remaxCriteria.city,
                district: remaxCriteria.district,
                neighborhood: remaxCriteria.neighborhood,
                nearbyNeighborhoods: uniqueCleanStrings([
                    location.tkgmNeighborhood,
                    parcelLookup?.properties?.neighborhood,
                ]).filter((name) => name.toLocaleLowerCase("tr-TR") !== cleanString(remaxCriteria.neighborhood).toLocaleLowerCase("tr-TR")),
                compoundName: cleanString(body.compoundName ?? body.projectName ?? body.siteName ?? ""),
                propertyType: remaxCriteria.propertyType,
                roomText: subjectRoomText || remaxCriteria.roomText || cleanString(body.roomText || ""),
                subjectArea,
                reportType: remaxCriteria.reportType,
                valuationType: remaxCriteria.valuationType,
            };
            comparableSelection = await selectComparablesForReport(comparableInput);

            if ((comparableSelection?.candidateCount || 0) === 0 || comparableSelection?.comparableStatus === "EMPTY") {
                syncIngestion = await warmComparablePoolForReport(comparableInput);
                if (syncIngestion) {
                    comparableSelection = await selectComparablesForReport({
                        ...comparableInput,
                        bypassCache: true,
                    });
                    warnings.push(`Boş emsal havuzu için canlı discovery çalıştırıldı (${syncIngestion.elapsedMs} ms).`);
                    const providerErrorMessage = cleanString(syncIngestion.providerErrors?.[0]?.message || "");
                    if (providerErrorMessage) {
                        warnings.push(`Search API discovery sonuç alamadı: ${providerErrorMessage}`);
                    }
                }
            }

            bundle = buildComparableBundleFromDbSelection(comparableSelection, {
                subjectArea,
            });

            if (Array.isArray(bundle?.warnings) && bundle.warnings.length) {
                warnings.push(...bundle.warnings);
            }

            ingestionJob = await createIngestionJobIfComparablePoolLow(
                {
                    city: remaxCriteria.city,
                    district: remaxCriteria.district,
                    neighborhood: remaxCriteria.neighborhood,
                    compoundName: cleanString(body.compoundName ?? body.projectName ?? body.siteName ?? ""),
                    propertyType: remaxCriteria.propertyType,
                    roomText: subjectRoomText || remaxCriteria.roomText || cleanString(body.roomText || ""),
                    subjectArea,
                    reportType: remaxCriteria.reportType,
                },
                comparableSelection
            );
            if (ingestionJob) {
                warnings.push("Emsal havuzu düşük olduğu için arka plan ingestion job kaydı açıldı; rapor mevcut DB emsalleriyle üretildi.");
            }
        } catch (error) {
            warnings.push(String(error.message || error));
        }
    }

    const bundleComparables = Array.isArray(bundle?.comparables) ? bundle.comparables : [];
    const hasBundleComparables = bundleComparables.length > 0;
    const hasRealComparables = bundleComparables.some((item) => !comparableIsPlaceholder(item));
    const emlakjetSource = hasRealComparables ? sourceMetaForProvider(bundle.sourceMeta, "EMLAKJET_HTML") : null;
    const remaxSource = hasRealComparables ? sourceMetaForProvider(bundle.sourceMeta, "REMAX") : null;
    const hepsiemlakSource = hasRealComparables ? sourceMetaForProvider(bundle.sourceMeta, "HEPSIEMLAK_HTML") : null;
    const sahibindenSource = hasRealComparables ? sourceMetaForProvider(bundle.sourceMeta, "SAHIBINDEN_HTML") : null;
    const serpSnippetSource = hasRealComparables ? sourceMetaForProvider(bundle.sourceMeta, "SERP_SNIPPET") : null;

    if (!hasBundleComparables && !parcelLookup) {
        throw badRequest(
            warnings[0] ||
                "Otomatik veri çekmek için taşınmazın il, ilçe, mahalle, ada ve parsel bilgileri eksiksiz olmalı."
        );
    }

    const existingComparables = Array.isArray(report.comparablesJson?.comparables)
        ? report.comparablesJson.comparables
        : [];

    if (!hasBundleComparables && existingComparables.length) {
        warnings.push("Yeni emsal bulunamadı, varsa önceki emsaller korunmuştur.");
    }

    const nextComparablesJson = {
        ...(report.comparablesJson || {}),
        ...(body.comparablesJson || {}),
        valuationType: remaxCriteria.valuationType,
        ...(hasBundleComparables
            ? {
                  comparables: bundle.comparables,
                  groups: bundle.groups,
                  comparableSource: bundle.sourceMeta,
                  comparableSelection: comparableSelection
                      ? {
                            comparableStatus: comparableSelection.comparableStatus,
                            comparableSource: comparableSelection.comparableSource,
                            comparableCount: comparableSelection.comparableCount,
                            candidateCount: comparableSelection.candidateCount,
                            freshCount: comparableSelection.freshCount,
                            staleCount: comparableSelection.staleCount,
                            imageCount: comparableSelection.imageCount,
                            bandSummary: comparableSelection.bandSummary,
                            matchLevelSummary: comparableSelection.matchLevelSummary,
                            cacheHit: comparableSelection.cacheHit,
                        }
                      : null,
                  comparableIngestionJobId: ingestionJob?.id || null,
                  comparableSyncIngestion: syncIngestion,
                  emlakjetSource: emlakjetSource || report.comparablesJson?.emlakjetSource || null,
                  remaxSource: remaxSource || report.comparablesJson?.remaxSource || null,
                  hepsiemlakSource: hepsiemlakSource || report.comparablesJson?.hepsiemlakSource || null,
                  sahibindenSource: sahibindenSource || report.comparablesJson?.sahibindenSource || null,
                  serpSnippetSource: serpSnippetSource || report.comparablesJson?.serpSnippetSource || null,
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

    const policyPriceBand = hasRealComparables && bundle?.priceBand
        ? applyValuationPolicy(bundle.priceBand, subjectArea, remaxCriteria.valuationType)
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
              note: report.pricingAnalysis?.note || policyPriceBand.note,
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

    await prisma.report.update({
        where: { id: reportId },
        data: {
            ...(inferredLandArea && !toNum(location.landArea) ? { landArea: inferredLandArea } : {}),
            comparablesJson: nextComparablesJson,
            ...(hasRealComparables && bundle?.marketProjection ? { marketProjectionJson: bundle.marketProjection } : {}),
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
        comparables: nextComparablesJson.comparables || [],
        groups: nextComparablesJson.groups || null,
        parcelLookup: nextComparablesJson.parcelLookup || null,
        marketProjection: hasRealComparables ? bundle?.marketProjection || null : null,
        regionalStats: null,
        landArea: inferredLandArea,
        pricingAnalysis: pricingUpdate || report.pricingAnalysis || null,
        sourceMeta: bundle?.sourceMeta || nextComparablesJson.comparableSource || null,
        comparableSelection: nextComparablesJson.comparableSelection || null,
        comparableIngestionJobId: ingestionJob?.id || null,
        comparableSyncIngestion: syncIngestion,
        mapMedia,
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

    const userComparables = comparablesFrom(body, report);
    const comparableSelectionMeta =
        body.comparablesJson?.comparableSelection ||
        report.comparablesJson?.comparableSelection ||
        report.comparablesJson?.comparableSource ||
        {};

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
            hasCaretaker: buildingDetails.hasCaretaker ?? null,
            hasChildrenPark: buildingDetails.hasChildrenPark ?? null,
            security: buildingDetails.security ?? null,
            openPool: buildingDetails.openPool ?? null,
            closedPool: buildingDetails.closedPool ?? null,
            hasGenerator: buildingDetails.hasGenerator ?? null,
            hasThermalInsulation: buildingDetails.hasThermalInsulation ?? null,
            hasAC: buildingDetails.hasAC ?? null,
            hasFireplace: buildingDetails.hasFireplace ?? null,
            buildingCondition: buildingDetails.buildingCondition ?? null,
        },
        comparables: userComparables,
        comparableSummary: buildComparableAiSummary(userComparables, comparableSelectionMeta),
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
    const round1000 = (x) => Math.round(x / 1000) * 1000;

    if (compPrices.length >= 2) {
        const minC = Math.min(...compPrices);
        const maxC = Math.max(...compPrices);
        const avgC = compPrices.reduce((a, b) => a + b, 0) / compPrices.length;

        normalized.minPrice = round1000(minC * 0.95);
        normalized.maxPrice = round1000(maxC * 1.05);
        normalized.avgPrice = round1000(avgC);

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
        valuationType
    );

    const note = buildAiNote(normalized);

    await prisma.report.update({
        where: { id: reportId },
        data: {
            marketProjectionJson: normalized.marketProjection || null,
            regionalStatsJson: null,
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
        regionalStats: null,
        aiNote: note,
        needsUserApproval: true,
        reviewMode: "USER_CONTROLLED",
    });
};
