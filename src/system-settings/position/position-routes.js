import { Router } from "express";
import { createPosition, deletePosition, getAllPositions, updatePosition } from "./position-controller.js";
import { authenticate, requireRole } from "../../../utils/auth.js";
import { verifyToken } from "../../../middlewares/verifyToken.middleware.js";
const router = Router();



router.get('/', verifyToken, getAllPositions);
router.post('/', verifyToken, createPosition);
router.patch('/:id', verifyToken, updatePosition);
router.delete('/:id', verifyToken, deletePosition);

export default router;
