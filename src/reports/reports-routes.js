import express from 'express';
import { getReportsSummary } from './reports-controller.js';
import { verifyToken } from '../../middlewares/verifyToken.middleware.js';

const router = express.Router();

router.get('/summary', verifyToken, getReportsSummary);

export default router;
