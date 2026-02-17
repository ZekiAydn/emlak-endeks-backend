const router = require("express").Router();
const c = require("../controllers/auth.controller");

const authRequired = require("../middleware/authRequired");
const requireRole = require("../middleware/requireRole");

router.post("/auth/register", authRequired, requireRole("ADMIN"), c.register);
router.post("/auth/login", c.login);
router.post("/auth/logout", c.logout);
router.get("/auth/me", authRequired, c.me);

module.exports = router;
