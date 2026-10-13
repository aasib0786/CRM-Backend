import connectDB from '../pool.js';
import { determineLeadAssignee } from '../leads/assignmentService.js';
import { logActivity } from '../activities/activityLogger.js';

/**
 * Checks all 5 handoff criteria:
 * 1. Lead explicitly asks for human or matches handoff_keywords
 * 2. All qualification questions are answered
 * 3. Conversation turns exceed max_bot_turns
 * 4. Negative sentiment detected
 * 5. LLM API failed twice consecutively
 */
export const checkHandoffConditions = ({
  conversation,
  botSettings,
  collectedData = {},
  llmResult = {},
  userMessage = '',
}) => {
  const text = (userMessage || '').toLowerCase();
  const maxTurns = Number(botSettings?.max_bot_turns || 8);
  const currentTurns = Number(conversation?.turn_count || 0) + 1;

  // 1. Explicit request for human or matching handoff keywords
  if (llmResult?.wants_human) {
    return { shouldHandoff: true, reason: 'Lead requested a human expert' };
  }

  const handoffKeywords = botSettings?.handoff_keywords || [
    'human', 'agent', 'executive', 'representative', 'call me', 'talk to human', 'manager', 'connect'
  ];
  const matchedKeyword = handoffKeywords.find((k) => text.includes(String(k).toLowerCase()));
  if (matchedKeyword) {
    return { shouldHandoff: true, reason: `Matched handoff keyword: "${matchedKeyword}"` };
  }

  // 2. All qualification questions answered
  const qualQuestions = Array.isArray(botSettings?.qualification_questions)
    ? botSettings.qualification_questions
    : [];

  const requiredQuestions = qualQuestions.filter((q) => q.required !== false);
  if (requiredQuestions.length > 0) {
    const allAnswered = requiredQuestions.every((q) => {
      const val = collectedData[q.id];
      return val !== undefined && val !== null && String(val).trim().length > 0;
    });

    if (allAnswered) {
      return { shouldHandoff: true, reason: 'All qualification questions completed' };
    }
  }

  // 3. Max bot turns reached
  if (currentTurns >= maxTurns) {
    return { shouldHandoff: true, reason: `Max bot turns limit reached (${currentTurns}/${maxTurns})` };
  }

  // 4. Negative / Frustrated sentiment
  if (llmResult?.sentiment === 'negative') {
    return { shouldHandoff: true, reason: 'Negative lead sentiment detected' };
  }

  // 5. Consecutive LLM errors
  const errorsCount = Number(conversation?.collected_data?.consecutive_errors || 0) + (llmResult?.llmError ? 1 : 0);
  if (errorsCount >= 2) {
    return { shouldHandoff: true, reason: 'Repeated system errors — transferring to human' };
  }

  return { shouldHandoff: false, reason: null };
};

/**
 * Executes full human handoff:
 * - Runs existing Assignment Rules to assign an agent
 * - Updates bot_conversations status to 'handed_off'
 * - Sends handoff message on WhatsApp
 * - Creates agent notification
 * - Logs lead activity with qualification summary
 */
export const executeHumanHandoff = async ({
  conversationId,
  leadId,
  companyId,
  reason,
  collectedData = {},
  botSettings,
  sendWhatsAppMessageFn,
}) => {
  try {
    // 1. Fetch lead details
    const { rows: leadRows } = await connectDB.query(
      `SELECT * FROM public.leads WHERE id = $1`,
      [leadId]
    );
    if (leadRows.length === 0) return null;
    const lead = leadRows[0];

    // 2. Determine agent via Assignment Rules
    let assignedAgent = lead.assigned;
    let assignmentReason = reason;

    if (!assignedAgent || assignedAgent === 'Unassigned' || assignedAgent === 'Auto') {
      const assignmentResult = await determineLeadAssignee({
        ...lead,
        custom_fields: { ...(lead.custom_fields || {}), ...collectedData },
      });
      if (assignmentResult?.assigned) {
        assignedAgent = assignmentResult.assigned;
        assignmentReason = `${reason} (Assigned via: ${assignmentResult.reason})`;
      } else {
        assignedAgent = 'Rajesh Kumar'; // Safe fallback
      }
    }

    // 3. Update lead in database
    await connectDB.query(
      `UPDATE public.leads 
       SET assigned = $1, custom_fields = $2, updated_at = NOW() 
       WHERE id = $3`,
      [assignedAgent, JSON.stringify({ ...(lead.custom_fields || {}), ...collectedData }), leadId]
    );

    // 4. Update bot_conversation
    await connectDB.query(
      `UPDATE public.bot_conversations 
       SET status = 'handed_off', handed_off_at = NOW(), handoff_reason = $1, collected_data = $2, updated_at = NOW() 
       WHERE id = $3`,
      [assignmentReason, JSON.stringify(collectedData), conversationId]
    );

    // 5. Prepare and send handoff message on WhatsApp
    const botName = botSettings?.display_name || 'Aria';
    const lang = botSettings?.primary_language || 'en';

    let handoffMsg = `Our senior expert ${assignedAgent} will contact you shortly to take this forward. Thank you!`;
    if (lang === 'hi') {
      handoffMsg = `हमारे वरिष्ठ विशेषज्ञ ${assignedAgent} जल्द ही आपसे सीधे संपर्क करेंगे। हमसे बातचीत करने के लिए धन्यवाद!`;
    } else if (lang === 'hinglish') {
      handoffMsg = `Hamare senior expert ${assignedAgent} aapse jaldi hi contact karenge. Have a great day!`;
    }

    if (sendWhatsAppMessageFn && lead.phone) {
      await sendWhatsAppMessageFn({
        to: lead.phone,
        text: handoffMsg,
        conversationId,
        leadId,
        companyId,
        sender: 'bot',
        messageType: 'text',
      });
    }

    // 6. Notify agent in notifications table
    await connectDB.query(
      `INSERT INTO public.notifications (type, title, description, lead_id, lead_name, scheduled_at, read, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), false, NOW())`,
      [
        'bot_handoff',
        `Bot Qualified Lead: ${lead.name}`,
        `Lead handed off to ${assignedAgent}. Reason: ${reason}. Requirements: ${collectedData.requirement || 'Not specified'}, Budget: ${collectedData.budget || 'Not specified'}`,
        leadId,
        lead.name,
      ]
    ).catch(() => {});

    // 7. Log to lead_activities
    const summaryText = Object.entries(collectedData)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' • ');

    const activityDesc = `Bot handed off lead to ${assignedAgent}. Reason: ${reason}.${summaryText ? ` Collected data: ${summaryText}` : ''}`;

    await connectDB.query(
      `INSERT INTO public.lead_activities (lead_id, type, description, performed_by, created_at)
       VALUES ($1, 'Bot Handoff', $2, $3, NOW())`,
      [leadId, activityDesc, `${botName} (AI Bot)`]
    ).catch(() => {});

    await logActivity({
      type: 'bot_handoff',
      title: 'Bot Handed Off Lead',
      description: activityDesc,
      userName: `${botName} (AI Bot)`,
      leadName: lead.name,
      leadId: lead.id,
      detail: activityDesc,
    });

    console.log(`[Bot Engine] Lead ${leadId} (${lead.name}) successfully handed off to ${assignedAgent}.`);

    // Trigger Workflow Engine bot_handed_off event
    import('../workflows/workflow-events.js').then((w) => {
      w.emitBotHandedOff(lead, assignmentReason, companyId);
    }).catch((e) => console.error('[Workflow Handoff Hook Error]:', e.message));

    return { assignedAgent, reason: assignmentReason };
  } catch (err) {
    console.error('executeHumanHandoff error:', err.message);
    return null;
  }
};
