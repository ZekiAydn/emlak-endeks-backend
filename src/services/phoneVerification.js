import twilio from "twilio";
import { badRequest, serviceError } from "../utils/errors.js";

const sendState = new Map();

function twilioConfig() {
    return {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
    };
}

function isPhoneVerificationConfigured() {
    const cfg = twilioConfig();
    return Boolean(cfg.accountSid && cfg.authToken && cfg.verifyServiceSid);
}

function client() {
    const cfg = twilioConfig();
    if (!isPhoneVerificationConfigured()) {
        throw serviceError("SMS doğrulama servisi yapılandırılmadı. Admin manuel doğrulama kullanabilir.");
    }

    return twilio(cfg.accountSid, cfg.authToken);
}

function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function assertSendAllowed(userId) {
    const now = Date.now();
    const day = todayKey();
    const key = `${userId}:${day}`;
    const current = sendState.get(key) || { count: 0, lastSentAt: 0 };
    const cooldownMs = Number(process.env.PHONE_VERIFICATION_COOLDOWN_SECONDS || 60) * 1000;
    const dailyLimit = Number(process.env.PHONE_VERIFICATION_DAILY_LIMIT || 5);

    if (now - current.lastSentAt < cooldownMs) {
        const waitSeconds = Math.ceil((cooldownMs - (now - current.lastSentAt)) / 1000);
        throw badRequest(`Yeni kod göndermek için ${waitSeconds} saniye bekleyin.`);
    }

    if (current.count >= dailyLimit) {
        throw badRequest("Bugün için telefon doğrulama kodu gönderim hakkınız doldu.");
    }
}

function markSent(userId) {
    const day = todayKey();
    const key = `${userId}:${day}`;
    const current = sendState.get(key) || { count: 0, lastSentAt: 0 };
    sendState.set(key, {
        count: current.count + 1,
        lastSentAt: Date.now(),
    });
}

function mapTwilioError(err) {
    const code = String(err?.code || "");
    const status = Number(err?.status || err?.statusCode || 0);
    const message = String(err?.message || "");

    if (code === "60203") return badRequest("Çok fazla doğrulama denemesi yapıldı. Bir süre sonra tekrar deneyin.");
    if (code === "60202") return badRequest("Çok fazla hatalı kod denendi. Yeni kod isteyin.");
    if (code === "60200" || status === 400) return badRequest("Telefon doğrulama isteği kabul edilmedi. Numara formatını kontrol edin.");
    if (code === "21608" || message.toLowerCase().includes("trial")) {
        return badRequest("Twilio trial hesabı bu numaraya SMS atamıyor. Numarayı Twilio'da verified caller ID yapın veya hesabı upgrade edin.");
    }

    return serviceError("SMS doğrulama servisi şu anda yanıt veremiyor.");
}

async function sendVerificationCode({ userId, phone }) {
    assertSendAllowed(userId);

    try {
        const cfg = twilioConfig();
        const result = await client()
            .verify.v2
            .services(cfg.verifyServiceSid)
            .verifications
            .create({ to: phone, channel: "sms" });

        markSent(userId);

        return {
            status: result.status,
            to: result.to,
        };
    } catch (err) {
        throw mapTwilioError(err);
    }
}

async function verifyCode({ phone, code }) {
    try {
        const cfg = twilioConfig();
        const result = await client()
            .verify.v2
            .services(cfg.verifyServiceSid)
            .verificationChecks
            .create({ to: phone, code });

        return {
            approved: result.status === "approved",
            status: result.status,
            to: result.to,
        };
    } catch (err) {
        throw mapTwilioError(err);
    }
}

export {
    isPhoneVerificationConfigured,
    sendVerificationCode,
    verifyCode,
};
