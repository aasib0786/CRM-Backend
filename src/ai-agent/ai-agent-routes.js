import express from 'express';
import {
  getBotSettings,
  updateBotSettings,
  getBotSources,
} from '../bot/bot-settings-controller.js';

const router = express.Router();

router.get('/settings', getBotSettings);
router.put('/settings', updateBotSettings);
router.get('/sources', getBotSources);

export default router;
