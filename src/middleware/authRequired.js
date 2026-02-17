const { cookieName, verifyToken } = require("../auth/jwt");

module.exports = function authRequired(req, res, next) {
    try {
        const c = req.cookies?.[cookieName()];
        const h = req.header("authorization") || "";
        const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7) : null;

        const token = c || bearer;
        if (!token) return res.status(401).json({ error: "Unauthorized" });

        const payload = verifyToken(token);
        req.user = payload; // { userId, username, role }
        return next();
    } catch (e) {
        return res.status(401).json({ error: "Unauthorized" });
    }
};
