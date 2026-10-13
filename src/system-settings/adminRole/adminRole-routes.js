import { Router } from "express";

import {
    createRole,
    getRoles,
    updateRoles,
    deleteRole,
    getRoleByName,
    cloneRole,
    getRoleStats,
    getRoleById
} from "./adminRole-controller.js";

import { verifyToken } from "../../../middlewares/verifyToken.middleware.js";
const router = Router();


router.post('/create', verifyToken, createRole);
router.get('/get-all', verifyToken, getRoles);
router.put('/update/:id', verifyToken, updateRoles);
router.delete('/delete/:id', verifyToken, deleteRole);
router.post('/get-by-name', verifyToken, getRoleByName);
router.get('/get-by-id/:id', verifyToken, getRoleById);
router.post('/clone/:id', verifyToken, cloneRole);
router.get('/stats', verifyToken, getRoleStats);


export default router;
