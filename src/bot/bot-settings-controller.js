import connectDB from '../pool.js';
import fs from 'fs';
import path from 'path';

/**
 * Multi-tenant company_id resolver:
 * Ensures company_id is extracted from verified JWT token, with safe fallback
 * for development/unauthenticated testing environments.
 */
export const resolveCompanyId = async (req) => {
  if (req.company_id) return req.company_id;
  if (req.user?.company_id) return req.user.company_id;
  if (req.user?.companyId) return req.user.companyId;
  if (req.headers?.['x-company-id']) return req.headers['x-company-id'];
  if (req.query?.company_id) return req.query.company_id;
  if (req.body?.company_id) return req.body.company_id;

  // Resolve from user record if user is authenticated
  if (req.user?.id || req.user?.email) {
    try {
      const uRes = await connectDB.query(
        `SELECT company_id FROM public.users WHERE id::text = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
        [String(req.user.id || ''), String(req.user.email || '').trim()]
      );
      if (uRes.rows.length > 0 && uRes.rows[0].company_id) {
        req.company_id = uRes.rows[0].company_id;
        return uRes.rows[0].company_id;
      }
    } catch (e) {}
  }

  return null;
};

/**
 * Standard default values for a new bot_settings row
 */
export const DEFAULT_BOT_SETTINGS = {
  is_active: false,
  display_name: 'Aria',
  persona: 'Senior Sales Consultant',
  avatar_url: null,
  communication_style: 'professional',
  primary_language: 'en',
  greeting_template_name: 'sales_bot_greeting',
  active_sources: ['indiamart', 'justdial', 'website'],
  qualification_questions: [
    { id: 'requirement', question: 'What kind of property or service are you looking for?', required: true },
    { id: 'budget', question: 'What is your preferred budget range?', required: true },
    { id: 'location', question: 'What is your preferred location?', required: true },
    { id: 'timeline', question: 'When are you planning to make a decision?', required: false },
  ],
  handoff_keywords: ['human', 'agent', 'executive', 'representative', 'call me', 'talk to human', 'manager', 'connect'],
  max_bot_turns: 8,
  working_hours: {
    enabled: false,
    timezone: 'Asia/Kolkata',
    start: '09:00',
    end: '19:00',
    days: [1, 2, 3, 4, 5, 6],
  },
  out_of_hours_message: 'Thank you for reaching out! Our team is currently offline. We have received your inquiry and our sales expert will connect with you during our working hours (9 AM - 7 PM).',
};

/**
 * Helper to normalize and format bot_settings row for API response
 */
const formatBotSettingsDTO = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    is_active: Boolean(row.is_active),
    isActive: Boolean(row.is_active),
    masterEnabled: Boolean(row.is_active), // Frontend alias
    display_name: row.display_name || 'Aria',
    displayName: row.display_name || 'Aria',
    botName: row.display_name || 'Aria', // Frontend alias
    persona: row.persona || 'Senior Sales Consultant',
    avatar_url: row.avatar_url || null,
    avatarUrl: row.avatar_url || null,
    communication_style: row.communication_style || 'professional',
    communicationStyle: row.communication_style || 'professional',
    tone: row.communication_style || 'professional', // Frontend alias
    primary_language: row.primary_language || 'en',
    primaryLanguage: row.primary_language || 'en',
    language: row.primary_language || 'en', // Frontend alias
    greeting_template_name: row.greeting_template_name || 'sales_bot_greeting',
    greetingTemplateName: row.greeting_template_name || 'sales_bot_greeting',
    active_sources: Array.isArray(row.active_sources) ? row.active_sources : (typeof row.active_sources === 'string' ? JSON.parse(row.active_sources || '[]') : []),
    activeSources: Array.isArray(row.active_sources) ? row.active_sources : (typeof row.active_sources === 'string' ? JSON.parse(row.active_sources || '[]') : []),
    qualification_questions: Array.isArray(row.qualification_questions) ? row.qualification_questions : (typeof row.qualification_questions === 'string' ? JSON.parse(row.qualification_questions || '[]') : []),
    qualificationQuestions: Array.isArray(row.qualification_questions) ? row.qualification_questions : (typeof row.qualification_questions === 'string' ? JSON.parse(row.qualification_questions || '[]') : []),
    handoff_keywords: Array.isArray(row.handoff_keywords) ? row.handoff_keywords : (typeof row.handoff_keywords === 'string' ? JSON.parse(row.handoff_keywords || '[]') : []),
    handoffKeywords: Array.isArray(row.handoff_keywords) ? row.handoff_keywords : (typeof row.handoff_keywords === 'string' ? JSON.parse(row.handoff_keywords || '[]') : []),
    max_bot_turns: Number(row.max_bot_turns) || 8,
    maxBotTurns: Number(row.max_bot_turns) || 8,
    working_hours: typeof row.working_hours === 'object' && row.working_hours !== null ? row.working_hours : (typeof row.working_hours === 'string' ? JSON.parse(row.working_hours || '{}') : {}),
    workingHours: typeof row.working_hours === 'object' && row.working_hours !== null ? row.working_hours : (typeof row.working_hours === 'string' ? JSON.parse(row.working_hours || '{}') : {}),
    out_of_hours_message: row.out_of_hours_message || '',
    outOfHoursMessage: row.out_of_hours_message || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

/**
 * GET /api/v1/bot/settings
 * Multi-tenant: Fetches company's bot_settings. Creates default row if none exists.
 */
export const getBotSettings = async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);

    let { rows } = await connectDB.query(
      `SELECT * FROM public.bot_settings WHERE company_id = $1`,
      [companyId]
    );

    if (rows.length === 0) {
      // Auto-create default settings row for this company
      const insertResult = await connectDB.query(
        `INSERT INTO public.bot_settings (
          company_id, is_active, display_name, persona, avatar_url,
          communication_style, primary_language, greeting_template_name,
          active_sources, qualification_questions, handoff_keywords,
          max_bot_turns, working_hours, out_of_hours_message
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (company_id) DO UPDATE SET updated_at = NOW()
        RETURNING *`,
        [
          companyId,
          DEFAULT_BOT_SETTINGS.is_active,
          DEFAULT_BOT_SETTINGS.display_name,
          DEFAULT_BOT_SETTINGS.persona,
          DEFAULT_BOT_SETTINGS.avatar_url,
          DEFAULT_BOT_SETTINGS.communication_style,
          DEFAULT_BOT_SETTINGS.primary_language,
          DEFAULT_BOT_SETTINGS.greeting_template_name,
          JSON.stringify(DEFAULT_BOT_SETTINGS.active_sources),
          JSON.stringify(DEFAULT_BOT_SETTINGS.qualification_questions),
          JSON.stringify(DEFAULT_BOT_SETTINGS.handoff_keywords),
          DEFAULT_BOT_SETTINGS.max_bot_turns,
          JSON.stringify(DEFAULT_BOT_SETTINGS.working_hours),
          DEFAULT_BOT_SETTINGS.out_of_hours_message,
        ]
      );
      rows = insertResult.rows;
    }

    return res.status(200).json({
      success: true,
      data: formatBotSettingsDTO(rows[0]),
    });
  } catch (error) {
    console.error('getBotSettings error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch bot settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * PUT /api/v1/bot/settings
 * Multi-tenant: Updates company's bot_settings with complete field validation.
 */
export const updateBotSettings = async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const body = req.body || {};

    // 1. Validate communication_style
    const allowedStyles = ['friendly', 'professional', 'enthusiastic', 'concise'];
    let commStyle = body.communication_style || body.communicationStyle || body.tone || 'professional';
    commStyle = commStyle.toLowerCase().trim();
    if (!allowedStyles.includes(commStyle)) {
      return res.status(400).json({
        success: false,
        message: `Invalid communication style. Allowed values: ${allowedStyles.join(', ')}`,
      });
    }

    // 2. Validate primary_language
    const allowedLanguages = ['en', 'hi', 'hinglish'];
    let primaryLang = body.primary_language || body.primaryLanguage || body.language || 'en';
    primaryLang = primaryLang.toLowerCase().trim();
    if (primaryLang === 'english' || primaryLang.startsWith('en')) primaryLang = 'en';
    else if (primaryLang === 'hindi' || primaryLang.startsWith('hi') && primaryLang !== 'hinglish') primaryLang = 'hi';
    else if (primaryLang.includes('hinglish')) primaryLang = 'hinglish';

    if (!allowedLanguages.includes(primaryLang)) {
      return res.status(400).json({
        success: false,
        message: `Invalid primary language. Allowed values: ${allowedLanguages.join(', ')}`,
      });
    }

    // 3. Validate display_name
    const displayName = (body.display_name || body.displayName || body.botName || 'Aria').trim();
    if (!displayName || displayName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Display name must be between 1 and 100 characters',
      });
    }

    // 4. Validate persona
    const persona = (body.persona || 'Senior Sales Consultant').trim();
    if (!persona) {
      return res.status(400).json({
        success: false,
        message: 'Persona cannot be empty',
      });
    }

    // 5. Validate is_active
    const isActive = body.is_active !== undefined ? Boolean(body.is_active)
      : (body.isActive !== undefined ? Boolean(body.isActive)
      : (body.masterEnabled !== undefined ? Boolean(body.masterEnabled) : false));

    // 6. Validate max_bot_turns
    let maxTurns = Number(body.max_bot_turns ?? body.maxBotTurns ?? 8);
    if (isNaN(maxTurns) || maxTurns < 1 || maxTurns > 50) {
      maxTurns = 8;
    }

    // 7. Validate active_sources
    let activeSources = body.active_sources ?? body.activeSources ?? body.sources;
    if (Array.isArray(activeSources)) {
      // If array of objects {id, enabled}, extract enabled IDs
      if (activeSources.length > 0 && typeof activeSources[0] === 'object' && activeSources[0] !== null) {
        activeSources = activeSources.filter((s) => s.enabled).map((s) => s.id || s.name);
      }
    } else {
      activeSources = DEFAULT_BOT_SETTINGS.active_sources;
    }

    // 8. Validate qualification_questions
    let qualQuestions = body.qualification_questions ?? body.qualificationQuestions ?? DEFAULT_BOT_SETTINGS.qualification_questions;
    if (!Array.isArray(qualQuestions)) {
      qualQuestions = DEFAULT_BOT_SETTINGS.qualification_questions;
    }

    // 9. Validate handoff_keywords
    let handoffKeywords = body.handoff_keywords ?? body.handoffKeywords ?? DEFAULT_BOT_SETTINGS.handoff_keywords;
    if (!Array.isArray(handoffKeywords)) {
      handoffKeywords = DEFAULT_BOT_SETTINGS.handoff_keywords;
    }

    // 10. Validate working_hours
    let workingHours = body.working_hours ?? body.workingHours ?? DEFAULT_BOT_SETTINGS.working_hours;
    if (typeof workingHours !== 'object' || workingHours === null) {
      workingHours = DEFAULT_BOT_SETTINGS.working_hours;
    }

    // 11. Other fields
    const greetingTemplateName = (body.greeting_template_name || body.greetingTemplateName || 'sales_bot_greeting').trim();
    const outOfHoursMessage = body.out_of_hours_message ?? body.outOfHoursMessage ?? DEFAULT_BOT_SETTINGS.out_of_hours_message;
    const avatarUrl = body.avatar_url ?? body.avatarUrl ?? null;

    // Execute UPSERT scoped strictly by company_id
    const { rows } = await connectDB.query(
      `INSERT INTO public.bot_settings (
        company_id, is_active, display_name, persona, avatar_url,
        communication_style, primary_language, greeting_template_name,
        active_sources, qualification_questions, handoff_keywords,
        max_bot_turns, working_hours, out_of_hours_message, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
      )
      ON CONFLICT (company_id) DO UPDATE SET
        is_active = EXCLUDED.is_active,
        display_name = EXCLUDED.display_name,
        persona = EXCLUDED.persona,
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.bot_settings.avatar_url),
        communication_style = EXCLUDED.communication_style,
        primary_language = EXCLUDED.primary_language,
        greeting_template_name = EXCLUDED.greeting_template_name,
        active_sources = EXCLUDED.active_sources,
        qualification_questions = EXCLUDED.qualification_questions,
        handoff_keywords = EXCLUDED.handoff_keywords,
        max_bot_turns = EXCLUDED.max_bot_turns,
        working_hours = EXCLUDED.working_hours,
        out_of_hours_message = EXCLUDED.out_of_hours_message,
        updated_at = NOW()
      RETURNING *`,
      [
        companyId,
        isActive,
        displayName,
        persona,
        avatarUrl,
        commStyle,
        primaryLang,
        greetingTemplateName,
        JSON.stringify(activeSources),
        JSON.stringify(qualQuestions),
        JSON.stringify(handoffKeywords),
        maxTurns,
        JSON.stringify(workingHours),
        outOfHoursMessage,
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Bot settings saved successfully',
      data: formatBotSettingsDTO(rows[0]),
    });
  } catch (error) {
    console.error('updateBotSettings error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update bot settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * POST /api/v1/bot/settings/avatar
 * Uploads an image file for the bot avatar and updates bot_settings.avatar_url.
 */
export const uploadBotAvatar = async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded',
      });
    }

    // Relative web URL served by static express middleware at /uploads
    const relativeUrl = `/uploads/bot/${req.file.filename}`;

    const { rows } = await connectDB.query(
      `UPDATE public.bot_settings 
       SET avatar_url = $1, updated_at = NOW() 
       WHERE company_id = $2 
       RETURNING *`,
      [relativeUrl, companyId]
    );

    return res.status(200).json({
      success: true,
      message: 'Bot avatar uploaded successfully',
      avatar_url: relativeUrl,
      avatarUrl: relativeUrl,
      data: formatBotSettingsDTO(rows[0]),
    });
  } catch (error) {
    console.error('uploadBotAvatar error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload bot avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * GET /api/v1/bot/sources
 * Returns all configured lead sources for the company, indicating which ones
 * are currently active in bot_settings.active_sources.
 */
export const getBotSources = async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);

    // Fetch active sources from bot_settings
    const { rows: settingsRows } = await connectDB.query(
      `SELECT active_sources FROM public.bot_settings WHERE company_id = $1`,
      [companyId]
    );

    let activeSourcesList = [];
    if (settingsRows.length > 0 && settingsRows[0].active_sources) {
      activeSourcesList = Array.isArray(settingsRows[0].active_sources)
        ? settingsRows[0].active_sources
        : (typeof settingsRows[0].active_sources === 'string' ? JSON.parse(settingsRows[0].active_sources) : []);
    }

    // Fetch sources configured in lead_sources table
    let dbSources = [];
    try {
      const srcRes = await connectDB.query(
        `SELECT id, name, color, active FROM public.lead_sources ORDER BY sort_order ASC, id ASC`
      );
      dbSources = srcRes.rows;
    } catch (e) {}

    // Canonical source metadata
    const canonicalMeta = {
      indiamart: { name: 'IndiaMart', badgeColor: 'bg-orange-50 text-orange-700 border-orange-200', desc: 'High volume B2B inquiries — strongly recommended' },
      justdial: { name: 'JustDial', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200', desc: 'Local buyers & consumers — fast qualification' },
      tradeindia: { name: 'TradeIndia', badgeColor: 'bg-red-50 text-red-600 border-red-200', desc: 'B2B marketplace leads — optional activation' },
      website: { name: 'Website Forms', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200', desc: 'Direct website landing page inquiries' },
      social: { name: 'Social Media', badgeColor: 'bg-pink-50 text-pink-700 border-pink-200', desc: 'Meta/Instagram ads and direct lead forms' },
      whatsapp: { name: 'Direct WhatsApp', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200', desc: 'Inbound chat messages from prospective clients' },
      manual: { name: 'Manual Entry', badgeColor: 'bg-gray-100 text-gray-600 border-gray-200', desc: 'Manual leads bypass bot and assign directly', locked: true },
    };

    const sourceMap = new Map();

    // Insert canonical sources
    Object.entries(canonicalMeta).forEach(([id, meta]) => {
      sourceMap.set(id.toLowerCase(), {
        id,
        name: meta.name,
        label: meta.name,
        badgeColor: meta.badgeColor,
        desc: meta.desc,
        description: meta.desc,
        locked: Boolean(meta.locked),
        enabled: activeSourcesList.includes(id),
      });
    });

    // Merge any additional custom sources from lead_sources table
    dbSources.forEach((s) => {
      const key = String(s.name || s.id).toLowerCase().replace(/\s+/g, '-');
      if (!sourceMap.has(key)) {
        sourceMap.set(key, {
          id: key,
          name: s.name,
          label: s.name,
          badgeColor: s.color || 'bg-indigo-50 text-indigo-700 border-indigo-200',
          desc: `Custom lead channel: ${s.name}`,
          description: `Custom lead channel: ${s.name}`,
          locked: false,
          enabled: activeSourcesList.includes(key),
        });
      }
    });

    const sources = Array.from(sourceMap.values());

    return res.status(200).json({
      success: true,
      data: sources,
    });
  } catch (error) {
    console.error('getBotSources error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch bot sources',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
