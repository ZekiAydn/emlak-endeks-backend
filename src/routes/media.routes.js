import { Router } from "express";
import multer from "multer";
import * as c from "../controllers/media.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post("/media/upload",authRequired, upload.single("file"), c.upload);
router.get("/media/:id",authRequired, c.getById);
router.delete("/media/:id",authRequired, c.deleteById);

export default router;
