import express from 'express';
import {
  getIntegrations,
  updateIntegration,
  createFormAccount,
  getFormAccounts,
  deleteFormAccount,
} from './integrations-controller.js';
import { verifyToken } from '../../middlewares/verifyToken.middleware.js';

const router = express.Router();

router.get('/test', (req, res) => res.json({ test: true }));
router.get('/', verifyToken, getIntegrations);
router.put('/:key', verifyToken, updateIntegration);

// Website Forms Integration Accounts
router.get('/forms/accounts', verifyToken, getFormAccounts);
router.post('/forms/accounts', verifyToken, createFormAccount);
router.delete('/forms/accounts/:id', verifyToken, deleteFormAccount);

export default router;
