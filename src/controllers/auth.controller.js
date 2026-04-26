import prisma from "../prisma.js";
import bcrypt from "bcryptjs";
import { cookieName, signToken } from "../auth/jwt.js";
import {
    normalizeUsername,
    normalizeOptionalEmail,
    normalizePhone,
    validateUsername,
    validateEmail,
    validatePhone,
    validatePassword,
    findUserByIdentifier,
    findIdentityConflict,
    publicUserSelect,
} from "../utils/authInput.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../utils/errors.js";
import { sendVerificationCode, verifyCode } from "../services/phoneVerification.js";

function authCookieOptions() {
    const isProduction = process.env.NODE_ENV === "production";
    const sameSite = process.env.AUTH_COOKIE_SAME_SITE || (isProduction ? "none" : "lax");
    const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();

    return {
        httpOnly: true,
        sameSite,
        secure: process.env.AUTH_COOKIE_SECURE
            ? process.env.AUTH_COOKIE_SECURE === "true"
            : isProduction,
        path: "/",
        ...(domain ? { domain } : {}),
    };
}

function setAuthCookie(res, token) {
    res.cookie(cookieName(), token, {
        ...authCookieOptions(),
        maxAge: 60 * 60 * 24 * 7 * 1000
    });
}

export const register = async (req, res) => {
    const {
        username: rawUsername,
        email: rawEmail,
        phone: rawPhone,
        password,
        rePassword,
        passwordConfirm,
        confirmPassword,
        adminCode,
        fullName,
    } = req.body || {};

    const expectedAdminCode = process.env.ADMIN_REGISTER_CODE || "123456";
    const isAdminRegistration = Boolean(String(adminCode || "").trim());
    if (isAdminRegistration && String(adminCode || "").trim() !== expectedAdminCode) {
        throw forbidden("Admin kodu hatalı.");
    }

    const phone = normalizePhone(rawPhone);
    const phoneError = validatePhone(phone);
    if (phoneError) throw badRequest(phoneError, "phone");

    const username = normalizeUsername(rawUsername || `u_${phone.replace(/\D/g, "")}`);
    const email = normalizeOptionalEmail(rawEmail);
    const repeatedPassword = rePassword ?? passwordConfirm ?? confirmPassword;
    const displayName = String(fullName || "").trim();

    const usernameError = validateUsername(username);
    if (usernameError) throw badRequest(usernameError, "username");

    if (email) {
        const emailError = validateEmail(email);
        if (emailError) throw badRequest(emailError, "email");
    }

    if (!displayName) throw badRequest("Ad soyad / ünvan gerekli.", "fullName");

    const passwordError = validatePassword(password);
    if (passwordError) throw badRequest(passwordError, "password");

    if (String(password) !== String(repeatedPassword || "")) {
        throw badRequest("Şifreler eşleşmiyor.", "rePassword");
    }

    const exists = await findIdentityConflict(prisma, { username, email, phone });
    if (exists?.phone === phone) throw conflict("Bu telefon numarasıyla zaten hesap açılmış.", "phone");
    if (email && exists?.email === email) throw conflict("Bu e-posta adresi zaten kullanılıyor.", "email");
    if (exists?.username === username) throw conflict("Bu kullanıcı adı zaten kullanılıyor.", "username");
    if (exists) throw conflict("Bu kullanıcı zaten mevcut.");

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
        data: {
            username,
            email,
            phone,
            passwordHash,
            role: isAdminRegistration ? "ADMIN" : "AGENT",
            subscriptionPlan: "FREE",
            subscriptionStatus: "ACTIVE",
            fullName: displayName,
            about: ""
        },
        select: publicUserSelect()
    });

    const token = signToken({ userId: user.id, username: user.username, email: user.email, role: user.role });
    setAuthCookie(res, token);

    return res.json({ ok: true, user, token });
};

export const login = async (req, res) => {
    const { identifier, username, email, phone, password } = req.body || {};
    const login = identifier || phone || email || username;
    if (!login || !password) throw badRequest("Telefon/e-posta ve şifre gerekli.");

    const user = await findUserByIdentifier(prisma, login);
    if (!user || !user.isActive) throw unauthorized("Telefon/e-posta veya şifre hatalı.");

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) throw unauthorized("Telefon/e-posta veya şifre hatalı.");

    await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
    });

    const token = signToken({ userId: user.id, username: user.username, email: user.email, role: user.role });

    setAuthCookie(res, token);
    return res.json({
        ok: true,
        token,
        user: {
            id: user.id,
            username: user.username,
            phone: user.phone,
            email: user.email,
            role: user.role,
            fullName: user.fullName,
            isActive: user.isActive,
            subscriptionPlan: user.subscriptionPlan,
            subscriptionStatus: user.subscriptionStatus,
            phoneVerifiedAt: user.phoneVerifiedAt,
        },
    });
};

export const logout = async (req, res) => {
    res.clearCookie(cookieName(), authCookieOptions());
    return res.json({ ok: true });
};

export const sendPhoneVerification = async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) throw unauthorized();

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, phone: true, phoneVerifiedAt: true },
    });

    if (!user) throw notFound("Kullanıcı bulunamadı.");
    if (!user.phone) throw badRequest("Telefon numarası bulunamadı.", "phone");
    if (user.phoneVerifiedAt) return res.json({ ok: true, alreadyVerified: true });

    const result = await sendVerificationCode({ userId: user.id, phone: user.phone });
    return res.json({ ok: true, status: result.status });
};

export const verifyPhone = async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) throw unauthorized();

    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (code.length < 4 || code.length > 10) {
        throw badRequest("Geçerli doğrulama kodunu girin.", "code");
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, phone: true, phoneVerifiedAt: true },
    });

    if (!user) throw notFound("Kullanıcı bulunamadı.");
    if (!user.phone) throw badRequest("Telefon numarası bulunamadı.", "phone");
    if (user.phoneVerifiedAt) return res.json({ ok: true, alreadyVerified: true });

    const result = await verifyCode({ phone: user.phone, code });
    if (!result.approved) {
        throw badRequest("Doğrulama kodu hatalı veya süresi dolmuş.", "code");
    }

    const updated = await prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
        select: publicUserSelect(),
    });

    return res.json({ ok: true, user: updated });
};
