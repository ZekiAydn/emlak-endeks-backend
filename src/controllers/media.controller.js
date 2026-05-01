import prisma from "../prisma.js";
import { buildStoredMediaData, deleteStoredMediaObject, mediaReadUrl } from "../services/mediaStorage.js";
import { badRequest, forbidden, notFound } from "../utils/errors.js";

function isAdmin(req) {
    return req.user?.role === "ADMIN";
}

async function assertUploadTarget(req, { userId, reportId }) {
    const currentUserId = req.user?.userId;
    if (!currentUserId) throw forbidden();

    if (userId && userId !== currentUserId && !isAdmin(req)) {
        throw forbidden("Başka bir kullanıcı profiline dosya yükleyemezsiniz.");
    }

    if (reportId && !isAdmin(req)) {
        const report = await prisma.report.findFirst({
            where: { id: reportId, userId: currentUserId, isDeleted: false },
            select: { id: true },
        });
        if (!report) throw notFound("Rapor bulunamadı.");
    }
}

async function findAccessibleMedia(req, id) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return null;
    if (isAdmin(req)) return media;

    const currentUserId = req.user?.userId;
    if (!currentUserId) return null;

    if (media.userId) return media.userId === currentUserId ? media : null;

    if (media.reportId) {
        const report = await prisma.report.findFirst({
            where: { id: media.reportId, userId: currentUserId, isDeleted: false },
            select: { id: true },
        });
        return report ? media : null;
    }

    return null;
}

export const upload = async (req, res) => {
    const { type, reportId, userId, order } = req.body || {};
    const file = req.file;

    if (!file) throw badRequest("Dosya seçmeniz gerekiyor.", "file");
    if (!type) throw badRequest("Dosya türü belirtilmedi.", "type");
    await assertUploadTarget(req, { userId, reportId });

    const media = await prisma.media.create({
        data: await buildStoredMediaData({
            type,
            mime: file.mimetype,
            filename: file.originalname,
            reportId: reportId || null,
            userId: userId || null,
            order: order ? Number(order) : 0,
            buffer: file.buffer,
        }),
    });

    res.json({ id: media.id, type: media.type });
};

export const getById = async (req, res) => {
    const id = req.params.id;

    const media = await findAccessibleMedia(req, id);
    if (!media) return res.status(404).end();

    const url = await mediaReadUrl(media);
    if (url) {
        res.setHeader("Cache-Control", "private, max-age=60");
        return res.redirect(302, url);
    }

    if (!media.data) return res.status(404).end();

    res.setHeader("Content-Type", media.mime);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(media.data));
};

export const getUrlById = async (req, res) => {
    const id = req.params.id;

    const media = await findAccessibleMedia(req, id);
    if (!media) return res.status(404).end();

    const url = await mediaReadUrl(media);
    if (url) {
        return res.json({
            id: media.id,
            type: media.type,
            mime: media.mime,
            filename: media.filename,
            url,
            expiresIn: 60 * 30,
        });
    }

    return res.json({
        id: media.id,
        type: media.type,
        mime: media.mime,
        filename: media.filename,
        url: null,
        expiresIn: null,
    });
};

export const deleteById = async (req, res) => {
    const id = req.params.id;

    const exists = await findAccessibleMedia(req, id);
    if (!exists) throw notFound("Dosya bulunamadı.");

    await deleteStoredMediaObject(exists);
    await prisma.media.delete({ where: { id } });
    res.json({ ok: true });
};
