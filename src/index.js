require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const apiKey = require("./middleware/apiKey");
const routes = require("./routes");

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
    credentials: true
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(apiKey);
app.use(routes);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`API running on :${port}`));
