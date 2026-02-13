const prisma = require("../prisma");

exports.upload = async (req, res) => {
    const { type, reportId, userId, order } = req.body || {};
    const file = req.file;

    if (!file) return res.status(400).json({ error: "file required (field name: file)" });
    if (!type) return res.status(400).json({ error: "type required" });

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
    if (!exists) return res.status(404).json({ error: "Not found" });

    await prisma.media.delete({ where: { id } });
    res.json({ ok: true });
};