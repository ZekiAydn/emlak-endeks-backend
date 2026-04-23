const router = require("express").Router();
const prisma = require("../prisma");
const bcrypt = require("bcryptjs");
const authRequired = require("../middleware/authRequired");
const requireRole = require("../middleware/requireRole");
const { badRequest, conflict, notFound } = require("../utils/errors");
const {
    normalizeUsername,
    normalizeOptionalEmail,
    validateUsername,
    validateEmail,
    validatePassword,
    findIdentityConflict,
    publicUserSelect,
} = require("../utils/authInput");

router.use(authRequired, requireRole("ADMIN"));

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
            fullName: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
        },
    });

    res.json(items);
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
    const userRole = role === "ADMIN" ? "ADMIN" : "AGENT";

    const usernameError = validateUsername(username);
    if (usernameError) throw badRequest(usernameError, "username");

    if (email) {
        const emailError = validateEmail(email);
        if (emailError) throw badRequest(emailError, "email");
    }

    const passwordError = validatePassword(password);
    if (passwordError) throw badRequest(passwordError, "password");

    const exists = await findIdentityConflict(prisma, { username, email });
    if (exists?.username === username) throw conflict("Bu kullanıcı adı zaten kullanılıyor.", "username");
    if (email && exists?.email === email) throw conflict("Bu e-posta adresi zaten kullanılıyor.", "email");
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
            phone: phone || null,
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
            email: true,
            about: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    if (!user) throw notFound("Kullanıcı bulunamadı.");
    res.json(user);
});

// update profile/role/status
router.put("/users/:id", async (req, res) => {
    const id = req.params.id;
    const { fullName, phone, email, about, role, isActive } = req.body || {};
    const normalizedEmail = normalizeOptionalEmail(email);

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
            ...(phone !== undefined ? { phone } : {}),
            ...(email !== undefined ? { email: normalizedEmail } : {}),
            ...(about !== undefined ? { about } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        },
        select: { id: true, username: true, fullName: true, role: true, isActive: true },
    });

    res.json(u);
});

// reset password
router.put("/users/:id/password", async (req, res) => {
    const id = req.params.id;
    const { password } = req.body || {};
    if (!password || String(password).length < 8) throw badRequest("Şifre en az 8 karakter olmalı.", "password");

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

module.exports = router;
