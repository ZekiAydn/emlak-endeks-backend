import { cookieName, verifyToken } from "../auth/jwt.js";
import { unauthorized } from "../utils/errors.js";

export default function authRequired(req, res, next) {
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
