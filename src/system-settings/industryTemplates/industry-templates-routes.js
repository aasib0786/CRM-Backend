import { Router } from 'express';
import {
  getIndustryTemplates,
  createIndustryTemplate,
  updateIndustryTemplate,
  deleteIndustryTemplate,
  duplicateIndustryTemplate,
  switchIndustryTemplate,
} from './industry-templates-controller.js';
import jwt from 'jsonwebtoken';

const router = Router();

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1]?.trim();
      if (token && token !== "null" && token !== "undefined") {
        const decoded = jwt.decode(token);
        if (decoded) req.user = decoded;
      }
    }
  } catch (e) {}
  next();
};

/* Static paths first — before parameterised ones */
router.get('/get-all', optionalAuth, getIndustryTemplates);
router.post('/create', optionalAuth, createIndustryTemplate);
router.patch('/switch', optionalAuth, switchIndustryTemplate);

/* Parameterised routes last */
router.post('/duplicate/:id', optionalAuth, duplicateIndustryTemplate);
router.put('/update/:id', optionalAuth, updateIndustryTemplate);
router.patch('/update/:id', optionalAuth, updateIndustryTemplate);
router.delete('/delete/:id', optionalAuth, deleteIndustryTemplate);

export default router;