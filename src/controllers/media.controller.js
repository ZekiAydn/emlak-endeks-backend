const prisma = require("../prisma");
const { badRequest, notFound } = require("../utils/errors");

exports.upload = async (req, res) => {
    const { type, reportId, userId, order } = req.body || {};
    const file = req.file;

    if (!file) throw badRequest("Dosya seçmeniz gerekiyor.", "file");
    if (!type) throw badRequest("Dosya türü belirtilmedi.", "type");

    const media = await prisma.media.create({
        data: {
            type,
            mime: file.mimetype,
            filename: file.originalname,
            data: file.buffer,
            reportId: reportId || null,
            userId: userId || null,
            order: order ? Number(order) : 0
        }
    });

    res.json({ id: media.id, type: media.type });
};

exports.getById = async (req, res) => {
    const id = req.params.id;

    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return res.status(404).end();

    res.setHeader("Content-Type", media.mime);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(media.data));
};

exports.deleteById = async (req, res) => {
    const id = req.params.id;

    const exists = await prisma.media.findUnique({ where: { id } });
    if (!exists) throw notFound("Dosya bulunamadı.");

    await prisma.media.delete({ where: { id } });
    res.json({ ok: true });
};
