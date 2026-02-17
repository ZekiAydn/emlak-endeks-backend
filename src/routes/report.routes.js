const router = require("express").Router();
const c = require("../controllers/report.controller");

const authRequired = require("../middleware/authRequired");

router.post("/reports",authRequired, c.createReport);
router.get("/reports",authRequired, c.listReports);
router.get("/reports/:id",authRequired, c.getReport);
router.put("/reports/:id",authRequired, c.updateReport);
router.delete("/reports/:id",authRequired, c.deleteReport);
router.post("/reports/:id/ai/price-index",authRequired, c.aiPriceIndex);

module.exports = router;
