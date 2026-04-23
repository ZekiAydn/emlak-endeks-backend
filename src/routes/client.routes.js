const router = require("express").Router();
const c = require("../controllers/client.controller");
const authRequired = require("../middleware/authRequired");

router.use(authRequired);

router.get("/clients", c.listClients);
router.post("/clients", c.createClient);
router.get("/clients/:id/properties", c.listClientProperties);
router.post("/clients/:id/properties", c.createClientProperty);
router.get("/clients/:id", c.getClient);
router.put("/clients/:id", c.updateClient);
router.delete("/clients/:id", c.deleteClient);

router.get("/properties/:id", c.getProperty);
router.put("/properties/:id", c.updateProperty);
router.delete("/properties/:id", c.deleteProperty);

module.exports = router;
