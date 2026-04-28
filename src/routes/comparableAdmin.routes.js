import { Router } from "express";
import authRequired from "../middleware/authRequired.js";
import requireRole from "../middleware/requireRole.js";
import * as controller from "../controllers/comparableIngestion.controller.js";

const router = Router();

router.use(authRequired, requireRole("ADMIN"));

router.post("/comparable-ingestion/discover", controller.discover);
router.post("/comparable-ingestion/fetch-pending", controller.fetchPending);
router.post("/comparable-ingestion/run", controller.run);
router.get("/comparable-listings", controller.listComparableListings);
router.get("/comparable-search-results", controller.listComparableSearchResults);

export default router;
