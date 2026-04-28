import { Router } from "express";
import multer from "multer";
import authRequired from "../middleware/authRequired.js";
import * as comparableController from "../controllers/comparableController.js";

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024,
    },
});

router.use(authRequired);

router.post("/search", comparableController.searchComparables);
router.get("/report/:reportId", comparableController.getReportComparables);
router.post("/report/:reportId/select-best", comparableController.selectBestForReport);
router.post("/report/:reportId/snapshot", comparableController.snapshotReportComparables);
router.post("/import-csv", upload.single("file"), comparableController.importCsv);
router.patch("/:id", comparableController.updateComparable);
router.post("/:id/verify", comparableController.verifyComparable);
router.post("/:id/select", comparableController.selectComparable);
router.post("/:id/unselect", comparableController.unselectComparable);

export default router;

