import { Router } from "express";
import * as c from "../controllers/report.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.post("/reports",authRequired, c.createReport);
router.get("/reports",authRequired, c.listReports);
router.get("/reports/:id",authRequired, c.getReport);
router.put("/reports/:id",authRequired, c.updateReport);
router.delete("/reports/:id",authRequired, c.deleteReport);
router.post("/reports/:id/external-data",authRequired, c.autofillExternalData);
router.post("/reports/:id/ai/price-index",authRequired, c.aiPriceIndex);

export default router;
