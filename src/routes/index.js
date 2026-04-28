import { Router } from "express";
import authRoutes from "./auth.routes.js";
import adminRoutes from "./admin.routes.js";
import userRoutes from "./user.routes.js";
import clientRoutes from "./client.routes.js";
import reportRoutes from "./report.routes.js";
import mediaRoutes from "./media.routes.js";
import comparableMediaRoutes from "./comparableMedia.routes.js";
import locationRoutes from "./location.routes.js";

const router = Router();

router.use(authRoutes);
router.use(comparableMediaRoutes);
router.use("/admin", adminRoutes);
router.use(userRoutes);
router.use(locationRoutes);
router.use(clientRoutes);
router.use(reportRoutes);
router.use(mediaRoutes);

export default router;
