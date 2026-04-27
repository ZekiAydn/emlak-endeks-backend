import { Router } from "express";
import prisma from "../prisma.js";
import bcrypt from "bcryptjs";
import authRequired from "../middleware/authRequired.js";
import requireRole from "../middleware/requireRole.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { PLAN_DEFINITIONS } from "../services/subscriptionPlans.js";
import {
    normalizeUsername,
    normalizeOptionalEmail,
    normalizeOptionalPhone,
    validateUsername,
    validateEmail,
    validatePhone,
    validatePassword,
    findIdentityConflict,
    publicUserSelect,
} from "../utils/authInput.js";

const router = Router();

router.use(authRequired, requireRole("ADMIN"));

function monthBounds(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
        start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
}

async function reportStatsByUserIds(userIds = []) {
    if (!userIds.length) return new Map();

    const { start, end } = monthBounds();
    const [totalRows, activeRows, deletedRows, thisMonthRows] = await Promise.all([
        prisma.report.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds } },
            _count: { _all: true },
        }),
        prisma.report.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds }, isDeleted: false },
            _count: { _all: true },
        }),
        prisma.report.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds }, isDeleted: true },
            _count: { _all: true },
        }),
        prisma.report.groupBy({
            by: ["userId"],
            where: {
                userId: { in: userIds },
                createdAt: { gte: start, lt: end },
            },
            _count: { _all: true },
        }),
    ]);

    const stats = new Map(userIds.map((id) => [id, { total: 0, active: 0, deleted: 0, thisMonth: 0 }]));
    const applyRows = (rows, key) => {
        rows.forEach((row) => {
            const current = stats.get(row.userId) || { total: 0, active: 0, deleted: 0, thisMonth: 0 };
            current[key] = row._count?._all || 0;
            stats.set(row.userId, current);
        });
    };

    applyRows(totalRows, "total");
    applyRows(activeRows, "active");
    applyRows(deletedRows, "deleted");
    applyRows(thisMonthRows, "thisMonth");

    return stats;
}

// list
router.get("/users", async (req, res) => {
    const take = Math.min(Number(req.query.take || 50), 100);
    const skip = Number(req.query.skip || 0);
    const q = String(req.query.q || "").trim();

    const where = q
        ? {
            OR: [
                { username: { contains: q, mode: "insensitive" } },
                { fullName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
            ],
        }
        : {};

    const items = await prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            phoneVerifiedAt: true,
            fullName: true,
            role: true,
            isActive: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            lastLoginAt: true,
            createdAt: true,
        },
    });

    const stats = await reportStatsByUserIds(items.map((item) => item.id));
    res.json(items.map((item) => ({ ...item, reportStats: stats.get(item.id) })));
});

router.post("/users", async (req, res) => {
    const {
        username: rawUsername,
        email: rawEmail,
        password,
        fullName,
        phone,
        about,
        role,
        isActive,
    } = req.body || {};

    const username = normalizeUsername(rawUsername);
    const email = normalizeOptionalEmail(rawEmail);
    const normalizedPhone = normalizeOptionalPhone(phone);
    const userRole = role === "ADMIN" ? "ADMIN" : "AGENT";

    const usernameError = validateUsername(username);
    if (usernameError) throw badRequest(usernameError, "username");

    if (email) {
        const emailError = validateEmail(email);
        if (emailError) throw badRequest(emailError, "email");
    }

    if (normalizedPhone) {
        const phoneError = validatePhone(normalizedPhone);
        if (phoneError) throw badRequest(phoneError, "phone");
    }

    const passwordError = validatePassword(password);
    if (passwordError) throw badRequest(passwordError, "password");

    const exists = await findIdentityConflict(prisma, { username, email, phone: normalizedPhone });
    if (normalizedPhone && exists?.phone === normalizedPhone) throw conflict("Bu telefon numarasıyla zaten hesap açılmış.", "phone");
    if (email && exists?.email === email) throw conflict("Bu e-posta adresi zaten kullanılıyor.", "email");
    if (exists?.username === username) throw conflict("Bu kullanıcı adı zaten kullanılıyor.", "username");
    if (exists) throw conflict("Bu kullanıcı zaten mevcut.");

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
        data: {
            username,
            email,
            passwordHash,
            role: userRole,
            isActive: isActive === undefined ? true : Boolean(isActive),
            fullName: String(fullName || username).trim(),
            phone: normalizedPhone,
            about: about || "",
        },
        select: publicUserSelect(),
    });

    res.status(201).json(user);
});

router.get("/users/:id", async (req, res) => {
    const id = req.params.id;

    const user = await prisma.user.findUnique({
        where: { id },
        select: {
            id: true,
            username: true,
            fullName: true,
            phone: true,
            phoneVerifiedAt: true,
            email: true,
            about: true,
            role: true,
            isActive: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    if (!user) throw notFound("Kullanıcı bulunamadı.");
    const stats = await reportStatsByUserIds([id]);
    res.json({ ...user, reportStats: stats.get(id) });
});

// update profile/role/status
router.put("/users/:id", async (req, res) => {
    const id = req.params.id;
    const { fullName, phone, email, about, role, isActive, subscriptionPlan, subscriptionStatus, phoneVerified } = req.body || {};
    const normalizedEmail = normalizeOptionalEmail(email);
    const normalizedPhone = normalizeOptionalPhone(phone);
    const normalizedPlan = subscriptionPlan === undefined ? undefined : String(subscriptionPlan || "").trim().toUpperCase();
    const normalizedSubscriptionStatus = subscriptionStatus === undefined ? undefined : String(subscriptionStatus || "").trim().toUpperCase();

    if (normalizedPlan !== undefined && !PLAN_DEFINITIONS[normalizedPlan]) {
        throw badRequest("Geçerli bir paket seçin.", "subscriptionPlan");
    }

    if (normalizedSubscriptionStatus !== undefined && !["ACTIVE", "PAUSED", "CANCELED"].includes(normalizedSubscriptionStatus)) {
        throw badRequest("Geçerli bir abonelik durumu seçin.", "subscriptionStatus");
    }

    if (normalizedPhone) {
        const phoneError = validatePhone(normalizedPhone);
        if (phoneError) throw badRequest(phoneError, "phone");

        const exists = await findIdentityConflict(prisma, { phone: normalizedPhone, excludeId: id });
        if (exists) throw conflict("Bu telefon numarasıyla zaten hesap açılmış.", "phone");
    }

    if (normalizedEmail) {
        const emailError = validateEmail(normalizedEmail);
        if (emailError) throw badRequest(emailError, "email");

        const exists = await findIdentityConflict(prisma, { email: normalizedEmail, excludeId: id });
        if (exists) throw conflict("Bu e-posta adresi zaten kullanılıyor.", "email");
    }

    const u = await prisma.user.update({
        where: { id },
        data: {
            ...(fullName !== undefined ? { fullName } : {}),
            ...(phone !== undefined ? { phone: normalizedPhone } : {}),
            ...(phone !== undefined && phoneVerified === undefined ? { phoneVerifiedAt: null } : {}),
            ...(email !== undefined ? { email: normalizedEmail } : {}),
            ...(about !== undefined ? { about } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
            ...(normalizedPlan !== undefined ? { subscriptionPlan: normalizedPlan } : {}),
            ...(normalizedSubscriptionStatus !== undefined ? { subscriptionStatus: normalizedSubscriptionStatus } : {}),
            ...(phoneVerified !== undefined ? { phoneVerifiedAt: phoneVerified ? new Date() : null } : {}),
        },
        select: {
            id: true,
            username: true,
            fullName: true,
            phone: true,
            phoneVerifiedAt: true,
            role: true,
            isActive: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
        },
    });

    res.json(u);
});

// reset password
router.put("/users/:id/password", async (req, res) => {
    const id = req.params.id;
    const { password } = req.body || {};
    if (!password || String(password).length < 6) throw badRequest("Şifre en az 6 karakter olmalı.", "password");

    const passwordHash = await bcrypt.hash(String(password), 10);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    res.json({ ok: true });
});

// "delete" = deactivate
router.delete("/users/:id", async (req, res) => {
    const id = req.params.id;
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    res.json({ ok: true });
});

export default router;
