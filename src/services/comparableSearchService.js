import prisma from "../prisma.js";
import { badRequest, notFound, serviceError } from "../utils/errors.js";
import SerpListingProvider from "../providers/serpListingProvider.js";
import { buildComparableSearchQueries } from "../helpers/buildComparableSearchQueries.js";
import { normalizeComparableListing } from "../helpers/normalizeComparableListing.js";
import { dedupeComparableListings, sanitizeListingUrl } from "../helpers/dedupeComparableListings.js";

export const comparableSelect = {
    id: true,
    source: true,
    externalId: true,
    title: true,
    description: true,
    price: true,
    currency: true,
    city: true,
    district: true,
    neighborhood: true,
    addressText: true,
    grossM2: true,
    netM2: true,
    roomCount: true,
    salonCount: true,
    bathCount: true,
    propertyType: true,
    buildingAge: true,
    floor: true,
    totalFloors: true,
    heating: true,
    imageUrl: true,
    imageStatus: true,
    listingUrl: true,
    providerRaw: true,
    parsedRaw: true,
    confidenceScore: true,
    missingFields: true,
    isManualVerified: true,
    isSelectedForReport: true,
    comparableGroup: true,
    pricePerSqm: true,
    createdAt: true,
    updatedAt: true,
};

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
}

function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return ["http:", "https:"].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function isNumericLike(value) {
    if (value === undefined || value === null || value === "") return true;
    if (typeof value === "number") return Number.isFinite(value);
    return /^-?\d[\d.,]*$/.test(cleanString(value));
}

function isIntegerLike(value) {
    if (value === undefined || value === null || value === "") return true;
    if (!isNumericLike(value)) return false;
    const normalized = String(value).replace(",", ".");
    return Number.isInteger(Number(normalized));
}

function validatePatchPayload(patch = {}) {
    for (const field of ["price", "grossM2", "netM2"]) {
        if (Object.prototype.hasOwnProperty.call(patch, field) && !isNumericLike(patch[field])) {
            throw badRequest(`${field} number olmalı.`, field);
        }
    }

    for (const field of ["roomCount", "salonCount", "bathCount", "buildingAge", "floor", "totalFloors"]) {
        if (Object.prototype.hasOwnProperty.call(patch, field) && !isIntegerLike(patch[field])) {
            throw badRequest(`${field} integer olmalı.`, field);
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(patch, "listingUrl") &&
        cleanString(patch.listingUrl) &&
        !isValidHttpUrl(sanitizeListingUrl(patch.listingUrl))
    ) {
        throw badRequest("listingUrl geçerli URL olmalı.", "listingUrl");
    }
}

function jsonSafe(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

function comparableDbData(normalized, { userId, reportId, preserveReportId = undefined } = {}) {
    const targetReportId = reportId !== undefined ? reportId : preserveReportId;
    return {
        userId,
        reportId: targetReportId || null,
        source: normalized.source || "OTHER",
        externalId: normalized.externalId || null,
        title: normalized.title || null,
        description: normalized.description || null,
        price: normalized.price ?? null,
        currency: normalized.currency || "TRY",
        city: normalized.city || null,
        district: normalized.district || null,
        neighborhood: normalized.neighborhood || null,
        addressText: normalized.addressText || null,
        grossM2: normalized.grossM2 ?? null,
        netM2: normalized.netM2 ?? null,
        roomCount: normalized.roomCount ?? null,
        salonCount: normalized.salonCount ?? null,
        bathCount: normalized.bathCount ?? null,
        propertyType: normalized.propertyType || null,
        buildingAge: normalized.buildingAge ?? null,
        floor: normalized.floor ?? null,
        totalFloors: normalized.totalFloors ?? null,
        heating: normalized.heating || null,
        imageUrl: normalized.imageUrl,
        imageStatus: normalized.imageStatus === "REAL" ? "REAL" : "DEFAULT",
        listingUrl: normalized.listingUrl,
        providerRaw: jsonSafe(normalized.providerRaw),
        parsedRaw: jsonSafe(normalized.parsedRaw),
        confidenceScore: normalized.confidenceScore || 0,
        missingFields: Array.isArray(normalized.missingFields) ? normalized.missingFields : [],
        isManualVerified: Boolean(normalized.isManualVerified),
        isSelectedForReport: Boolean(normalized.isSelectedForReport),
        comparableGroup: normalized.comparableGroup || null,
        pricePerSqm: normalized.pricePerSqm ?? null,
    };
}

export function toComparableDto(record) {
    if (!record) return null;
    return {
        id: record.id,
        source: record.source,
        externalId: record.externalId,
        title: record.title,
        description: record.description,
        price: record.price,
        currency: record.currency,
        city: record.city,
        district: record.district,
        neighborhood: record.neighborhood,
        addressText: record.addressText,
        grossM2: record.grossM2,
        netM2: record.netM2,
        roomCount: record.roomCount,
        salonCount: record.salonCount,
        bathCount: record.bathCount,
        propertyType: record.propertyType,
        buildingAge: record.buildingAge,
        floor: record.floor,
        totalFloors: record.totalFloors,
        heating: record.heating,
        imageUrl: record.imageUrl,
        imageStatus: record.imageStatus,
        listingUrl: record.listingUrl,
        providerRaw: record.providerRaw,
        parsedRaw: record.parsedRaw,
        confidenceScore: record.confidenceScore,
        missingFields: record.missingFields,
        isManualVerified: record.isManualVerified,
        isSelectedForReport: record.isSelectedForReport,
        comparableGroup: record.comparableGroup,
        pricePerSqm: record.pricePerSqm,
    };
}

export async function findReportForUser(userId, reportId) {
    if (!reportId) return null;

    const report = await prisma.report.findFirst({
        where: { id: reportId, userId, isDeleted: false },
        include: {
            property: true,
            propertyDetails: true,
            buildingDetails: true,
        },
    });

    if (!report) throw notFound("Rapor bulunamadı veya bu kullanıcıya ait değil.");
    return report;
}

export function buildCriteriaFromReportAndBody(body = {}, report = null) {
    const property = report?.property || {};
    const propertyDetails = report?.propertyDetails || {};
    const buildingDetails = report?.buildingDetails || {};

    return {
        reportId: firstValue(body.reportId, report?.id) || null,
        city: firstValue(body.city, report?.city, property.city),
        district: firstValue(body.district, report?.district, property.district),
        neighborhood: firstValue(body.neighborhood, report?.neighborhood, property.neighborhood),
        addressText: firstValue(body.addressText, report?.addressText, property.addressText),
        propertyType: firstValue(body.propertyType, buildingDetails.propertyType),
        roomCount: firstValue(body.roomCount, propertyDetails.roomCount),
        salonCount: firstValue(body.salonCount, propertyDetails.salonCount),
        bathCount: firstValue(body.bathCount, propertyDetails.bathCount),
        grossM2: firstValue(body.grossM2, propertyDetails.grossArea),
        netM2: firstValue(body.netM2, propertyDetails.netArea),
        buildingAge: firstValue(body.buildingAge, buildingDetails.buildingAge),
        floor: firstValue(body.floor, propertyDetails.floor),
        totalFloors: firstValue(body.totalFloors, buildingDetails.buildingFloors),
        buildingFloors: firstValue(body.buildingFloors, buildingDetails.buildingFloors),
        heating: firstValue(body.heating, propertyDetails.heating),
        listingType: firstValue(body.listingType, "satılık"),
    };
}

function validateNormalizedComparable(item, rowLabel = "Emsal") {
    if (!item.listingUrl) throw badRequest(`${rowLabel}: listingUrl zorunlu.`, "listingUrl");
    if (!isValidHttpUrl(item.listingUrl)) throw badRequest(`${rowLabel}: listingUrl geçerli bir URL olmalı.`, "listingUrl");
    if (!item.imageUrl) throw badRequest(`${rowLabel}: imageUrl sistem tarafından doldurulamadı.`, "imageUrl");
}

export async function saveComparableListings({ userId, reportId = undefined, comparables = [] }) {
    const normalized = dedupeComparableListings(comparables).map((item) => ({
        ...item,
        listingUrl: sanitizeListingUrl(item.listingUrl),
    }));

    for (const item of normalized) validateNormalizedComparable(item);

    const listingUrls = normalized.map((item) => item.listingUrl).filter(Boolean);
    const existingRecords = listingUrls.length
        ? await prisma.comparableListing.findMany({
            where: { userId, listingUrl: { in: listingUrls } },
            select: { id: true, listingUrl: true, reportId: true, isManualVerified: true, isSelectedForReport: true },
        })
        : [];

    const existingByUrl = new Map(existingRecords.map((record) => [record.listingUrl, record]));
    const saved = [];

    for (const item of normalized) {
        const existing = existingByUrl.get(item.listingUrl);
        const normalizedForSave = {
            ...item,
            isManualVerified: existing?.isManualVerified || item.isManualVerified,
            isSelectedForReport: existing?.isSelectedForReport || item.isSelectedForReport,
        };

        if (existing) {
            const updated = await prisma.comparableListing.update({
                where: { id: existing.id },
                data: comparableDbData(normalizedForSave, {
                    userId,
                    reportId,
                    preserveReportId: existing.reportId,
                }),
                select: comparableSelect,
            });
            saved.push(updated);
            continue;
        }

        const created = await prisma.comparableListing.create({
            data: comparableDbData(normalizedForSave, { userId, reportId }),
            select: comparableSelect,
        });
        saved.push(created);
    }

    return saved;
}

export async function searchComparablesForReport(userId, body = {}) {
    const reportId = cleanString(body.reportId);
    const report = await findReportForUser(userId, reportId);
    const criteria = buildCriteriaFromReportAndBody(body, report);
    const queries = buildComparableSearchQueries(criteria);

    if (!queries.length) {
        throw badRequest("Emsal arama için en az il/ilçe/adres veya konut bilgisi gerekli.");
    }

    const provider = new SerpListingProvider();
    const providerResponse = await provider.search(queries);

    if (!providerResponse.results.length && providerResponse.errors.length) {
        throw serviceError(`SerpAPI araması tamamlanamadı: ${providerResponse.errors[0].message}`);
    }

    const normalized = providerResponse.results
        .map((item) => normalizeComparableListing(
            {
                source: item.source,
                title: item.title,
                description: item.snippet,
                listingUrl: item.link,
                imageUrl: item.imageUrl,
                providerRaw: item.raw,
            },
            { context: criteria }
        ))
        .filter((item) => item.listingUrl && isValidHttpUrl(item.listingUrl));

    const saved = await saveComparableListings({
        userId,
        reportId: reportId || undefined,
        comparables: normalized,
    });

    return {
        criteria,
        queries,
        providerErrors: providerResponse.errors,
        totalFound: providerResponse.results.length,
        totalSaved: saved.length,
        comparables: saved.map(toComparableDto),
    };
}

export async function getReportComparableListings(userId, reportId) {
    await findReportForUser(userId, reportId);
    const records = await prisma.comparableListing.findMany({
        where: { userId, reportId },
        orderBy: [
            { isSelectedForReport: "desc" },
            { confidenceScore: "desc" },
            { updatedAt: "desc" },
        ],
        select: comparableSelect,
    });

    return records.map(toComparableDto);
}

const PATCHABLE_FIELDS = new Set([
    "source",
    "externalId",
    "title",
    "description",
    "price",
    "currency",
    "city",
    "district",
    "neighborhood",
    "addressText",
    "grossM2",
    "netM2",
    "roomCount",
    "salonCount",
    "bathCount",
    "propertyType",
    "buildingAge",
    "floor",
    "totalFloors",
    "heating",
    "imageUrl",
    "listingUrl",
    "providerRaw",
    "parsedRaw",
]);

export async function updateComparableListing(userId, comparableId, patch = {}) {
    const existing = await prisma.comparableListing.findFirst({
        where: { id: comparableId, userId },
        select: comparableSelect,
    });
    if (!existing) throw notFound("Emsal bulunamadı.");

    const allowedPatch = Object.fromEntries(
        Object.entries(patch || {}).filter(([key]) => PATCHABLE_FIELDS.has(key))
    );
    validatePatchPayload(allowedPatch);

    const imageWasExplicitlyCleared =
        Object.prototype.hasOwnProperty.call(allowedPatch, "imageUrl") &&
        !cleanString(allowedPatch.imageUrl);

    const merged = {
        ...existing,
        ...allowedPatch,
        imageUrl: imageWasExplicitlyCleared ? null : firstValue(allowedPatch.imageUrl, existing.imageUrl),
        isManualVerified: existing.isManualVerified,
        isSelectedForReport: existing.isSelectedForReport,
        comparableGroup: existing.comparableGroup,
    };

    const normalized = normalizeComparableListing(merged, { context: merged });
    validateNormalizedComparable(normalized);

    const updated = await prisma.comparableListing.update({
        where: { id: existing.id },
        data: comparableDbData(normalized, {
            userId,
            reportId: existing.reportId,
        }),
        select: comparableSelect,
    });

    return toComparableDto(updated);
}

export async function verifyComparableListing(userId, comparableId) {
    const existing = await prisma.comparableListing.findFirst({
        where: { id: comparableId, userId },
        select: comparableSelect,
    });
    if (!existing) throw notFound("Emsal bulunamadı.");

    const normalized = normalizeComparableListing(
        {
            ...existing,
            isManualVerified: true,
        },
        { context: existing }
    );

    const updated = await prisma.comparableListing.update({
        where: { id: existing.id },
        data: {
            ...comparableDbData(normalized, { userId, reportId: existing.reportId }),
            isManualVerified: true,
            confidenceScore: Math.min(100, Math.max(normalized.confidenceScore, Number(existing.confidenceScore || 0) + 10)),
        },
        select: comparableSelect,
    });

    return toComparableDto(updated);
}

export async function setComparableSelected(userId, comparableId, isSelectedForReport) {
    const existing = await prisma.comparableListing.findFirst({
        where: { id: comparableId, userId },
        select: { id: true },
    });
    if (!existing) throw notFound("Emsal bulunamadı.");

    const updated = await prisma.comparableListing.update({
        where: { id: existing.id },
        data: {
            isSelectedForReport: Boolean(isSelectedForReport),
            comparableGroup: isSelectedForReport ? undefined : null,
        },
        select: comparableSelect,
    });

    return toComparableDto(updated);
}
