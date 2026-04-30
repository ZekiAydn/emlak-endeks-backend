import { Router } from "express";
import * as c from "../controllers/report.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.post("/reports",authRequired, c.createReport);
router.get("/reports",authRequired, c.listReports);
router.get("/reports/drafts",authRequired, c.listDraftReports);
router.get("/reports/drafts/latest",authRequired, c.getLatestDraftReport);
router.post("/reports/drafts",authRequired, c.createDraftReport);
router.get("/reports/:id",authRequired, c.getReport);
router.put("/reports/:id",authRequired, c.updateReport);
router.put("/reports/:id/draft",authRequired, c.updateDraftReport);
router.post("/reports/:id/complete",authRequired, c.completeReport);
router.delete("/reports/:id",authRequired, c.deleteReport);
router.post("/reports/:id/parcel-data",authRequired, c.autofillParcelData);
router.post("/reports/:id/comparables",authRequired, c.autofillComparableData);
router.post("/reports/:id/external-data",authRequired, c.autofillExternalData);
router.post("/reports/:id/location-insights",authRequired, c.autofillLocationInsights);
router.post("/reports/:id/ai/price-index",authRequired, c.aiPriceIndex);

export default router;
