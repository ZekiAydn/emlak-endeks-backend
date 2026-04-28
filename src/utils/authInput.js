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

function normalizePhone(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("90") && digits.length === 12) return `+${digits}`;
    if (digits.startsWith("0") && digits.length === 11) return `+90${digits.slice(1)}`;
    if (digits.length === 10) return `+90${digits}`;
    return digits ? `+${digits}` : "";
}

function normalizeOptionalPhone(value) {
    if (value === undefined) return undefined;
    const phone = normalizePhone(value);
    return phone || null;
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

function validatePhone(phone) {
    if (!phone) return "Telefon numarası gerekli.";
    if (!/^\+90\d{10}$/.test(phone)) return "Telefon numarasını 10 haneli Türkiye numarası olarak girin.";
    return null;
}

function validatePassword(password) {
    if (!password) return "Şifre gerekli.";
    if (String(password).length < 8) return "Şifre en az 8 karakter olmalı.";
    return null;
}

async function findUserByIdentifier(prisma, identifier) {
    const value = String(identifier || "").trim();
    if (!value) return null;

    const phone = normalizePhone(value);
    const phoneLooksValid = !validatePhone(phone);

    return prisma.user.findFirst({
        where: {
            OR: [
                { username: { equals: value.toLowerCase(), mode: "insensitive" } },
                { email: { equals: value.toLowerCase(), mode: "insensitive" } },
                ...(phoneLooksValid ? [{ phone }] : []),
            ],
        },
    });
}

async function findIdentityConflict(prisma, { username, email, phone, excludeId }) {
    const or = [];
    if (username) or.push({ username: { equals: username, mode: "insensitive" } });
    if (email) or.push({ email: { equals: email, mode: "insensitive" } });
    if (phone) or.push({ phone });
    if (!or.length) return null;

    return prisma.user.findFirst({
        where: {
            OR: or,
            ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true, username: true, email: true, phone: true },
    });
}

function publicUserSelect() {
    return {
        id: true,
        username: true,
        phone: true,
        email: true,
        role: true,
        fullName: true,
        spkLicenseNo: true,
        isActive: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        phoneVerifiedAt: true,
    };
}

export {
    normalizeUsername,
    normalizeEmail,
    normalizeOptionalEmail,
    normalizePhone,
    normalizeOptionalPhone,
    validateUsername,
    validateEmail,
    validatePhone,
    validatePassword,
    findUserByIdentifier,
    findUserByIdentifier as findUserByUsernameOrEmail,
    findIdentityConflict,
    publicUserSelect,
};
