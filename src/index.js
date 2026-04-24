require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const routes = require("./routes");
const { errorHandler } = require("./utils/errors");

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

const allowed = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);

        if (!allowed.length) return cb(null, origin);

        if (allowed.includes(origin)) return cb(null, true);
        return cb(new Error("Not allowed by CORS"));
    },
    credentials: true
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/health/runtime", async (_req, res) => {
    const { buildLaunchOptions, isServerlessRuntime } = require("./services/headlessBrowser");

    let browser = null;
    try {
        const options = await buildLaunchOptions();
        browser = {
            hasExecutablePath: Boolean(options.executablePath),
            executableName: options.executablePath ? options.executablePath.split("/").pop() : null,
            argsCount: Array.isArray(options.args) ? options.args.length : 0,
        };
    } catch (error) {
        browser = {
            error: String(error.message || error),
        };
    }

    res.json({
        ok: true,
        node: process.version,
        vercel: Boolean(process.env.VERCEL),
        serverless: isServerlessRuntime(),
        corsOriginsCount: allowed.length,
        browser,
    });
});

app.use(routes);
app.use(errorHandler);

if (require.main === module) {
    const port = Number(process.env.PORT || 4000);
    app.listen(port, () => console.log(`API running on :${port}`));
}

module.exports = app;
