const router = require("express").Router();
const c = require("../controllers/debug.controller");

router.use("/debug", c.debugEnabled);
router.get("/debug/comparables/resolve", c.resolveComparables);
router.get("/debug/comparables/fetch", c.fetchComparables);
router.get("/debug/comparables/run", c.runComparables);

module.exports = router;
