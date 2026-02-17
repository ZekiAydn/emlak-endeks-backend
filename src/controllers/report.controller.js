const prisma = require("../prisma");
const { priceIndexPrompt } = require("../ai/prompts/priceIndexPrompt");
const { normalizePriceIndex } = require("../ai/normalize/priceIndexNormalize");
const { textToJson } = require("../services/geminiTextToJson");
const {sanitizePricingAnalysis, sanitizeBuildingDetails, sanitizePropertyDetails, buildAiNote} = require("../utils/reportHelpers");
const mediaSelect = {
    id: true,
    type: true,
    mime: true,
    filename: true,
    order: true,
    createdAt: true,
    userId: true,
    reportId: true
};

exports.createReport = async (req, res) => {
    const user = await prisma.user.findFirst();
    if (!user) return res.status(400).json({ error: "No user. Run POST /bootstrap first" });

    const { clientFullName, addressText, parcelText, consultantOpinion } = req.body || {};

    if (!clientFullName || !addressText || !parcelText) {
        return res.status(400).json({ error: "clientFullName, addressText, parcelText required" });
    }

    const report = await prisma.report.create({
        data: {
            userId: user.id,
            clientFullName,
            addressText,
            parcelText,
            reportDate: new Date(),
            consultantOpinion: consultantOpinion || ""
        }
    });

    res.json(report);
};

exports.listReports = async (req, res) => {
    const take = Math.min(Number(req.query.take || 50), 100);
    const skip = Number(req.query.skip || 0);

    const list = await prisma.report.findMany({
        orderBy: { createdAt: "desc" },
        take,
        skip
    });

    res.json(list);
};

exports.deleteReport = async (req, res) => {
    const id = req.params.id;

    const exists = await prisma.report.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "Not found" });

    await prisma.$transaction([
        prisma.media.deleteMany({ where: { reportId: id } }),
        prisma.propertyDetails.deleteMany({ where: { reportId: id } }),
        prisma.buildingDetails.deleteMany({ where: { reportId: id } }),
        prisma.pricingAnalysis.deleteMany({ where: { reportId: id } }),
        prisma.report.delete({ where: { id } })
    ]);

    res.json({ ok: true });
};

exports.getReport = async (req, res) => {
    const id = req.params.id;

    const report = await prisma.report.findUnique({
        where: { id },
        include: {
            user: { include: { media: { orderBy: { order: "asc" }, select: mediaSelect } } },
            media: { orderBy: { order: "asc" }, select: mediaSelect },
            propertyDetails: true,
            buildingDetails: true,
            pricingAnalysis: true
        }
    });

    if (!report) return res.status(404).json({ error: "Not found" });
    res.json(report);
};

exports.updateReport = async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};

    try {
        const data = {};

        if (body.clientFullName !== undefined) data.clientFullName = body.clientFullName;
        if (body.addressText !== undefined) data.addressText = body.addressText;
        if (body.parcelText !== undefined) data.parcelText = body.parcelText;
        if (body.consultantOpinion !== undefined) data.consultantOpinion = body.consultantOpinion;
        if (body.comparablesJson !== undefined) data.comparablesJson = body.comparablesJson;

        const pd = sanitizePropertyDetails(body.propertyDetails);
        if (pd) {
            data.propertyDetails = { upsert: { create: pd, update: pd } };
        }

        const bd = sanitizeBuildingDetails(body.buildingDetails);
        if (bd) {
            data.buildingDetails = { upsert: { create: bd, update: bd } };
        }

        const pa = sanitizePricingAnalysis(body.pricingAnalysis);
        if (pa) {
            data.pricingAnalysis = { upsert: { create: pa, update: pa } };
        }

        const updated = await prisma.report.update({
            where: { id },
            data,
            include: {
                user: { include: { media: { orderBy: { order: "asc" }, select: mediaSelect } } },
                media: { orderBy: { order: "asc" }, select: mediaSelect },
                propertyDetails: true,
                buildingDetails: true,
                pricingAnalysis: true
            }
        });

        return res.json(updated);
    } catch (e) {
        // ✅ BFF'nin HTML dönmesini engellemek için JSON error dön
        return res.status(400).json({ error: String(e.message || e) });
    }
};

exports.aiPriceIndex = async (req, res) => {
    try {
        const reportId = req.params.id;

        const report = await prisma.report.findUnique({
            where: { id: reportId },
            include: { propertyDetails: true, buildingDetails: true, pricingAnalysis: true }
        });
        if (!report) return res.status(404).json({ error: "Report not found" });

        // Body override (front kaydetmeden analiz isteyebilir)
        const body = req.body || {};

        const addressText = body.addressText ?? report.addressText ?? null;

        const propertyDetails = {
            ...(report.propertyDetails || {}),
            ...(body.propertyDetails || {})
        };

        const buildingDetails = {
            ...(report.buildingDetails || {}),
            ...(body.buildingDetails || {})
        };

        // Minimum doğrulama: adres + alanlardan en az biri
        const netArea = propertyDetails?.netArea ?? null;
        const grossArea = propertyDetails?.grossArea ?? null;
        const areaForSqm = netArea || grossArea || null;

        if (!addressText) {
            return res.status(400).json({ error: "addressText required" });
        }
        if (!areaForSqm) {
            return res.status(400).json({ error: "netArea or grossArea required for price analysis" });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        const modelName = process.env.GEMINI_MODEL;
        const prompt = priceIndexPrompt();

        const userComparablesRaw =
            (Array.isArray(body.comparables) ? body.comparables : null) ??
            (Array.isArray(body.comparablesJson?.comparables) ? body.comparablesJson.comparables : null) ??
            (Array.isArray(report.comparablesJson?.comparables) ? report.comparablesJson.comparables : null) ??
            [];

        const toNum = (v) => {
            const x = Number(v);
            return Number.isFinite(x) ? x : null;
        };

        const userComparables = userComparablesRaw.map((c) => ({
            title: c?.title ?? null,
            price: toNum(c?.price),
            netArea: toNum(c?.netArea),
            grossArea: toNum(c?.grossArea),
            floor: toNum(c?.floor),
            buildingAge: toNum(c?.buildingAge),
            distanceKm: toNum(c?.distanceKm),
        }));


        const input = {
            addressText,
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
                usageStatus: propertyDetails.usageStatus ?? null
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

                buildingCondition: buildingDetails.buildingCondition ?? null
            },
            comparables: userComparables
        };

        const { rawText, json } = await textToJson({
            apiKey,
            modelName,
            prompt,
            input,
            temperature: 0
        });

        if (!json) {
            return res.status(422).json({
                error: "Gemini JSON üretemedi / parse edilemedi",
                raw: rawText.slice(0, 2000)
            });
        }

        const normalized = normalizePriceIndex(json, areaForSqm);

        // ✅ Kullanıcı emsali varsa: fiyat aralığını emsal fiyatlarına "kilitle"
        const compPrices = userComparables.map((c) => Number(c.price)).filter(Number.isFinite);

        const round1000 = (x) => Math.round(x / 1000) * 1000;

        if (compPrices.length >= 2) {
            const minC = Math.min(...compPrices);
            const maxC = Math.max(...compPrices);
            const avgC = compPrices.reduce((a, b) => a + b, 0) / compPrices.length;

            normalized.minPrice = round1000(minC * 0.95);
            normalized.maxPrice = round1000(maxC * 1.05);
            normalized.avgPrice = round1000(avgC);

            // sıralama garantisi
            if (normalized.minPrice > normalized.avgPrice) normalized.avgPrice = normalized.minPrice;
            if (normalized.avgPrice > normalized.maxPrice) normalized.maxPrice = normalized.avgPrice;

            // m² fiyatı (konu alanı üzerinden)
            if (areaForSqm && Number.isFinite(Number(areaForSqm)) && Number(areaForSqm) > 0) {
                normalized.minPricePerSqm = Math.round(normalized.minPrice / areaForSqm);
                normalized.avgPricePerSqm = Math.round(normalized.avgPrice / areaForSqm);
                normalized.maxPricePerSqm = Math.round(normalized.maxPrice / areaForSqm);
            }

            // kullanıcı emsalini çıktı comps’a koy
            normalized.comps = userComparables;

            // kullanıcı emsal verdiyse "Eksik Veri" istemiyorsun:
            normalized.missingData = [];
            normalized.assumptions = Array.isArray(normalized.assumptions) ? normalized.assumptions : [];
            normalized.assumptions.unshift("Fiyat aralığı kullanıcı tarafından girilen emsallere göre kalibre edilmiştir.");
            normalized.confidence = normalized.confidence ?? null;
            if (normalized.confidence !== null && Number.isFinite(Number(normalized.confidence))) {
                normalized.confidence = Math.max(Number(normalized.confidence), 0.6);
            } else {
                normalized.confidence = 0.65;
            }
        }

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
                            aiJson: { raw: json, normalized, meta: { at: new Date().toISOString() } }
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
                            aiJson: { raw: json, normalized, meta: { at: new Date().toISOString() } }
                        }
                    }
                },
                comparablesJson: {
                    ...(report.comparablesJson || {}),
                    priceIndex: {
                        at: new Date().toISOString(),
                        input,
                        output: normalized
                    }
                }
            }
        });

        return res.json(normalized);
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
