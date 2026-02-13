const router = require("express").Router();
const c = require("../controllers/user.controller");

router.post("/bootstrap", c.bootstrap);
router.get("/me", c.getMe);
router.put("/me", c.updateMe);

module.exports = router;
