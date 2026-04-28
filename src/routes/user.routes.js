import { Router } from "express";
import * as c from "../controllers/user.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.get("/me", authRequired, c.getMe);
router.put("/me", authRequired, c.updateMe);
router.put("/me/password", authRequired, c.updatePassword);
router.put("/me/subscription", authRequired, c.updateSubscription);

export default router;
