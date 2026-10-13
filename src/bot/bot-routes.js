import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import {
  getBotSettings,
  updateBotSettings,
  uploadBotAvatar,
  getBotSources,
  resolveCompanyId,
} from './bot-settings-controller.js';

const router = express.Router();

// Middleware to extract auth token and user claims
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]?.trim();
    } else if (req.cookies?.token) {
      token = req.cookies.token?.trim();
    }
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded) {
        req.user = decoded;
        req.company_id = decoded.company_id;
      }
    }
  } catch (e) {}
  next();
};

router.use(optionalAuth);

// Multer storage for bot avatar uploads
const botAvatarDir = path.join(process.cwd(), 'uploads', 'bot');
if (!fs.existsSync(botAvatarDir)) {
  fs.mkdirSync(botAvatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, botAvatarDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `bot-avatar-${uniqueSuffix}${ext}`);
  },
});

const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP) are allowed'));
    }
  },
});

// Bot Settings & Stats Endpoints
router.get('/settings', getBotSettings);
router.put('/settings', updateBotSettings);
router.post('/settings/avatar', avatarUpload.single('avatar'), uploadBotAvatar);
router.get('/sources', getBotSources);

router.get('/stats', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const connectDB = (await import('../pool.js')).default;

    const handledRes = await connectDB.query(
      `SELECT COUNT(DISTINCT lead_id)::int as total
       FROM public.bot_conversations 
       WHERE company_id = $1`,
      [companyId]
    );

    const qualifiedRes = await connectDB.query(
      `SELECT COUNT(DISTINCT lead_id)::int as total
       FROM public.bot_conversations 
       WHERE company_id = $1 
         AND (status = 'handed_off' OR (collected_data->>'budget') IS NOT NULL OR (collected_data->>'requirement') IS NOT NULL)`,
      [companyId]
    );

    const handoffsTodayRes = await connectDB.query(
      `SELECT COUNT(*)::int as total
       FROM public.bot_conversations 
       WHERE company_id = $1 
         AND status = 'handed_off' 
         AND handed_off_at >= CURRENT_DATE`,
      [companyId]
    );

    const activeRes = await connectDB.query(
      `SELECT COUNT(*)::int as total
       FROM public.bot_conversations 
       WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    const handled = handledRes.rows[0]?.total || 0;
    const qualified = qualifiedRes.rows[0]?.total || 0;
    const handoffsToday = handoffsTodayRes.rows[0]?.total || 0;
    const active = activeRes.rows[0]?.total || 0;
    const qualifiedPct = handled > 0 ? Math.round((qualified / handled) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        handled,
        qualified,
        qualifiedPct,
        handoffsToday,
        active,
        avgResponseTimeSec: 2.1,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Per-Lead Bot Management Endpoints
router.post('/leads/:leadId/pause', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { reason = 'Manually paused by agent' } = req.body;
    const { pauseBotForLead } = await import('./bot-engine.js');
    await pauseBotForLead(leadId, reason);

    const connectDB = (await import('../pool.js')).default;
    const { rows } = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [leadId]
    );

    return res.status(200).json({
      success: true,
      message: 'Bot paused for lead',
      data: rows[0] || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/leads/:leadId/resume', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { resumeBotForLead } = await import('./bot-engine.js');
    await resumeBotForLead(leadId);

    const connectDB = (await import('../pool.js')).default;
    const { rows } = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [leadId]
    );

    return res.status(200).json({
      success: true,
      message: 'Bot resumed for lead',
      data: rows[0] || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/leads/:leadId/conversation', async (req, res) => {
  try {
    const { leadId } = req.params;
    const connectDB = (await import('../pool.js')).default;

    const convRes = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [leadId]
    );

    if (convRes.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
        messages: [],
      });
    }

    const conv = convRes.rows[0];
    const msgRes = await connectDB.query(
      `SELECT * FROM public.bot_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conv.id]
    );

    return res.status(200).json({
      success: true,
      data: conv,
      messages: msgRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Dev & Sandbox Bot Simulation Endpoint
router.post('/simulate', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const {
      leadName = 'Rahul Sharma',
      phone = '+919876543210',
      message = 'Hello',
      history = [],
      collectedData = {},
    } = req.body;

    const connectDB = (await import('../pool.js')).default;
    const {
      buildSystemPrompt,
      generateBotTurnResponse,
      countWords,
    } = await import('./llm-service.js');
    const { checkHandoffConditions } = await import('./bot-handoff-service.js');

    // 1. Fetch bot settings
    const settingsRes = await connectDB.query(
      `SELECT * FROM public.bot_settings WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );
    const botSettings = settingsRes.rows[0] || {
      display_name: 'Aria',
      persona: 'Senior Sales Consultant',
      communication_style: 'professional',
      primary_language: 'en',
      qualification_questions: [
        { id: 'requirement', question: 'What type of property or service are you looking for?', required: true },
        { id: 'budget', question: 'What is your comfortable budget range?', required: true },
        { id: 'location', question: 'Which location or area do you prefer?', required: false },
        { id: 'timeline', question: 'When are you planning to finalize?', required: false },
      ],
      handoff_keywords: ['human', 'agent', 'executive', 'call me', 'talk to human'],
      max_bot_turns: 8,
    };

    // 2. Fetch company name and KB articles via ranked search
    let companyName = 'CRM Pro Real Estate';
    const compRes = await connectDB.query(`SELECT name FROM public.companies WHERE id = $1`, [companyId]);
    if (compRes.rows[0]?.name) companyName = compRes.rows[0].name;

    const { kbSearch, recordArticleUsage, logUnansweredQuestion } = await import('../knowledge-base/kb-search-service.js');
    let kbArticles = [];
    try {
      kbArticles = await kbSearch(companyId, message, { limit: 4, minScore: 0.15 });
    } catch (e) {
      console.warn('[Simulate KB Search Error]:', e.message);
    }

    const isQuestion = /\?|what|when|where|why|how|who|price|cost|rera|possession|booking|document|discount|offer|emi|loan|kya|kaise|kab|kaha|kitna/i.test(message);
    if (isQuestion && (!kbArticles || kbArticles.length === 0)) {
      try {
        await logUnansweredQuestion({
          companyId,
          questionText: message.trim(),
        });
      } catch (logErr) {
        console.warn('[Simulate logUnansweredQuestion error]:', logErr.message);
      }
    } else if (kbArticles && kbArticles.length > 0) {
      try {
        await recordArticleUsage(kbArticles.map((a) => a.id));
      } catch (useErr) {
        console.warn('[Simulate recordArticleUsage error]:', useErr.message);
      }
    }

    // 3. Build system prompt
    const mockLead = { name: leadName, phone, source: 'WhatsApp Ads' };
    const systemPrompt = buildSystemPrompt({
      botSettings,
      companyName,
      lead: mockLead,
      knowledgeArticles: kbArticles,
      collectedData,
    });

    // 4. Generate bot response (LLM or heuristic fallback)
    const turnResult = await generateBotTurnResponse({
      systemPrompt,
      botSettings,
      userMessage: message,
      conversationHistory: history,
      collectedData,
      knowledgeArticles: kbArticles,
    });

    // 5. Merge collected data
    const updatedCollectedData = {
      ...collectedData,
      ...(turnResult.extracted || {}),
    };

    // 6. Check handoff conditions
    const mockConversation = {
      turn_count: (history.filter((m) => m.role === 'user').length || 0) + 1,
    };
    const handoffCheck = checkHandoffConditions({
      conversation: mockConversation,
      botSettings,
      collectedData: updatedCollectedData,
      llmResult: turnResult,
      userMessage: message,
    });

    // 7. Calculate estimated lead score
    let scoreEstimate = 50;
    if (updatedCollectedData.budget) scoreEstimate += 15;
    if (updatedCollectedData.requirement) scoreEstimate += 15;
    if (updatedCollectedData.location) scoreEstimate += 10;
    if (updatedCollectedData.timeline) scoreEstimate += 10;

    return res.status(200).json({
      success: true,
      data: {
        reply: turnResult.reply,
        systemPrompt,
        promptWords: countWords(systemPrompt),
        matchedArticles: kbArticles || [],
        extracted: updatedCollectedData,
        newlyExtracted: turnResult.extracted || {},
        intent: turnResult.intent || 'inquiry',
        sentiment: turnResult.sentiment || 'neutral',
        wantsHuman: turnResult.wants_human || false,
        handoff: handoffCheck,
        scoreEstimate: Math.min(100, scoreEstimate),
        provider: turnResult.provider || (process.env.LLM_PROVIDER || 'gemini').toLowerCase(),
        model: turnResult.model || process.env.LLM_MODEL || (process.env.LLM_PROVIDER === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash-lite'),
        tokensUsed: turnResult.tokensUsed || 0,
        providerUsed: turnResult.isFallback
          ? `Heuristic Mode (${(turnResult.provider || 'gemini').toUpperCase()} fallback)`
          : `${(turnResult.provider || process.env.LLM_PROVIDER || 'gemini').toUpperCase()} (${turnResult.model || process.env.LLM_MODEL || 'gemini-2.5-flash-lite'})`,
        isFallback: Boolean(turnResult.isFallback),
        llmError: Boolean(turnResult.llmError),
        errorMessage: turnResult.errorMessage || null,
      },
    });
  } catch (err) {
    console.error('[Bot Simulator Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
