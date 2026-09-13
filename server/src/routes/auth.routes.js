import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { requireAdmin, requireOwner } from "../middleware/require-admin.js";

/**
 * Sign-in and admin account routes. There is deliberately no sign-up route:
 * accounts are created by the owner (below) or by the admin CLI.
 */
const router = Router();

router.post("/auth/login", authController.login);
router.post("/auth/logout", authController.logout);
router.get("/auth/me", authController.me);
router.post("/auth/password", requireAdmin, authController.changePassword);

router.get("/auth/admins", requireOwner, authController.listAdmins);
router.post("/auth/admins", requireOwner, authController.createAdmin);
router.post("/auth/admins/:id/reset-password", requireOwner, authController.resetAdminPassword);
router.post("/auth/admins/:id/disable", requireOwner, authController.disableAdmin);
router.post("/auth/admins/:id/enable", requireOwner, authController.enableAdmin);

export default router;
