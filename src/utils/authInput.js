function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeOptionalEmail(value) {
    if (value === undefined) return undefined;
    const email = normalizeEmail(value);
    return email || null;
}

function validateUsername(username) {
    if (!username) return "Kullanıcı adı gerekli.";
    if (username.length < 3) return "Kullanıcı adı en az 3 karakter olmalı.";
    if (username.length > 32) return "Kullanıcı adı en fazla 32 karakter olabilir.";
    if (!/^[a-z0-9._-]+$/.test(username)) {
        return "Kullanıcı adı sadece küçük harf, rakam, nokta, alt çizgi ve tire içerebilir.";
    }
    return null;
}

function validateEmail(email) {
    if (!email) return "E-posta adresi gerekli.";
    if (email.length > 254) return "E-posta adresi çok uzun.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Geçerli bir e-posta adresi girin.";
    return null;
}

function validatePassword(password) {
    if (!password) return "Şifre gerekli.";
    if (String(password).length < 8) return "Şifre en az 8 karakter olmalı.";
    return null;
}

async function findUserByUsernameOrEmail(prisma, identifier) {
    const value = String(identifier || "").trim();
    if (!value) return null;

    return prisma.user.findFirst({
        where: {
            OR: [
                { username: { equals: value.toLowerCase(), mode: "insensitive" } },
                { email: { equals: value.toLowerCase(), mode: "insensitive" } },
            ],
        },
    });
}

async function findIdentityConflict(prisma, { username, email, excludeId }) {
    const or = [];
    if (username) or.push({ username: { equals: username, mode: "insensitive" } });
    if (email) or.push({ email: { equals: email, mode: "insensitive" } });
    if (!or.length) return null;

    return prisma.user.findFirst({
        where: {
            OR: or,
            ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true, username: true, email: true },
    });
}

function publicUserSelect() {
    return { id: true, username: true, email: true, role: true, fullName: true, isActive: true };
}

module.exports = {
    normalizeUsername,
    normalizeEmail,
    normalizeOptionalEmail,
    validateUsername,
    validateEmail,
    validatePassword,
    findUserByUsernameOrEmail,
    findIdentityConflict,
    publicUserSelect,
};
