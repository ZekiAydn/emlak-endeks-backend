const { cookieName, verifyToken } = require("../auth/jwt");
const { unauthorized } = require("../utils/errors");

module.exports = function authRequired(req, res, next) {
    try {
        const name = cookieName();
        const fromCookie = req.cookies?.[name];

        const auth = req.headers.authorization || "";
        const fromBearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;

        const token = fromCookie || fromBearer;
        if (!token) throw unauthorized();

        const payload = verifyToken(token);
        if (!payload?.userId) throw unauthorized();

        req.user = payload;
        return next();
    } catch (e) {
        return next(unauthorized());
    }
};
