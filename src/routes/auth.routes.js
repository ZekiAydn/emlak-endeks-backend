const router = require("express").Router();
const c = require("../controllers/auth.controller");

router.post("/auth/register", c.register);
router.post("/auth/login", c.login);
router.post("/auth/logout", c.logout);

module.exports = router;
