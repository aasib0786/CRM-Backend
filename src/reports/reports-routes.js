import express from 'express';
import { getReportsSummary } from './reports-controller.js';

const router = express.Router();

router.get('/summary', getReportsSummary);

export default router;
