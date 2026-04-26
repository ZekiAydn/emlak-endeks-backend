import { Router } from "express";
import * as c from "../controllers/location.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.get("/locations/cities", authRequired, c.listCities);
router.get("/locations/districts", authRequired, c.listDistricts);
router.get("/locations/neighborhoods", authRequired, c.listNeighborhoods);
router.get("/locations/tkgm/cities", authRequired, c.listTkgmCities);
router.get("/locations/tkgm/districts", authRequired, c.listTkgmDistricts);
router.get("/locations/tkgm/neighborhoods", authRequired, c.listTkgmNeighborhoods);

export default router;
