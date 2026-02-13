const router = require("express").Router();
const c = require("../controllers/report.controller");


router.post("/reports", c.createReport);
router.get("/reports", c.listReports);
router.get("/reports/:id", c.getReport);
router.put("/reports/:id", c.updateReport);
router.delete("/reports/:id", c.deleteReport);
router.post("/reports/:id/ai/autofill", c.aiAutofill);

module.exports = router;
