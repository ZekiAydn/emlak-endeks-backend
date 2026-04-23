class AppError extends Error {
    constructor(status, message, code = "APP_ERROR", field = null) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.field = field;
        this.expose = true;
    }
}

function appError(status, message, code, field) {
    return new AppError(status, message, code, field);
}

function badRequest(message, field, code = "BAD_REQUEST") {
    return appError(400, message, code, field);
}

function unauthorized(message = "Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.") {
    return appError(401, message, "UNAUTHORIZED");
}

function forbidden(message = "Bu işlem için yetkiniz yok.") {
    return appError(403, message, "FORBIDDEN");
}

function notFound(message = "Kayıt bulunamadı.") {
    return appError(404, message, "NOT_FOUND");
}

function conflict(message, field) {
    return appError(409, message, "CONFLICT", field);
}

function serviceError(message) {
    return appError(502, message, "UPSTREAM_SERVICE_ERROR");
}

function mapPrismaError(err) {
    if (!err?.code) return null;

    if (err.code === "P2002") {
        const target = Array.isArray(err.meta?.target) ? err.meta.target.join(",") : String(err.meta?.target || "");
        if (target.includes("email")) return conflict("Bu e-posta adresi zaten kullanılıyor.", "email");
        if (target.includes("username")) return conflict("Bu kullanıcı adı zaten kullanılıyor.", "username");
        return conflict("Bu kayıt zaten mevcut.");
    }

    if (err.code === "P2025") return notFound("Kayıt bulunamadı.");
    return null;
}

function mapKnownError(err) {
    if (err instanceof AppError) return err;

    const prismaMapped = mapPrismaError(err);
    if (prismaMapped) return prismaMapped;

    if (err?.code === "LIMIT_FILE_SIZE") {
        return badRequest("Dosya en fazla 10 MB olabilir.", "file", "FILE_TOO_LARGE");
    }

    const msg = String(err?.message || "");
    if (msg.includes("JWT_SECRET")) return appError(500, "Oturum servisi yapılandırması eksik.", "JWT_CONFIG_MISSING");
    if (msg.includes("GEMINI_API_KEY")) return badRequest("Gemini API anahtarı tanımlı değil.", null, "GEMINI_KEY_MISSING");
    if (msg.includes("GEMINI_MODEL")) return badRequest("Gemini model adı tanımlı değil.", null, "GEMINI_MODEL_MISSING");
    if (msg.toLowerCase().includes("gemini")) return serviceError("Gemini analiz servisi şu anda yanıt veremiyor.");

    return appError(500, "İşlem sırasında beklenmeyen bir sorun oluştu. Lütfen tekrar deneyin.", "INTERNAL_ERROR");
}

function errorHandler(err, req, res, _next) {
    const mapped = mapKnownError(err);

    if (mapped.status >= 500) {
        console.error("[API_ERROR]", req.method, req.originalUrl, err);
    }

    return res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
        ...(mapped.field ? { field: mapped.field } : {}),
    });
}

module.exports = {
    AppError,
    appError,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    serviceError,
    errorHandler,
};
