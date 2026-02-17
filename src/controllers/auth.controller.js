const prisma = require("../prisma");
const bcrypt = require("bcryptjs");
const { cookieName, signToken } = require("../auth/jwt");

function setAuthCookie(res, token) {
    res.cookie(cookieName(), token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7 * 1000
    });
}

exports.register = async (req, res) => {
    if (req.user?.role !== "ADMIN") {
        return res.status(403).json({ error: "Only ADMIN can create users" });
    }

    const { username, password, fullName, phone, email, role } = req.body || {};

    if (!username || !password) return res.status(400).json({ error: "username & password required" });
    if (String(password).length < 8) return res.status(400).json({ error: "password min 8" });

    const exists = await prisma.user.findUnique({ where: { username } }).catch(() => null);
    if (exists) return res.status(409).json({ error: "username already exists" });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
        data: {
            username,
            passwordHash,
            role: "AGENT",
            fullName: fullName || username,
            phone: phone || null,
            email: email || null,
            about: ""
        },
        select: { id: true, username: true, role: true, fullName: true }
    });

    return res.json({ ok: true, user });
};

exports.login = async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username & password required" });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Unauthorized" });

    await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
    });

    const token = signToken({ userId: user.id, username: user.username, role: user.role });

    setAuthCookie(res, token);
    return res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, fullName: user.fullName } });
};

exports.logout = async (req, res) => {
    res.clearCookie(cookieName(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
    });
    return res.json({ ok: true });
};

exports.me = async (req, res) => {
    // authRequired middleware req.user set eder
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, role: true, fullName: true, phone: true, email: true, about: true }
    });
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    return res.json(user);
};
