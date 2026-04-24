import { Router } from "express";
import * as c from "../controllers/auth.controller.js";

const router = Router();

router.post("/auth/register", c.register);
router.post("/auth/login", c.login);
router.post("/auth/logout", c.logout);

export default router;
