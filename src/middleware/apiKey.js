module.exports = function apiKey(req, res, next) {
    if (req.path === "/health") return next();

    const apiKey = req.header("x-api-key");
    if (!process.env.API_KEY || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};
