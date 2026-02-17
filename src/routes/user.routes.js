const router = require("express").Router();
const c = require("../controllers/user.controller");
const authRequired = require("../middleware/authRequired");

router.get("/me", authRequired, c.getMe);
router.put("/me", authRequired, c.updateMe);

module.exports = router;
