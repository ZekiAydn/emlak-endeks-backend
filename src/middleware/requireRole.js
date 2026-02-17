module.exports = function requireRole(...roles) {
    return (req, res, next) => {
        const r = req.user?.role;
        if (!r || !roles.includes(r)) {
            console.log("[REQUIRE_ROLE BLOCK]", req.method, req.originalUrl, "role=", r, "need=", roles);
            return res.status(403).json({ error: "Forbidden" });
        }
        next();
    };
};
