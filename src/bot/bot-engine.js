import connectDB from '../pool.js';
import { generateAIReply } from './llm-service.js';
import { checkHandoffConditions, executeHumanHandoff } from './bot-handoff-service.js';
import { getScoringConfigFromDb, calculateLeadScore } from '../leads/scoringService.js';
import { logActivity } from '../activities/activityLogger.js';
import { kbSearch, recordArticleUsage, logUnansweredQuestion } from '../knowledge-base/kb-search-service.js';

/**
 * Checks if current time is within configured working hours.
 */
export const isWithinWorkingHours = (workingHours) => {
  if (!workingHours || !workingHours.enabled) return true;

  try {
    const tz = workingHours.timezone || 'Asia/Kolkata';
    const now = new Date();
    // Get time string in target timezone
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
    const dayOfWeek = Number(now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'narrow' })) || now.getDay();

    const allowedDays = Array.isArray(workingHours.days) ? workingHours.days : [1, 2, 3, 4, 5, 6];
    if (!allowedDays.includes(dayOfWeek) && !allowedDays.includes(now.getDay())) {
      return false;
    }

    const start = workingHours.start || '09:00';
    const end = workingHours.end || '19:00';
    return timeStr >= start && timeStr <= end;
  } catch (err) {
    console.warn('[Bot Engine] Error evaluating working hours, defaulting to true:', err.message);
    return true;
  }
};

/**
 * Helper to normalize phone number to WhatsApp international standard (e.g. 919876543210).
 */
export const normalizePhoneForWhatsApp = (phone) => {
  if (!phone) return '';
  let cleanDigits = phone.replace(/\D/g, '');
  if (cleanDigits.length === 10) {
    cleanDigits = '91' + cleanDigits;
  } else if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
    cleanDigits = '91' + cleanDigits.slice(1);
  } else if (cleanDigits.length > 10 && !cleanDigits.startsWith('91')) {
    cleanDigits = '91' + cleanDigits.slice(-10);
  }
  return cleanDigits;
};

/**
 * Dispatches an outbound WhatsApp message via Meta Cloud API or simulates in local dev,
 * persisting to bot_messages and syncing to whatsapp_messages for the CRM timeline.
 */
export const sendWhatsAppMessage = async ({
  to,
  text,
  templateName,
  templateParams = [],
  conversationId,
  leadId,
  companyId,
  sender = 'bot',
  messageType = 'text',
  tokensUsed = 0,
}) => {
  const waRecipient = normalizePhoneForWhatsApp(to);
  if (!waRecipient) {
    console.warn('[Bot Engine] No valid recipient phone number provided for WhatsApp dispatch');
    return null;
  }

  const waToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;

  let waMessageId = `wa-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  if (waToken && waPhoneId) {
    try {
      const payload = templateName
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: waRecipient,
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'en_US' },
              components: templateParams.length > 0 ? [
                {
                  type: 'body',
                  parameters: templateParams.map((p) => ({ type: 'text', text: String(p) })),
                }
              ] : undefined,
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: waRecipient,
            type: 'text',
            text: { preview_url: false, body: text.trim() },
          };

      const metaRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const metaData = await metaRes.json();
      if (metaRes.ok && metaData?.messages?.[0]?.id) {
        waMessageId = metaData.messages[0].id;
        console.log(`[Bot Engine] WhatsApp dispatched OK via Meta Cloud API. MsgId: ${waMessageId}`);
      } else {
        console.warn(`[Bot Engine] Meta API dispatch error:`, JSON.stringify(metaData));
      }
    } catch (e) {
      console.error(`[Bot Engine] WhatsApp dispatch network error:`, e.message);
    }
  } else {
    console.log(`[Bot Engine] Meta credentials not in .env. Simulated WhatsApp message to ${waRecipient}: "${text || templateName}"`);
  }

  // 1. Record in bot_messages
  const msgInsert = await connectDB.query(
    `INSERT INTO public.bot_messages (
      company_id, conversation_id, lead_id, direction, sender,
      message_type, content, wa_message_id, tokens_used, created_at
    ) VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, NOW())
    RETURNING *`,
    [
      companyId,
      conversationId,
      leadId,
      sender,
      messageType,
      text || `[Template: ${templateName}]`,
      waMessageId,
      tokensUsed,
    ]
  ).catch((e) => {
    console.error('[Bot Engine] bot_messages insert error:', e.message);
    return { rows: [] };
  });

  // 2. Sync to whatsapp_chats and whatsapp_messages for the CRM timeline
  try {
    const last10 = waRecipient.slice(-10);
    const chatRes = await connectDB.query(
      `SELECT id FROM public.whatsapp_chats 
       WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1 
       LIMIT 1`,
      [last10]
    );

    let chatId = chatRes.rows[0]?.id;
    if (!chatId && leadId) {
      const leadRes = await connectDB.query(`SELECT name FROM public.leads WHERE id = $1`, [leadId]);
      const lName = leadRes.rows[0]?.name || 'Prospect';
      const newChat = await connectDB.query(
        `INSERT INTO public.whatsapp_chats (contact_name, phone, lead_id, last_message, last_message_time, status)
         VALUES ($1, $2, $3, $4, NOW(), 'active') RETURNING id`,
        [lName, waRecipient, leadId, text || templateName]
      );
      chatId = newChat.rows[0]?.id;
    }

    if (chatId) {
      await connectDB.query(
        `INSERT INTO public.whatsapp_messages (chat_id, text, sender, timestamp, read, wamid)
         VALUES ($1, $2, 'agent', NOW(), true, $3)`,
        [chatId, text || `[Template: ${templateName}]`, waMessageId]
      );
      await connectDB.query(
        `UPDATE public.whatsapp_chats SET last_message = $1, last_message_time = NOW() WHERE id = $2`,
        [text || templateName, chatId]
      );
    }
  } catch (syncErr) {
    console.warn('[Bot Engine] Sync to whatsapp_chats error:', syncErr.message);
  }

  return msgInsert.rows[0] || null;
};

/**
 * TRIGGER: Called on lead creation across all channels.
 * Checks bot_settings, verifies active source, creates bot_conversation,
 * and sends approved WhatsApp template greeting.
 */
export const handleLeadCreated = async (leadId, companyId) => {
  try {
    if (!leadId) return;

    // 1. Fetch lead
    const { rows: leadRows } = await connectDB.query(
      `SELECT * FROM public.leads WHERE id = $1`,
      [leadId]
    );
    if (leadRows.length === 0) return;
    const lead = leadRows[0];

    const targetCompanyId = companyId || lead.company_id || (await (async () => {
      const { rows } = await connectDB.query(`SELECT id FROM public.companies LIMIT 1`);
      return rows[0]?.id || '00000000-0000-0000-0000-000000000000';
    })());

    // 2. Fetch bot_settings for this company
    const { rows: settingsRows } = await connectDB.query(
      `SELECT * FROM public.bot_settings WHERE company_id = $1`,
      [targetCompanyId]
    );
    if (settingsRows.length === 0 || !settingsRows[0].is_active) {
      return; // Bot is disabled for this company
    }
    const botSettings = settingsRows[0];

    // 3. Verify phone number
    const cleanDigits = (lead.phone || '').replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      return; // No valid phone number for WhatsApp
    }

    // 4. Verify source activation
    const activeSources = Array.isArray(botSettings.active_sources)
      ? botSettings.active_sources.map((s) => String(s).toLowerCase().trim())
      : [];

    const leadSource = String(lead.source || 'manual').toLowerCase().trim();
    const isSourceActive = activeSources.some(
      (as) => leadSource.includes(as) || as.includes(leadSource)
    );

    if (!isSourceActive && activeSources.length > 0) {
      console.log(`[Bot Engine] Lead source "${lead.source}" not enabled in bot active_sources.`);
      return;
    }

    // 5. Create or get existing active bot_conversation
    let convRes = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE company_id = $1 AND lead_id = $2`,
      [targetCompanyId, leadId]
    );

    let conversation;
    if (convRes.rows.length === 0) {
      const newConv = await connectDB.query(
        `INSERT INTO public.bot_conversations (
          company_id, lead_id, status, turn_count, collected_data, created_at, updated_at
        ) VALUES ($1, $2, 'active', 0, '{}'::jsonb, NOW(), NOW())
        RETURNING *`,
        [targetCompanyId, leadId]
      );
      conversation = newConv.rows[0];
    } else {
      conversation = convRes.rows[0];
      if (conversation.status !== 'active') return;
    }

    // 6. Send approved WhatsApp template message
    const botName = botSettings.display_name || 'Aria';
    const templateName = botSettings.greeting_template_name || 'sales_bot_greeting';
    const greetingText = `Hello ${lead.name || 'there'}! I am ${botName}, your sales assistant. Thanks for your inquiry! How can I assist you today?`;

    await sendWhatsAppMessage({
      to: lead.phone,
      text: greetingText,
      templateName,
      templateParams: [lead.name || 'there', botName],
      conversationId: conversation.id,
      leadId: lead.id,
      companyId: targetCompanyId,
      sender: 'bot',
      messageType: 'template',
    });

    // 7. Log lead activity
    await connectDB.query(
      `INSERT INTO public.lead_activities (lead_id, type, description, performed_by, created_at)
       VALUES ($1, 'WhatsApp', $2, $3, NOW())`,
      [lead.id, `Bot greeting sent to ${lead.name} via WhatsApp template "${templateName}"`, `${botName} (AI Bot)`]
    ).catch(() => {});

    await logActivity({
      type: 'bot_greeting',
      title: 'Bot Greeting Sent',
      description: `Automated WhatsApp greeting sent to ${lead.name}`,
      userName: `${botName} (AI Bot)`,
      leadName: lead.name,
      leadId: lead.id,
      detail: `Template: ${templateName}`,
    });

    console.log(`[Bot Engine] Initial WhatsApp greeting triggered for lead ${lead.id} (${lead.name})`);
  } catch (err) {
    console.error('[Bot Engine] handleLeadCreated error:', err.message);
  }
};

const activeProcessingPhoneLocks = new Set();

/**
 * INBOUND: Handles incoming WhatsApp messages from Meta webhook.
 * - Idempotency by wa_message_id
 * - Concurrency lock per phone
 * - 24h customer service window validation
 * - Working hours check
 * - Knowledge base and project retrieval
 * - LLM reply generation with guardrails
 * - Qualification data extraction & lead score recalculation
 * - Handoff execution
 */
export const processInboundWhatsAppMessage = async ({
  from,
  text,
  msgId,
  mediaUrl,
  mediaType,
}) => {
  if (!from || !text?.trim()) return null;

  const cleanDigits = from.replace(/\D/g, '');
  const last10 = cleanDigits.slice(-10);

  // Rate-limiting lock per phone number to prevent rapid concurrent race conditions
  if (activeProcessingPhoneLocks.has(last10)) {
    console.log(`[Bot Engine] Rate-limit guard: Message for ${last10} currently in-flight. Skipping duplicate burst.`);
    return { inFlight: true };
  }
  activeProcessingPhoneLocks.add(last10);

  try {

    // 1. Idempotency Check (Deduplicate by wa_message_id)
    if (msgId) {
      const existingMsg = await connectDB.query(
        `SELECT id FROM public.bot_messages WHERE wa_message_id = $1 LIMIT 1`,
        [msgId]
      );
      if (existingMsg.rows.length > 0) {
        console.log(`[Bot Engine] Duplicate message ${msgId} ignored.`);
        return { duplicate: true };
      }
    }

    // 2. Find matching lead and bot_conversation
    const leadQuery = await connectDB.query(
      `SELECT l.*, c.id as conversation_id, c.status as conv_status, 
              c.turn_count, c.collected_data, c.last_user_message_at
       FROM public.leads l
       LEFT JOIN public.bot_conversations c ON (c.lead_id = l.id)
       WHERE right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 10) = $1
       ORDER BY c.created_at DESC NULLS LAST
       LIMIT 1`,
      [last10]
    );

    if (leadQuery.rows.length === 0) {
      return null; // Not an existing lead, handled by general CRM chat
    }

    const lead = leadQuery.rows[0];
    const companyId = lead.company_id || (await (async () => {
      const { rows } = await connectDB.query(`SELECT id FROM public.companies LIMIT 1`);
      return rows[0]?.id || '00000000-0000-0000-0000-000000000000';
    })());

    // 3. Fetch bot_settings for company
    const { rows: settingsRows } = await connectDB.query(
      `SELECT * FROM public.bot_settings WHERE company_id = $1`,
      [companyId]
    );
    if (settingsRows.length === 0 || !settingsRows[0].is_active) {
      return null; // Bot inactive
    }
    const botSettings = settingsRows[0];

    // If conversation is paused or handed_off, bot stays silent
    if (lead.conv_status === 'paused' || lead.conv_status === 'handed_off') {
      console.log(`[Bot Engine] Bot is ${lead.conv_status} for lead ${lead.id}. Skipping automated reply.`);
      return null;
    }

    // If no conversation existed, create an active one now
    let conversationId = lead.conversation_id;
    let turnCount = Number(lead.turn_count || 0);
    let collectedData = lead.collected_data || {};

    if (!conversationId) {
      const newConv = await connectDB.query(
        `INSERT INTO public.bot_conversations (
          company_id, lead_id, status, turn_count, collected_data, last_user_message_at, created_at, updated_at
        ) VALUES ($1, $2, 'active', 1, '{}'::jsonb, NOW(), NOW(), NOW())
        RETURNING *`,
        [companyId, lead.id]
      );
      conversationId = newConv.rows[0].id;
      turnCount = 1;
    } else {
      turnCount += 1;
      await connectDB.query(
        `UPDATE public.bot_conversations 
         SET turn_count = $1, last_user_message_at = NOW(), updated_at = NOW() 
         WHERE id = $2`,
        [turnCount, conversationId]
      );
    }

    // 4. Save incoming message in bot_messages
    await connectDB.query(
      `INSERT INTO public.bot_messages (
        company_id, conversation_id, lead_id, direction, sender,
        message_type, content, wa_message_id, created_at
      ) VALUES ($1, $2, $3, 'inbound', 'lead', 'text', $4, $5, NOW())`,
      [companyId, conversationId, lead.id, text.trim(), msgId]
    );

    // 5. Working Hours Check
    if (!isWithinWorkingHours(botSettings.working_hours)) {
      const alreadySentOutOfHours = collectedData?.out_of_hours_sent;
      if (!alreadySentOutOfHours) {
        const outOfHoursMsg = botSettings.out_of_hours_message ||
          'Thank you for reaching out! Our team is currently offline. We will connect with you during our working hours.';

        await sendWhatsAppMessage({
          to: lead.phone,
          text: outOfHoursMsg,
          conversationId,
          leadId: lead.id,
          companyId,
          sender: 'bot',
          messageType: 'text',
        });

        collectedData.out_of_hours_sent = true;
        await connectDB.query(
          `UPDATE public.bot_conversations SET collected_data = $1 WHERE id = $2`,
          [JSON.stringify(collectedData), conversationId]
        );
      }
      return { outOfHours: true };
    }

    // 6. Retrieve relevant Knowledge Base articles (Ranked Vector/Keyword Search)
    let knowledgeArticles = [];
    try {
      knowledgeArticles = await kbSearch(companyId, text, {
        projectId: lead.project_id || null,
        limit: 4,
        minScore: 0.15,
      });
    } catch (kbErr) {
      console.warn('[Bot Engine] kbSearch error:', kbErr.message);
    }

    // Question detection for unanswered logging
    const isQuestion = /\?|what|when|where|why|how|who|price|cost|rera|possession|booking|document|discount|offer|emi|loan|kya|kaise|kab|kaha|kitna/i.test(text);

    // If lead asked a question but no KB articles met the threshold, log to kb_unanswered
    if (isQuestion && (!knowledgeArticles || knowledgeArticles.length === 0)) {
      try {
        await logUnansweredQuestion({
          companyId,
          leadId: lead.id,
          questionText: text.trim(),
          botConversationId: conversationId,
        });
      } catch (logErr) {
        console.warn('[Bot Engine] logUnansweredQuestion error:', logErr.message);
      }
    }

    // 7. Retrieve Project & Inventory (if linked)
    let project = null;
    let inventory = [];
    if (lead.project_id) {
      try {
        const projRes = await connectDB.query(`SELECT * FROM public.projects WHERE id = $1`, [lead.project_id]);
        if (projRes.rows.length > 0) {
          project = projRes.rows[0];
          const invRes = await connectDB.query(
            `SELECT data FROM public.project_inventory WHERE project_id = $1 LIMIT 5`,
            [lead.project_id]
          );
          inventory = invRes.rows;
        }
      } catch (e) {}
    }

    // 8. Fetch last 10 messages for conversation history
    const { rows: historyRows } = await connectDB.query(
      `SELECT sender, content FROM public.bot_messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC LIMIT 10`,
      [conversationId]
    );

    // 9. Generate AI Reply with strict Guardrails & JSON format
    const companyRes = await connectDB.query(`SELECT name FROM public.companies WHERE id = $1`, [companyId]).catch(() => ({ rows: [] }));
    const companyName = companyRes.rows[0]?.name || 'CRM Pro Solutions';

    const llmResult = await generateAIReply({
      botSettings,
      companyName,
      lead,
      project,
      inventory,
      knowledgeArticles,
      history: historyRows,
      userMessage: text,
    });

    // Record usage for retrieved articles incorporated into the prompt
    if (knowledgeArticles && knowledgeArticles.length > 0) {
      try {
        const articleIds = knowledgeArticles.map((a) => a.id).filter(Boolean);
        if (articleIds.length > 0) {
          await recordArticleUsage(articleIds);
        }
      } catch (useErr) {
        console.warn('[Bot Engine] recordArticleUsage error:', useErr.message);
      }
    }

    // 10. Update collected data & Lead custom fields
    if (llmResult.extracted && Object.keys(llmResult.extracted).length > 0) {
      Object.entries(llmResult.extracted).forEach(([key, val]) => {
        if (val) collectedData[key] = val;
      });

      // Update lead custom fields
      await connectDB.query(
        `UPDATE public.leads 
         SET custom_fields = $1, updated_at = NOW() 
         WHERE id = $2`,
        [JSON.stringify({ ...(lead.custom_fields || {}), ...collectedData }), lead.id]
      );

      // Trigger dynamic Lead Scoring recalculation
      try {
        const scoringConfig = await getScoringConfigFromDb();
        const updatedLeadData = {
          ...lead,
          custom_fields: { ...(lead.custom_fields || {}), ...collectedData },
        };
        const { score, scoreFactors } = calculateLeadScore(updatedLeadData, scoringConfig);
        await connectDB.query(
          `UPDATE public.leads SET score = $1, score_factors = $2 WHERE id = $3`,
          [score, JSON.stringify(scoreFactors), lead.id]
        );
      } catch (scoreErr) {
        console.warn('[Bot Engine] Error recalculating lead score:', scoreErr.message);
      }
    }

    // 11. Check Handoff Conditions
    const handoffCheck = checkHandoffConditions({
      conversation: { turn_count: turnCount, collected_data: collectedData },
      botSettings,
      collectedData,
      llmResult,
      userMessage: text,
    });

    if (handoffCheck.shouldHandoff) {
      await executeHumanHandoff({
        conversationId,
        leadId: lead.id,
        companyId,
        reason: handoffCheck.reason,
        collectedData,
        botSettings,
        sendWhatsAppMessageFn: sendWhatsAppMessage,
      });
      return { handedOff: true, reason: handoffCheck.reason };
    }

    // 12. Send AI Reply to Lead
    await sendWhatsAppMessage({
      to: lead.phone,
      text: llmResult.reply,
      conversationId,
      leadId: lead.id,
      companyId,
      sender: 'bot',
      messageType: 'text',
      tokensUsed: llmResult.tokensUsed || 0,
    });

    // Update conversation record with collected data
    await connectDB.query(
      `UPDATE public.bot_conversations 
       SET collected_data = $1, updated_at = NOW() 
       WHERE id = $2`,
      [JSON.stringify(collectedData), conversationId]
    );

    return {
      success: true,
      reply: llmResult.reply,
      collectedData,
    };
  } catch (err) {
    console.error('[Bot Engine] processInboundWhatsAppMessage error:', err.message);
    return null;
  } finally {
    setTimeout(() => {
      activeProcessingPhoneLocks.delete(last10);
    }, 2000);
  }
};

/**
 * Automatically pause the bot for a lead (e.g. when an agent sends a manual message from CRM).
 */
export const pauseBotForLead = async (leadId, reason = 'Agent takeover from CRM') => {
  try {
    if (!leadId) return;
    await connectDB.query(
      `UPDATE public.bot_conversations 
       SET status = 'paused', handoff_reason = $1, updated_at = NOW() 
       WHERE lead_id = $2 AND status = 'active'`,
      [reason, leadId]
    );
    console.log(`[Bot Engine] Bot paused for lead ${leadId} (${reason}).`);
  } catch (err) {
    console.error('[Bot Engine] pauseBotForLead error:', err.message);
  }
};

/**
 * Resumes bot qualification for a lead.
 */
export const resumeBotForLead = async (leadId) => {
  try {
    if (!leadId) return;
    await connectDB.query(
      `UPDATE public.bot_conversations 
       SET status = 'active', updated_at = NOW() 
       WHERE lead_id = $2 AND status = 'paused'`,
      [leadId]
    );
    console.log(`[Bot Engine] Bot resumed for lead ${leadId}.`);
  } catch (err) {
    console.error('[Bot Engine] resumeBotForLead error:', err.message);
  }
};
