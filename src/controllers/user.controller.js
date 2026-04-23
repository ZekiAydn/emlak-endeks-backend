const prisma = require("../prisma");
const { normalizeOptionalEmail, validateEmail, findIdentityConflict } = require("../utils/authInput");
const { badRequest, conflict, notFound, unauthorized } = require("../utils/errors");

const mediaSelect = {
    id: true, type: true, mime: true, filename: true, order: true, createdAt: true, userId: true, reportId: true
};

exports.getMe = async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) throw unauthorized("Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.");

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { media: { orderBy: { order: "asc" }, select: mediaSelect } }
    });

    if (!user) throw notFound("Kullanıcı bulunamadı.");
    res.json(user);
};

exports.updateMe = async (req, res) => {
    const userId = req.user.userId;

    const { fullName, phone, email, about } = req.body || {};
    const normalizedEmail = normalizeOptionalEmail(email);

    if (normalizedEmail) {
        const emailError = validateEmail(normalizedEmail);
        if (emailError) throw badRequest(emailError, "email");

        const exists = await findIdentityConflict(prisma, { email: normalizedEmail, excludeId: userId });
        if (exists) throw conflict("Bu e-posta adresi zaten kullanılıyor.", "email");
    }

    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            fullName,
            phone,
            ...(email !== undefined ? { email: normalizedEmail } : {}),
            about,
        }
    });

    res.json(updated);
};
