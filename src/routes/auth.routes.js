import { Router } from "express";
import * as c from "../controllers/auth.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.post("/auth/register", c.register);
router.post("/auth/login", c.login);
router.post("/auth/logout", c.logout);
router.post("/auth/phone/send-code", authRequired, c.sendPhoneVerification);
router.post("/auth/phone/verify-code", authRequired, c.verifyPhone);

export default router;
