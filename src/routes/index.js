const router = require("express").Router();

router.use(require("./user.routes"));
router.use(require("./report.routes"));
router.use(require("./media.routes"));

module.exports = router;
