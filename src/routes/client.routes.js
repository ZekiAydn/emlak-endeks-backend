import { Router } from "express";
import * as c from "../controllers/client.controller.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

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

export default router;
