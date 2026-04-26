import { Router } from "express";
import * as c from "../controllers/location.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.get("/locations/cities", authRequired, c.listCities);
router.get("/locations/districts", authRequired, c.listDistricts);
router.get("/locations/neighborhoods", authRequired, c.listNeighborhoods);

export default router;
