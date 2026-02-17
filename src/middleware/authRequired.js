// middleware/authRequired.js
const { cookieName, verifyToken } = require("../auth/jwt"); // verifyToken senden nasıl ise onu kullan

module.exports = function authRequired(req, res, next) {
    try {
        const name = cookieName();
        console.log("cookieName:", cookieName());
        console.log("has token cookie:", !!req.cookies?.[cookieName()], "cookie keys:", Object.keys(req.cookies || {}));
        // ✅ doğru cookie'yi name ile al
        const fromCookie = req.cookies?.[name];

        // ✅ Bearer fallback (istersen)
        const auth = req.headers.authorization || "";
        const fromBearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;

        const token = fromCookie || fromBearer;
        if (!token) return res.status(401).json({ error: "Unauthorized" });

        const payload = verifyToken(token); // { userId, username, role } gibi
        if (!payload?.userId) return res.status(401).json({ error: "Unauthorized" });

        req.user = payload;
        return next();
    } catch (e) {
        return res.status(401).json({ error: "Unauthorized" });
    }
};
