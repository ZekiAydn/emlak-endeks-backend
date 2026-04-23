const prisma = require("../prisma");
const { priceIndexPrompt } = require("../ai/prompts/priceIndexPrompt");
const { normalizePriceIndex } = require("../ai/normalize/priceIndexNormalize");
const { applyFallbackPriceEstimate, ensureProjectionSections } = require("../ai/fallback/priceEstimate");
const { textToJson } = require("../services/geminiTextToJson");
const {
    sanitizePricingAnalysis,
    sanitizeBuildingDetails,
    sanitizePropertyDetails,
    buildAiNote,
} = require("../utils/reportHelpers");
const { badRequest, notFound } = require("../utils/errors");

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

function toNum(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

async function getClient(userId, id) {
    if (!id) return null;
    const client = await prisma.client.findFirst({ where: { id, userId } });
    if (!client) throw notFound("Müşteri bulunamadı.");
    return client;
}

async function getProperty(userId, id) {
    if (!id) return null;
    const property = await prisma.property.findFirst({ where: { id, userId }, include: { client: true } });
    if (!property) throw notFound("Taşınmaz bulunamadı.");
    return property;
}

async function getReport(userId, id) {
    const report = await prisma.report.findFirst({
        where: { id, userId },
        include: reportInclude,
    });
    if (!report) throw notFound("Rapor bulunamadı.");
    return report;
}

function normalizeComparable(c) {
    const distanceMeters = toNum(c?.distanceMeters);
    const distanceKm = toNum(c?.distanceKm) ?? (distanceMeters !== null ? distanceMeters / 1000 : null);

    return {
        title: c?.title ?? null,
        source: c?.source ?? null,
        sourceUrl: c?.sourceUrl ?? null,
        price: toNum(c?.price),
        netArea: toNum(c?.netArea),
        grossArea: toNum(c?.grossArea),
        floor: toNum(c?.floor),
        totalFloors: toNum(c?.totalFloors),
        buildingAge: toNum(c?.buildingAge),
        distanceKm,
        distanceMeters,
        listingAgeDays: toNum(c?.listingAgeDays),
        roomText: c?.roomText ?? null,
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

exports.createReport = async (req, res) => {
    const userId = req.user.userId;
    const body = req.body || {};

    const property = await getProperty(userId, body.propertyId);
    const client = property?.client || (await getClient(userId, body.clientId));

    if (body.clientId && property && property.clientId !== body.clientId) {
        throw badRequest("Seçilen taşınmaz bu müşteriye ait değil.", "propertyId");
    }

    const clientFullName = cleanString(body.clientFullName || client?.fullName);
    const addressText = cleanString(body.addressText || property?.addressText);
    const parcelText = cleanString(body.parcelText ?? property?.parcelText ?? "");

    if (!clientFullName) throw badRequest("Rapor için müşteri seçmeniz veya müşteri adı girmeniz gerekiyor.", "clientId");
    if (!addressText) throw badRequest("Rapor için taşınmaz adresi gerekiyor.", "addressText");

    const data = {
        userId,
        clientId: client?.id || null,
        propertyId: property?.id || null,
        clientFullName,
        addressText,
        parcelText,
        reportDate: body.reportDate ? new Date(body.reportDate) : new Date(),
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

exports.listReports = async (req, res) => {
    const userId = req.user.userId;
    const take = Math.min(Number(req.query.take || 50), 100);
    const skip = Number(req.query.skip || 0);

    const list = await prisma.report.findMany({
        where: { userId },
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

exports.deleteReport = async (req, res) => {
    const userId = req.user.userId;
    const id = req.params.id;

    await getReport(userId, id);

    await prisma.$transaction([
        prisma.media.deleteMany({ where: { reportId: id } }),
        prisma.propertyDetails.deleteMany({ where: { reportId: id } }),
        prisma.buildingDetails.deleteMany({ where: { reportId: id } }),
        prisma.pricingAnalysis.deleteMany({ where: { reportId: id } }),
        prisma.report.delete({ where: { id } }),
    ]);

    res.json({ ok: true });
};

exports.getReport = async (req, res) => {
    const report = await getReport(req.user.userId, req.params.id);
    res.json(report);
};

exports.updateReport = async (req, res) => {
    const userId = req.user.userId;
    const id = req.params.id;
    const body = req.body || {};

    await getReport(userId, id);

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
        throw badRequest("Seçilen taşınmaz bu müşteriye ait değil.", "propertyId");
    }

    if (body.clientFullName !== undefined) data.clientFullName = cleanString(body.clientFullName || client?.fullName);
    if (body.addressText !== undefined) data.addressText = cleanString(body.addressText || property?.addressText);
    if (body.parcelText !== undefined) data.parcelText = cleanString(body.parcelText ?? property?.parcelText ?? "");
    if (body.consultantOpinion !== undefined) data.consultantOpinion = body.consultantOpinion || "";
    if (body.comparablesJson !== undefined) data.comparablesJson = body.comparablesJson;
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

exports.aiPriceIndex = async (req, res) => {
    const userId = req.user.userId;
    const reportId = req.params.id;

    const report = await prisma.report.findFirst({
        where: { id: reportId, userId },
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
    const addressText = body.addressText ?? report.addressText ?? report.property?.addressText ?? null;

    const propertyDetails = {
        ...(report.propertyDetails || {}),
        ...(body.propertyDetails || {}),
    };

    const buildingDetails = {
        ...(report.buildingDetails || {}),
        ...(body.buildingDetails || {}),
    };

    const netArea = propertyDetails?.netArea ?? null;
    const grossArea = propertyDetails?.grossArea ?? null;
    const areaForSqm = netArea || grossArea || null;

    if (!addressText) throw badRequest("AI analizi için taşınmaz adresi gerekli.", "addressText");
    if (!areaForSqm) throw badRequest("AI analizi için net m² veya brüt m² bilgisi gerekli.", "netArea");

    const userComparables = comparablesFrom(body, report);

    const input = {
        client: {
            fullName: report.client?.fullName || report.clientFullName,
        },
        addressText,
        parcelText: body.parcelText ?? report.parcelText ?? report.property?.parcelText ?? null,
        propertyDetails: {
            roomCount: propertyDetails.roomCount ?? null,
            salonCount: propertyDetails.salonCount ?? null,
            bathCount: propertyDetails.bathCount ?? null,
            grossArea: propertyDetails.grossArea ?? null,
            netArea: propertyDetails.netArea ?? null,
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

    const normalized = normalizePriceIndex(json, areaForSqm);
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
            property: report.property,
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

    ensureProjectionSections(normalized, {
        addressText,
        property: report.property,
        propertyDetails,
        buildingDetails,
        areaForSqm,
        userComparables,
    });

    const note = buildAiNote(normalized);

    await prisma.report.update({
        where: { id: reportId },
        data: {
            pricingAnalysis: {
                upsert: {
                    create: {
                        minPrice: normalized.minPrice,
                        expectedPrice: normalized.avgPrice,
                        maxPrice: normalized.maxPrice,
                        minPricePerSqm: normalized.minPricePerSqm,
                        expectedPricePerSqm: normalized.avgPricePerSqm,
                        maxPricePerSqm: normalized.maxPricePerSqm,
                        confidence: normalized.confidence,
                        note,
                        aiJson: { raw: json, rawText, normalized, meta: { at: new Date().toISOString(), review: "USER_CONTROLLED" } },
                    },
                    update: {
                        minPrice: normalized.minPrice,
                        expectedPrice: normalized.avgPrice,
                        maxPrice: normalized.maxPrice,
                        minPricePerSqm: normalized.minPricePerSqm,
                        expectedPricePerSqm: normalized.avgPricePerSqm,
                        maxPricePerSqm: normalized.maxPricePerSqm,
                        confidence: normalized.confidence,
                        note,
                        aiJson: { raw: json, rawText, normalized, meta: { at: new Date().toISOString(), review: "USER_CONTROLLED" } },
                    },
                },
            },
            comparablesJson: {
                ...(report.comparablesJson || {}),
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
        aiNote: note,
        needsUserApproval: true,
        reviewMode: "USER_CONTROLLED",
    });
};
