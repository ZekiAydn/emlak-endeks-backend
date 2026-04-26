import { Router } from "express";
import * as c from "../controllers/comparableMedia.controller.js";

const router = Router();

router.get("/comparables/mock-image", c.mockComparableImage);
router.get("/comparables/street-view", c.streetViewComparableImage);

export default router;
