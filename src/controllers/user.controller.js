import prisma from "../prisma.js";
import { normalizeOptionalEmail, normalizePhone, validateEmail, validatePhone, findIdentityConflict } from "../utils/authInput.js";
import { PLAN_DEFINITIONS, getSubscriptionSummary } from "../services/subscriptionPlans.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../utils/errors.js";

const mediaSelect = {
    id: true, type: true, mime: true, filename: true, order: true, createdAt: true, userId: true, reportId: true
};

export const getMe = async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) throw unauthorized("Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.");

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { media: { orderBy: { order: "asc" }, select: mediaSelect } }
    });

    if (!user) throw notFound("Kullanıcı bulunamadı.");

    const { passwordHash, ...safeUser } = user;
    safeUser.subscription = await getSubscriptionSummary(prisma, userId);

    res.json(safeUser);
};

export const updateMe = async (req, res) => {
    const userId = req.user.userId;

    const { fullName, phone, email, about } = req.body || {};
    const normalizedEmail = normalizeOptionalEmail(email);
    const normalizedPhone = phone === undefined ? undefined : normalizePhone(phone);
    const currentUser = phone === undefined
        ? null
        : await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });

    if (normalizedPhone !== undefined) {
        const phoneError = validatePhone(normalizedPhone);
        if (phoneError) throw badRequest(phoneError, "phone");

        const exists = await findIdentityConflict(prisma, { phone: normalizedPhone, excludeId: userId });
        if (exists) throw conflict("Bu telefon numarasıyla zaten hesap açılmış.", "phone");
    }

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
            ...(phone !== undefined ? { phone: normalizedPhone } : {}),
            ...(phone !== undefined && normalizedPhone !== currentUser?.phone ? { phoneVerifiedAt: null } : {}),
            ...(email !== undefined ? { email: normalizedEmail } : {}),
            about,
        }
    });

    res.json(updated);
};

export const updateSubscription = async (req, res) => {
    const userId = req.user.userId;
    const plan = String(req.body?.plan || "").trim().toUpperCase();

    if (!PLAN_DEFINITIONS[plan]) {
        throw badRequest("Geçerli bir paket seçin.", "plan");
    }

    const selfServiceEnabled = process.env.ALLOW_SELF_SUBSCRIPTION_CHANGE === "true";
    if (plan !== "FREE" && !selfServiceEnabled) {
        throw forbidden("Premium paket aktivasyonu için ödeme işlemi tamamlanmalı.");
    }

    await prisma.user.update({
        where: { id: userId },
        data: {
            subscriptionPlan: plan,
            subscriptionStatus: "ACTIVE",
        },
    });

    res.json(await getSubscriptionSummary(prisma, userId));
};
