import express from 'express';
import jwt from 'jsonwebtoken';
import {
  getIntegrations,
  updateIntegration,
  createFormAccount,
  getFormAccounts,
  deleteFormAccount,
} from './integrations-controller.js';

const router = express.Router();

const extractUser = (req, res, next) => {
  try {
    let token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]?.trim()
      : req.cookies?.token?.trim();
    if (token) {
      if (token.startsWith('"') && token.endsWith('"')) {
        token = token.slice(1, -1);
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      req.user = decoded;
      req.role = decoded.role;
      req.company_id = decoded.company_id;
    }
  } catch (err) {
    // continue without blocking
  }
  next();
};

router.get('/test', (req, res) => res.json({ test: true }));
router.get('/', getIntegrations);
router.put('/:key', updateIntegration);

// Website Forms Integration Accounts
router.get('/forms/accounts', extractUser, getFormAccounts);
router.post('/forms/accounts', extractUser, createFormAccount);
router.delete('/forms/accounts/:id', extractUser, deleteFormAccount);

export default router;

