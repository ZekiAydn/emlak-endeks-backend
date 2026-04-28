import { Router } from "express";
import { cronComparableIngestion } from "../controllers/comparableIngestion.controller.js";

const router = Router();

router.post("/api/internal/cron/comparable-ingestion", cronComparableIngestion);

export default router;
