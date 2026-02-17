const router = require("express").Router();
const prisma = require("../prisma");
const bcrypt = require("bcryptjs");
const authRequired = require("../middleware/authRequired");
const requireRole = require("../middleware/requireRole");

router.use(authRequired, requireRole("ADMIN"));

// list
router.get("/users", async (req, res) => {
    const take = Math.min(Number(req.query.take || 50), 100);
    const skip = Number(req.query.skip || 0);
    const q = String(req.query.q || "").trim();

    const where = q
        ? { OR: [{ username: { contains: q, mode: "insensitive" } }, { fullName: { contains: q, mode: "insensitive" } }] }
        : {};

    const items = await prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: { id: true, username: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });

    res.json(items);
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

    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(user);
});

// update profile/role/status
router.put("/users/:id", async (req, res) => {
    const id = req.params.id;
    const { fullName, phone, email, about, role, isActive } = req.body || {};

    const u = await prisma.user.update({
        where: { id },
        data: {
            ...(fullName !== undefined ? { fullName } : {}),
            ...(phone !== undefined ? { phone } : {}),
            ...(email !== undefined ? { email } : {}),
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
    if (!password || String(password).length < 8) return res.status(400).json({ error: "password min 8" });

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
