// // routes/dashboardRoute.js
// import express from 'express';
// import { getDashboard } from './dashboard-controller.js';
// import { verifyToken } from "../../middlewares/verifyToken.middleware.js"

// const router = express.Router();

// router.get('/get-dashboard-data', verifyToken, getDashboard);

// export default router;

// dashboard.routes.js

import { Router } from "express";
import { verifyToken } from "../../middlewares/verifyToken.middleware.js"
import { getDashboardSummary, getLowStockItems, getSalesTrend, getTopSellingItems } from "./dashboard-controller.js";

const router = Router();

router.use(verifyToken);
router.get("/summary", getDashboardSummary);
router.get("/sales-trend", getSalesTrend)
router.get("/low-stock", getLowStockItems);
router.get("/top-items", getTopSellingItems);

export default router;