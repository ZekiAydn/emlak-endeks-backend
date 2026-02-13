const prisma = require("../prisma");
const { pickDefined } = require("../utils/aiJson");

const { sahibindenAutofillPrompt } = require("../ai/prompts/sahibindenAutofillPrompt");
const { normalizeSahibinden } = require("../ai/normalize/sahibindenNormalize");

const { visionToJson } = require("../services/geminiVision");

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

    // ✅ sadece gelen alanları uygula (undefined ile ezme yok)
    const data = {};
    if (body.clientFullName !== undefined) data.clientFullName = body.clientFullName;
    if (body.addressText !== undefined) data.addressText = body.addressText;
    if (body.parcelText !== undefined) data.parcelText = body.parcelText;
    if (body.consultantOpinion !== undefined) data.consultantOpinion = body.consultantOpinion;
    if (body.comparablesJson !== undefined) data.comparablesJson = body.comparablesJson;

    if (body.propertyDetails) {
        data.propertyDetails = {
            upsert: { create: body.propertyDetails, update: body.propertyDetails }
        };
    }

    if (body.buildingDetails) {
        data.buildingDetails = {
            upsert: { create: body.buildingDetails, update: body.buildingDetails }
        };
    }

    if (body.pricingAnalysis) {
        data.pricingAnalysis = {
            upsert: { create: body.pricingAnalysis, update: body.pricingAnalysis }
        };
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

    res.json(updated);
};

exports.aiAutofill = async (req, res) => {
    try {
        const reportId = req.params.id;
        const { imageMediaId } = req.body || {};

        if (!imageMediaId) {
            return res.status(400).json({ error: "imageMediaId required (ilan ekran görüntüsü)" });
        }

        const report = await prisma.report.findUnique({ where: { id: reportId } });
        if (!report) return res.status(404).json({ error: "Report not found" });

        const media = await prisma.media.findUnique({ where: { id: imageMediaId } });
        if (!media) return res.status(404).json({ error: "Media not found" });

        // ✅ güvenlik: yanlış rapora bağlı media engelle
        if (media.reportId && media.reportId !== reportId) {
            return res.status(400).json({ error: "This media does not belong to this report" });
        }

        // ✅ sadece image
        if (!String(media.mime || "").startsWith("image/")) {
            return res.status(400).json({ error: "Only image uploads supported for AI autofill" });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";
        const prompt = sahibindenAutofillPrompt();

        const { rawText, json } = await visionToJson({
            apiKey,
            modelName,
            prompt,
            imageBuffer: media.data,
            mimeType: media.mime || "image/jpeg",
            temperature: 0
        });

        if (!json) {
            return res.status(422).json({
                error: "Gemini JSON üretemedi / parse edilemedi",
                raw: rawText.slice(0, 2000)
            });
        }

        const extracted = normalizeSahibinden(json);

        const reportData = {};
        if (extracted.addressText) reportData.addressText = extracted.addressText;
        if (extracted.parcelText) reportData.parcelText = extracted.parcelText;

        reportData.propertyDetails = {
            upsert: {
                create: pickDefined(extracted.propertyDetails),
                update: pickDefined(extracted.propertyDetails)
            }
        };

        reportData.buildingDetails = {
            upsert: {
                create: pickDefined(extracted.buildingDetails),
                update: pickDefined(extracted.buildingDetails)
            }
        };

        reportData.pricingAnalysis = {
            upsert: {
                create: pickDefined(extracted.pricingAnalysis),
                update: pickDefined(extracted.pricingAnalysis)
            }
        };

        // ✅ şema dışı alanları da düzenli sakla
        reportData.comparablesJson = {
            ...(report.comparablesJson || {}),
            listing: extracted.listing || null,
            listingExtras: extracted.extras || null,
            geminiAutofill: {
                at: new Date().toISOString(),
                imageMediaId,
                extracted
            }
        };

        await prisma.report.update({
            where: { id: reportId },
            data: reportData
        });

        return res.json(extracted);
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
