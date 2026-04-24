const router = require("express").Router();

router.use(require("./auth.routes"));
router.use(require("./debug.routes"));
router.use("/admin", require("./admin.routes")); // ✅ sadece /admin/* için
router.use(require("./user.routes"));
router.use(require("./client.routes"));
router.use(require("./report.routes"));
router.use(require("./media.routes"));

module.exports = router;
