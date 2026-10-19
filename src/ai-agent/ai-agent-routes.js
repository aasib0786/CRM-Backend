import express from 'express';
import {
  getBotSettings,
  updateBotSettings,
  getBotSources,
} from '../bot/bot-settings-controller.js';
import { verifyToken } from '../../middlewares/verifyToken.middleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/settings', getBotSettings);
router.put('/settings', updateBotSettings);
router.get('/sources', getBotSources);

export default router;
