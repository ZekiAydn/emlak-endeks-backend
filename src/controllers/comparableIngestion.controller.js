import prisma from "../prisma.js";
import { badRequest, forbidden } from "../utils/errors.js";
import {
    discoverComparableUrls,
    fetchPendingComparableUrls,
    runComparableCronCycle,
    runComparableIngestionJob,
} from "../services/comparableIngestionService.js";
import { normalizeComparableResponse } from "../services/comparableDbSelectionService.js";

function cleanString(value) {
    return String(value || "").trim();
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function ingestionInput(body = {}) {
    return {
        city: cleanString(body.city),
        district: cleanString(body.district),
        neighborhood: cleanString(body.neighborhood),
        compoundName: cleanString(body.compoundName),
        propertyType: cleanString(body.propertyType),
        roomText: cleanString(body.roomText),
        subjectArea: toNumber(body.subjectArea),
        reportType: cleanString(body.reportType),
        fetchLimit: toNumber(body.fetchLimit),
    };
}

function requireLocation(input) {
    if (!input.city || !input.district) {
        throw badRequest("Comparable ingestion için city ve district zorunlu.", "city");
    }
}

function pagination(query = {}) {
    return {
        take: Math.min(Number(query.take || query.limit || 50), 200),
        skip: Math.max(0, Number(query.skip || 0)),
    };
}

function stringFilter(value) {
    const text = cleanString(value);
    return text ? { equals: text, mode: "insensitive" } : undefined;
}

export const discover = async (req, res) => {
    const input = ingestionInput(req.body || {});
    requireLocation(input);
    const result = await discoverComparableUrls(input);
    res.status(201).json(result);
};

export const fetchPending = async (req, res) => {
    const input = ingestionInput(req.body || {});
    const result = await fetchPendingComparableUrls({
        limit: input.fetchLimit || toNumber(req.body?.limit),
        input,
    });
    res.json(result);
};

export const run = async (req, res) => {
    const input = ingestionInput(req.body || {});
    requireLocation(input);
    const result = await runComparableIngestionJob(input);
    res.status(202).json(result);
};

export const listComparableListings = async (req, res) => {
    const { take, skip } = pagination(req.query);
    const minDataQuality = toNumber(req.query.minDataQuality);
    const hasImage = cleanString(req.query.hasImage).toLowerCase();
    const where = {
        city: stringFilter(req.query.city),
        district: stringFilter(req.query.district),
        neighborhood: stringFilter(req.query.neighborhood),
        compoundName: stringFilter(req.query.compoundName),
        propertyType: stringFilter(req.query.propertyType),
        roomText: cleanString(req.query.roomText) || undefined,
        freshnessStatus: cleanString(req.query.freshnessStatus) || undefined,
        source: stringFilter(req.query.source),
        ...(minDataQuality !== null ? { dataQuality: { gte: minDataQuality } } : {}),
        ...(hasImage === "true" || hasImage === "1" ? { imageStatus: "REAL" } : {}),
        ...(hasImage === "false" || hasImage === "0" ? { imageStatus: "DEFAULT" } : {}),
    };

    Object.keys(where).forEach((key) => where[key] === undefined && delete where[key]);

    const [items, total] = await Promise.all([
        prisma.comparableListing.findMany({
            where,
            orderBy: [{ freshnessStatus: "asc" }, { dataQuality: "desc" }, { updatedAt: "desc" }],
            take,
            skip,
        }),
        prisma.comparableListing.count({ where }),
    ]);

    res.json({
        total,
        take,
        skip,
        comparables: items.map((item) => normalizeComparableResponse(item)),
    });
};

export const listComparableSearchResults = async (req, res) => {
    const { take, skip } = pagination(req.query);
    const where = {
        city: stringFilter(req.query.city),
        district: stringFilter(req.query.district),
        neighborhood: stringFilter(req.query.neighborhood),
        status: cleanString(req.query.status) || undefined,
        query: cleanString(req.query.query) ? { contains: cleanString(req.query.query), mode: "insensitive" } : undefined,
    };
    Object.keys(where).forEach((key) => where[key] === undefined && delete where[key]);

    const [items, total] = await Promise.all([
        prisma.comparableSearchResult.findMany({
            where,
            orderBy: { updatedAt: "desc" },
            take,
            skip,
        }),
        prisma.comparableSearchResult.count({ where }),
    ]);

    res.json({ total, take, skip, results: items });
};

export const cronComparableIngestion = async (req, res) => {
    const expected = cleanString(process.env.INTERNAL_CRON_SECRET);
    if (!expected) throw forbidden("INTERNAL_CRON_SECRET tanımlı değil.");
    if (cleanString(req.headers["x-internal-secret"]) !== expected) {
        throw forbidden("Internal cron secret geçersiz.");
    }

    const result = await runComparableCronCycle(req.body || {});
    res.json(result);
};
