const router = require("express").Router();
const multer = require("multer");
const c = require("../controllers/media.controller");
const authRequired = require("../middleware/authRequired");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post("/media/upload",authRequired, upload.single("file"), c.upload);
router.get("/media/:id",authRequired, c.getById);
router.delete("/media/:id",authRequired, c.deleteById);

module.exports = router;
