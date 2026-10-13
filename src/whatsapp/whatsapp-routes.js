import express from 'express';
import jwt from 'jsonwebtoken';
import {
  getWhatsAppChats,
  getWhatsAppStats,
  getMessagesByChatId,
  sendMessage,
  createChat,
  reassignChat,
  bulkReassignChats,
  bulkAssignChats,
  getWhatsAppAgents,
  updateChatStage,
  getTemplates,
  getQuickReplies,
  verifyWebhook,
  handleWebhook,
  debugMeta,
} from './whatsapp-controller.js';

const router = express.Router();

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    if (token && token !== "null" && token !== "undefined") {
      const decoded = jwt.decode(token);
      if (decoded) req.user = decoded;
    }
  } catch (e) {}
  next();
};

router.use(optionalAuth);

// Meta WhatsApp Webhook endpoints
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);
router.get('/debug-meta', debugMeta);

router.get('/agents', getWhatsAppAgents);
router.get('/chats', getWhatsAppChats);
router.get('/stats', getWhatsAppStats);
router.get('/chats/:chatId/messages', getMessagesByChatId);
router.post('/messages', sendMessage);
router.post('/chats', createChat);
router.patch('/chats/:chatId/assign', reassignChat);
router.patch('/chats/:chatId/stage', updateChatStage);
router.post('/chats/bulk-reassign', bulkReassignChats);
router.post('/chats/bulk-assign', bulkAssignChats);
router.get('/templates', getTemplates);
router.get('/quick-replies', getQuickReplies);

export default router;
