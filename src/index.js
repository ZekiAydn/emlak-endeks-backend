import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";

import routes from "./routes/index.js";
import { errorHandler } from "./utils/errors.js";
import { buildLaunchOptions, isServerlessRuntime } from "./services/headlessBrowser.js";

const app = express();

app.set("trust proxy", 1);
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
        serverless: isServerlessRuntime(),
        corsOriginsCount: allowed.length,
        browser,
    });
});

app.use(routes);
app.use(errorHandler);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const port = Number(process.env.PORT || 4000);
    app.listen(port, () => console.log(`API running on :${port}`));
}

export default app;
