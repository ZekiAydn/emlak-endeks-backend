import { Router } from "express";
import * as c from "../controllers/debug.controller.js";

const router = Router();

router.use("/debug", c.debugEnabled);
router.get("/debug/comparables/resolve", c.resolveComparables);
router.get("/debug/comparables/fetch", c.fetchComparables);
router.get("/debug/comparables/run", c.runComparables);

export default router;
