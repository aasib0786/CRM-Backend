import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';
import { getHierarchyAllowedAssignees } from '../leads/lead-controller.js';

// Helper to format chat row + messages into full conversation model
const toConversationDTO = (chat, messages = []) => {
  const agentName = chat.assigned_agent || chat.lead_assigned || 'Unassigned';
  const initials = agentName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  const formattedMessages = (messages || []).map((m) => ({
    id: m.id,
    direction: m.sender === 'me' || m.sender === 'agent' || m.sender === 'outgoing' ? 'outgoing' : 'incoming',
    text: m.text || '',
    time: m.timestamp
      ? new Date(m.timestamp).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : 'Just now',
    read: m.read !== false,
    status: m.status || 'sent',
    wamid: m.wamid || null,
  }));

  const lastMsgTime = chat.last_message_time
    ? new Date(chat.last_message_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : 'Just now';

  let hist = [];
  if (Array.isArray(chat.assignment_history)) {
    hist = chat.assignment_history;
  } else if (typeof chat.assignment_history === 'string') {
    try { hist = JSON.parse(chat.assignment_history); } catch { hist = []; }
  }

  let tags = [];
  if (Array.isArray(chat.tags)) {
    tags = chat.tags;
  } else if (typeof chat.tags === 'string') {
    try { tags = JSON.parse(chat.tags); } catch { tags = []; }
  }

  if (Array.isArray(chat.lead_tags) && chat.lead_tags.length > 0) {
    tags = [...new Set([...tags, ...chat.lead_tags])];
  }

  return {
    id: chat.id,
    leadId: chat.lead_actual_id || chat.lead_id || '',
    name: chat.lead_actual_name || chat.contact_name || 'Contact',
    phone: chat.lead_phone || chat.phone || '',
    company: chat.lead_company || '',
    email: chat.lead_email || '',
    source: chat.lead_source || chat.source || 'WhatsApp',
    notes: chat.lead_notes || '',
    avatar: chat.avatar || '',
    unread: Number(chat.unread_count) || 0,
    lastMessage: chat.last_message || (formattedMessages.length > 0 ? formattedMessages[formattedMessages.length - 1].text : ''),
    lastMessageTime: lastMsgTime,
    assigned: agentName,
    assignedAgentId: chat.assigned_agent_id || '',
    assignedAgentName: agentName,
    assignedAgentInitials: initials || 'U',
    assignedAgentActive: true,
    stage: chat.lead_stage || chat.stage || 'New Inquiry',
    dealValue: chat.lead_value || chat.deal_value || '₹0',
    tags: tags.length > 0 ? tags : ['Active'],
    reassignedFrom: chat.reassigned_from || null,
    reassignReason: chat.reassign_reason || null,
    assignmentHistory: hist,
    messages: formattedMessages,
    channel: chat.channel || 'WhatsApp',
  };
};

export const getWhatsAppChats = async (req, res) => {
  try {
    const hierarchy = await getHierarchyAllowedAssignees(req.user);
    let hierarchyWhere = '';
    const queryParams = [];
    if (hierarchy && hierarchy.allowedList && hierarchy.allowedList.length > 0) {
      if (hierarchy.isManager) {
        hierarchyWhere = `WHERE (c.assigned_agent = ANY($1::text[]) OR c.assigned_agent ILIKE ANY($1::text[]) OR c.assigned_agent IS NULL OR TRIM(c.assigned_agent) = '' OR c.assigned_agent = 'Unassigned')`;
      } else {
        hierarchyWhere = `WHERE (c.assigned_agent = ANY($1::text[]) OR c.assigned_agent ILIKE ANY($1::text[]))`;
      }
      queryParams.push(hierarchy.allowedList);
    }

    const { rows: chats } = await connectDB.query(
      `SELECT 
         c.*,
         COALESCE(l.id::text, c.lead_id) AS lead_actual_id,
         COALESCE(l.phone, c.phone) AS lead_phone,
         l.name AS lead_actual_name,
         l.email AS lead_email,
         l.company AS lead_company,
         l.source AS lead_source,
         COALESCE(l.value, c.deal_value) AS lead_value,
         COALESCE(l.stage, c.stage) AS lead_stage,
         COALESCE(l.assigned, c.assigned_agent) AS lead_assigned,
         l.tags AS lead_tags,
         l.notes AS lead_notes
       FROM public.whatsapp_chats c
       ${hierarchyWhere}
       LEFT JOIN LATERAL (
         SELECT id, name, phone, email, company, source, value, stage, assigned, tags, notes
         FROM public.leads
         WHERE (c.lead_id IS NOT NULL AND c.lead_id != '' AND leads.id::text = c.lead_id)
            OR (
                 regexp_replace(c.phone, '[^0-9]', '', 'g') != ''
                 AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(leads.phone, '[^0-9]', '', 'g'), 10)
               )
            OR (LOWER(TRIM(c.contact_name)) = LOWER(TRIM(leads.name)))
         ORDER BY 
           CASE WHEN (c.lead_id IS NOT NULL AND c.lead_id != '' AND leads.id::text = c.lead_id) THEN 1
                WHEN (regexp_replace(c.phone, '[^0-9]', '', 'g') != '' AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(leads.phone, '[^0-9]', '', 'g'), 10)) THEN 2
                ELSE 3
           END
         LIMIT 1
       ) l ON true
       ORDER BY c.last_message_time DESC NULLS LAST, c.id DESC`,
      queryParams
    ).catch(async (err) => {
      console.warn("Lateral join error, falling back to simple query:", err.message);
      return await connectDB.query(
        `SELECT * FROM public.whatsapp_chats c ${hierarchyWhere} ORDER BY last_message_time DESC NULLS LAST`,
        queryParams
      );
    });

    if (chats.length === 0) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    const chatIds = chats.map((c) => c.id);
    const { rows: allMessages } = await connectDB.query(
      `SELECT * FROM public.whatsapp_messages WHERE chat_id = ANY($1::uuid[]) ORDER BY timestamp ASC`,
      [chatIds]
    ).catch(async () => {
      // Fallback if chat_id is text/varchar
      return await connectDB.query(
        `SELECT * FROM public.whatsapp_messages WHERE chat_id::text = ANY($1::text[]) ORDER BY timestamp ASC`,
        [chatIds.map(String)]
      );
    });

    const msgMap = new Map();
    allMessages.forEach((m) => {
      const key = String(m.chat_id);
      if (!msgMap.has(key)) msgMap.set(key, []);
      msgMap.get(key).push(m);
    });

    const data = chats.map((c) => toConversationDTO(c, msgMap.get(String(c.id)) || []));
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('getWhatsAppChats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getWhatsAppStats = async (req, res) => {
  try {
    const hierarchy = await getHierarchyAllowedAssignees(req.user);
    let hierarchyWhere = '';
    const statsParams = [];
    if (hierarchy && hierarchy.allowedList && hierarchy.allowedList.length > 0) {
      if (hierarchy.isManager) {
        hierarchyWhere = `WHERE (assigned_agent = ANY($1::text[]) OR assigned_agent ILIKE ANY($1::text[]) OR assigned_agent IS NULL OR TRIM(assigned_agent) = '' OR assigned_agent = 'Unassigned')`;
      } else {
        hierarchyWhere = `WHERE (assigned_agent = ANY($1::text[]) OR assigned_agent ILIKE ANY($1::text[]))`;
      }
      statsParams.push(hierarchy.allowedList);
    }

    const { rows } = await connectDB.query(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(unread_count), 0)::int AS unread,
        COUNT(*) FILTER (WHERE stage IN ('Closed Won', 'Resolved'))::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active
      FROM public.whatsapp_chats
      ${hierarchyWhere}
    `, statsParams);
    const s = rows[0] || { total: 0, unread: 0, resolved: 0, active: 0 };
    return res.status(200).json({
      success: true,
      data: {
        totalChats: s.total,
        unreadTotal: s.unread,
        resolvedChats: s.resolved,
        activeChats: s.active,
        responseRate: '98.5%',
        avgResponseTime: '2.4m',
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getMessagesByChatId = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { rows } = await connectDB.query(
      `SELECT * FROM public.whatsapp_messages WHERE chat_id::text = $1 ORDER BY timestamp ASC`,
      [chatId]
    );
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { chat_id, text, sender, media_url, media_type } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    let metaDelivery = null;

    const msgRes = await connectDB.query(
      `INSERT INTO public.whatsapp_messages (chat_id, text, sender, media_url, media_type, timestamp, read)
       VALUES ($1, $2, $3, $4, $5, NOW(), true) RETURNING *`,
      [chat_id, text.trim(), sender || 'me', media_url || null, media_type || null]
    );

    // Update last message in chat
    await connectDB.query(
      `UPDATE public.whatsapp_chats SET last_message = $1, last_message_time = NOW() WHERE id::text = $2`,
      [text.trim(), String(chat_id)]
    );

    // If outgoing message from agent, log to activities & lead_activities
    if (sender === 'me' || sender === 'agent' || sender === 'outgoing') {
      const chatRes = await connectDB.query(
        `SELECT c.contact_name, c.assigned_agent, c.lead_id, 
                COALESCE(NULLIF(c.phone, ''), l.phone, '') AS phone
         FROM public.whatsapp_chats c
         LEFT JOIN public.leads l ON (l.id::text = c.lead_id::text)
         WHERE c.id::text = $1`,
        [String(chat_id)]
      ).catch(() => ({ rows: [] }));

      const cName = chatRes.rows[0]?.contact_name || 'Contact';
      const aName = chatRes.rows[0]?.assigned_agent || req.user?.name || 'Agent';
      const leadId = chatRes.rows[0]?.lead_id;
      let phone = req.body.phone || chatRes.rows[0]?.phone;

      // Fallback: If phone is still empty, search lead by leadId
      if (!phone && leadId) {
        const leadRes = await connectDB.query(
          `SELECT phone FROM public.leads WHERE id::text = $1`,
          [String(leadId)]
        ).catch(() => ({ rows: [] }));
        phone = leadRes.rows[0]?.phone;
      }

      // Persist phone in whatsapp_chats if it was previously empty
      if (phone) {
        await connectDB.query(
          `UPDATE public.whatsapp_chats SET phone = $1 WHERE id::text = $2 AND (phone IS NULL OR phone = '')`,
          [phone, String(chat_id)]
        ).catch(() => {});
      }

      // Agent Takeover: Automatically pause WhatsApp bot for this lead
      if (leadId) {
        import('../bot/bot-engine.js').then((m) => {
          m.pauseBotForLead(leadId, `Agent takeover: manual message sent by ${aName}`);
        }).catch((e) => console.warn('[Bot Engine Pause Error]:', e.message));
      }

      // Direct Meta WhatsApp Cloud API dispatch if credentials present in .env
      const waToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
      const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;

      if (waToken && waPhoneId && phone) {
        try {
          let cleanDigits = phone.replace(/\D/g, '');
          if (cleanDigits.length === 10) {
            cleanDigits = '91' + cleanDigits;
          } else if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
            cleanDigits = '91' + cleanDigits.slice(1);
          } else if (cleanDigits.length > 10 && !cleanDigits.startsWith('91')) {
            cleanDigits = '91' + cleanDigits.slice(-10);
          }
          const waRecipient = cleanDigits;
          console.log(`[WhatsApp Meta API] Sending message to ${waRecipient} with Phone ID: ${waPhoneId}`);

          const isTemplate = Boolean(req.body.template_name) || text.trim().toLowerCase() === 'hello_world';
          const metaPayload = isTemplate
            ? {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: waRecipient,
                type: 'template',
                template: {
                  name: req.body.template_name || 'hello_world',
                  language: { code: 'en_US' }
                }
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
            body: JSON.stringify(metaPayload),
          });

          const metaData = await metaRes.json();

          // --- Save Meta wamid for delivery-status tracking ---
          if (metaRes.ok && metaData?.messages?.[0]?.id) {
            const wamid = metaData.messages[0].id;
            await connectDB.query(
              `UPDATE public.whatsapp_messages SET wamid = $1, status = 'sent' WHERE id = $2`,
              [wamid, msgRes.rows[0].id]
            ).catch((e) => console.error('[WA] wamid save failed:', e.message));
            console.log(`[WhatsApp Meta API] Sent OK, wamid: ${wamid}`);
          }

          if (!metaRes.ok) {
            console.warn('[WhatsApp Meta API Error]:', JSON.stringify(metaData, null, 2));
            const errCode = metaData?.error?.code;
            let friendlyError = metaData?.error?.message || 'Meta WhatsApp API error';

            // If 24h window closed (131047), attempt sending the pre-approved hello_world template
            if (errCode === 131047) {
              console.log(`[WhatsApp Meta API] 24h window closed. Attempting hello_world template fallback to ${waRecipient}...`);
              try {
                const tplRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${waToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: waRecipient,
                    type: 'template',
                    template: {
                      name: 'hello_world',
                      language: { code: 'en_US' }
                    }
                  }),
                });
                const tplData = await tplRes.json();
                if (tplRes.ok && tplData?.messages?.[0]?.id) {
                  const tplWamid = tplData.messages[0].id;
                  await connectDB.query(
                    `UPDATE public.whatsapp_messages SET wamid = $1, status = 'sent' WHERE id = $2`,
                    [tplWamid, msgRes.rows[0].id]
                  ).catch((e) => console.error('[WA] template wamid save failed:', e.message));
                  console.log(`[WhatsApp Meta API] Sent OK (template), wamid: ${tplWamid}`);
                }
                if (tplRes.ok) {
                  console.log('[WhatsApp Meta API] hello_world template delivered successfully:', tplData);
                  metaDelivery = {
                    success: true,
                    messageId: tplData?.messages?.[0]?.id,
                    templateSent: true,
                    note: 'Meta 24h window closed thi, isliye template (hello_world) bhej diya gaya hai taaki session open ho sake.',
                  };
                } else {
                  console.warn('[WhatsApp Meta API] Template attempt error:', tplData);
                }
              } catch (tplErr) {
                console.warn('[WhatsApp Meta API] Template dispatch failed:', tplErr.message);
              }
            }

            if (!metaDelivery?.success) {
              if (errCode === 131030) {
                friendlyError = 'Recipient number Meta Allowed List me nahi hai. Meta Developer Console me "Manage phone number list" me apna number verify karein.';
              } else if (errCode === 131047) {
                friendlyError = '24-hour conversation window closed. Apne WhatsApp se Test Number (+1 555 143 7329) par "Hi" bhejein.';
              } else if (errCode === 190) {
                friendlyError = 'Meta Access Token expire ho gaya hai. Meta Console se "Generate new token" karein aur backend/.env me update karein.';
              }

              metaDelivery = {
                success: false,
                code: errCode,
                error: friendlyError,
                details: metaData?.error,
              };
            }
          } else {
            console.log('[WhatsApp Meta API Success]:', JSON.stringify(metaData, null, 2));
            metaDelivery = {
              success: true,
              messageId: metaData?.messages?.[0]?.id,
            };
          }
        } catch (apiErr) {
          console.warn('[WhatsApp Meta API Exception]:', apiErr.message);
          metaDelivery = {
            success: false,
            error: apiErr.message,
          };
        }
      } else {
        metaDelivery = {
          success: false,
          error: !waToken || !waPhoneId 
            ? 'Meta WhatsApp credentials missing in backend/.env'
            : 'No phone number associated with this chat or lead',
        };
      }

      await logActivity({
        type: 'whatsapp',
        title: 'WhatsApp sent',
        description: text.trim(),
        userName: aName,
        action: 'sent WhatsApp to',
        leadName: cName,
        detail: text.trim().slice(0, 100),
      });

      if (leadId) {
        await connectDB.query(
          `INSERT INTO public.lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
          [leadId, 'WhatsApp', `WhatsApp message sent: "${text.trim().slice(0, 80)}"`, aName]
        ).catch(() => {});
      }
    }

    return res.status(201).json({ success: true, data: msgRes.rows[0], metaDelivery });
  } catch (err) {
    console.error('sendMessage error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createChat = async (req, res) => {
  try {
    const { contact_name, phone, avatar, assigned_agent, assigned_agent_id, stage, initial_message, lead_id, deal_value } = req.body;
    if (!contact_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Contact name is required' });
    }

    // Check if a chat already exists for this lead_id or matching phone
    let existingChat = null;
    if (lead_id) {
      const { rows } = await connectDB.query(
        `SELECT * FROM public.whatsapp_chats WHERE lead_id::text = $1 LIMIT 1`,
        [String(lead_id)]
      ).catch(() => ({ rows: [] }));
      if (rows.length > 0) existingChat = rows[0];
    }

    if (!existingChat && phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      if (cleanPhone) {
        const { rows } = await connectDB.query(
          `SELECT * FROM public.whatsapp_chats 
           WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1 
           LIMIT 1`,
          [cleanPhone]
        ).catch(() => ({ rows: [] }));
        if (rows.length > 0) existingChat = rows[0];
      }
    }

    if (existingChat) {
      // If lead_id was missing, update it
      if (lead_id && !existingChat.lead_id) {
        await connectDB.query(
          `UPDATE public.whatsapp_chats SET lead_id = $1 WHERE id = $2`,
          [String(lead_id), existingChat.id]
        ).catch(() => {});
        existingChat.lead_id = String(lead_id);
      }
      return res.status(200).json({ success: true, data: toConversationDTO(existingChat) });
    }

    const { rows } = await connectDB.query(
      `INSERT INTO public.whatsapp_chats (contact_name, phone, avatar, assigned_agent, assigned_agent_id, stage, lead_id, deal_value, last_message, last_message_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
      [
        contact_name.trim(),
        phone || '',
        avatar || null,
        assigned_agent || 'Rajesh Kumar',
        assigned_agent_id || null,
        stage || 'New Inquiry',
        lead_id ? String(lead_id) : null,
        deal_value || '₹0',
        initial_message || 'Chat started',
      ]
    );

    const newChat = rows[0];

    if (initial_message) {
      await connectDB.query(
        `INSERT INTO public.whatsapp_messages (chat_id, text, sender, timestamp, read)
         VALUES ($1, $2, 'incoming', NOW(), true)`,
        [newChat.id, initial_message]
      );
    }

    return res.status(201).json({ success: true, data: toConversationDTO(newChat) });
  } catch (err) {
    console.error('createChat error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const reassignChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { toAgent, fromAgent, reason } = req.body;
    if (!toAgent) {
      return res.status(400).json({ success: false, message: 'Target agent is required' });
    }

    const now = new Date();
    const timestamp = now.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const targetAgentName = typeof toAgent === 'object' ? toAgent.name : toAgent;

    const newHistoryEntry = {
      fromAgent: fromAgent || 'Unassigned',
      toAgent: targetAgentName,
      reason: reason || 'Reassignment',
      timestamp,
    };

    const { rows } = await connectDB.query(
      `UPDATE public.whatsapp_chats
       SET assigned_agent = $1,
           reassigned_from = $2,
           reassign_reason = $3,
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $4::jsonb
       WHERE id::text = $5
       RETURNING *`,
      [
        targetAgentName,
        fromAgent || null,
        reason || null,
        JSON.stringify([newHistoryEntry]),
        String(chatId),
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    const assignedChat = rows[0];

    // Synchronize lead assignment if linked
    if (assignedChat.lead_id) {
      await connectDB.query(
        `UPDATE public.leads SET assigned = $1 WHERE id::text = $2`,
        [targetAgentName, String(assignedChat.lead_id)]
      ).catch(() => {});

      await connectDB.query(
        `INSERT INTO public.lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
        [
          assignedChat.lead_id,
          'Assignment',
          `WhatsApp chat reassigned to ${targetAgentName}${reason ? ` (${reason})` : ''}`,
          fromAgent || 'System',
        ]
      ).catch(() => {});
    }

    // Log reassignment activity
    const initials = targetAgentName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 3);
    const chatContact = assignedChat.contact_name || 'Contact';

    await connectDB.query(
      `INSERT INTO public.activities (type, title, description, user_name, user_initials, action, lead_name, detail, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        'assignment',
        'WhatsApp chat reassigned',
        `Reassigned chat from ${fromAgent || 'previous agent'} to ${targetAgentName}`,
        targetAgentName,
        initials,
        'reassigned WhatsApp chat of',
        chatContact,
        `From ${fromAgent || 'previous agent'} to ${targetAgentName}${reason ? ` • ${reason}` : ''}`,
      ]
    ).catch(() => {});

    return res.status(200).json({ success: true, data: assignedChat });
  } catch (err) {
    console.error('reassignChat error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getWhatsAppAgents = async (req, res) => {
  try {
    const { rows: users } = await connectDB.query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role,
        COALESCE(u.avatar, '') as avatar,
        COUNT(c.id)::int AS chat_count
      FROM public.users u
      LEFT JOIN public.whatsapp_chats c ON (
        LOWER(c.assigned_agent) = LOWER(u.name) 
        OR LOWER(c.assigned_agent) = LOWER(u.email)
      )
      WHERE u.is_active IS NOT FALSE
      GROUP BY u.id, u.name, u.email, u.role, u.avatar
      ORDER BY u.name ASC
    `);

    const data = users.map((u) => {
      const name = u.name || u.email || 'Agent';
      return {
        id: String(u.id),
        name,
        email: u.email,
        role: u.role || 'Sales Agent',
        avatar: u.avatar || '',
        initials: name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2),
        openChats: Number(u.chat_count) || 0,
        active: true,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('getWhatsAppAgents error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const bulkReassignChats = async (req, res) => {
  try {
    const { fromAgent, toAgent, transferMode, reason } = req.body;
    if (!fromAgent || !toAgent) {
      return res.status(400).json({ success: false, message: 'fromAgent and toAgent are required' });
    }

    const toAgentName = typeof toAgent === 'object' ? toAgent.name : toAgent;
    const fromAgentName = typeof fromAgent === 'object' ? fromAgent.name : fromAgent;
    const now = new Date();
    const timestamp = now.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const historyEntry = {
      fromAgent: fromAgentName,
      toAgent: toAgentName,
      reason: reason || 'Bulk reassignment',
      timestamp,
    };

    let stageFilter = '';
    if (transferMode === 'open') {
      stageFilter = `AND stage NOT IN ('Closed Won', 'Lost')`;
    } else if (transferMode === 'unresolved') {
      stageFilter = `AND stage IN ('New Inquiry', 'Contacted', 'Site Visit Scheduled', 'Negotiation')`;
    }

    const isFromUnassigned = fromAgentName.toLowerCase() === 'unassigned' || !fromAgentName.trim();
    const fromCondition = isFromUnassigned
      ? `(assigned_agent IS NULL OR TRIM(assigned_agent) = '' OR LOWER(assigned_agent) = 'unassigned')`
      : `(assigned_agent = $5 OR LOWER(assigned_agent) = LOWER($5))`;

    const { rows: updatedRows } = await connectDB.query(
      `UPDATE public.whatsapp_chats
       SET assigned_agent = $1,
           reassigned_from = $2,
           reassign_reason = $3,
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $4::jsonb
       WHERE ${fromCondition} ${stageFilter}
       RETURNING id, lead_id, contact_name`,
      [toAgentName, fromAgentName, reason || 'Bulk reassignment', JSON.stringify([historyEntry]), fromAgentName]
    );

    const rowCount = updatedRows.length;

    // Synchronize linked leads in public.leads
    if (rowCount > 0) {
      const leadIds = updatedRows.map((r) => r.lead_id).filter(Boolean);
      if (leadIds.length > 0) {
        await connectDB.query(
          `UPDATE public.leads
           SET assigned = $1
           WHERE id::text = ANY($2::text[])`,
          [toAgentName, leadIds]
        ).catch(() => {});
      }
    }

    // Log activity
    await logActivity({
      type: 'assignment',
      title: 'Bulk WhatsApp chats reassigned',
      description: `Reassigned ${rowCount} chats from ${fromAgentName} to ${toAgentName}`,
      userName: toAgentName,
      action: 'bulk reassigned chats to',
      leadName: `${rowCount} conversations`,
      detail: reason || 'Bulk reassignment',
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `${rowCount} chats reassigned successfully to ${toAgentName}`,
      count: rowCount,
    });
  } catch (err) {
    console.error('bulkReassignChats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const bulkAssignChats = async (req, res) => {
  try {
    const { chatIds, toAgent, reason } = req.body;
    if (!Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ success: false, message: 'chatIds array is required' });
    }
    if (!toAgent) {
      return res.status(400).json({ success: false, message: 'Target agent is required' });
    }

    const toAgentName = typeof toAgent === 'object' ? toAgent.name : toAgent;
    const now = new Date();
    const timestamp = now.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const historyEntry = {
      fromAgent: 'Unassigned',
      toAgent: toAgentName,
      reason: reason || 'Assigned from Manage Conversations',
      timestamp,
    };

    const { rows: updatedRows } = await connectDB.query(
      `UPDATE public.whatsapp_chats
       SET assigned_agent = $1,
           reassigned_from = 'Unassigned',
           reassign_reason = $2,
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $3::jsonb
       WHERE id::text = ANY($4::text[])
       RETURNING id, lead_id, contact_name`,
      [toAgentName, reason || 'Bulk assignment', JSON.stringify([historyEntry]), chatIds.map(String)]
    );

    const leadIds = updatedRows.map((r) => r.lead_id).filter(Boolean);
    if (leadIds.length > 0) {
      await connectDB.query(
        `UPDATE public.leads
         SET assigned = $1
         WHERE id::text = ANY($2::text[])`,
        [toAgentName, leadIds]
      ).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: `${updatedRows.length} chats assigned to ${toAgentName}`,
      count: updatedRows.length,
    });
  } catch (err) {
    console.error('bulkAssignChats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateChatStage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { stage, unread_count } = req.body;

    const sets = [];
    const values = [];
    let idx = 1;

    if (stage !== undefined) {
      sets.push(`stage = $${idx}`);
      values.push(stage);
      idx++;
    }
    if (unread_count !== undefined) {
      sets.push(`unread_count = $${idx}`);
      values.push(unread_count);
      idx++;
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(String(chatId));
    const { rows } = await connectDB.query(
      `UPDATE public.whatsapp_chats SET ${sets.join(', ')} WHERE id::text = $${idx} RETURNING *`,
      values
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getTemplates = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.whatsapp_templates ORDER BY id ASC`);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuickReplies = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.whatsapp_quick_replies ORDER BY id ASC`);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const debugMeta = async (req, res) => {
  try {
    const waToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
    const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;

    if (!waToken || !waPhoneId) {
      return res.status(200).json({ configured: false, message: 'Missing token or phoneId in backend/.env' });
    }

    const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`, {
      headers: { 'Authorization': `Bearer ${waToken}` }
    });
    const phoneData = await phoneRes.json();
    console.log('[Meta Debug Query]:', phoneData);

    return res.status(200).json({
      configured: true,
      configuredPhoneId: waPhoneId,
      phoneData,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- Meta WhatsApp Webhook Handlers ---

export const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'crm_whatsapp_secret_token';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp Webhook] Challenge verified successfully!');
    return res.status(200).send(challenge);
  } else {
    console.warn('[WhatsApp Webhook] Verification failed. Mode or Token mismatch.');
    return res.sendStatus(403);
  }
};

export const handleWebhook = async (req, res) => {
  try {
    const body = req.body;

    // Immediately acknowledge Meta with 200 OK to prevent retries
    res.status(200).send('EVENT_RECEIVED');

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;

          // --- Delivery status updates (sent / delivered / read / failed) ---
          if (value && Array.isArray(value.statuses) && value.statuses.length > 0) {
            for (const st of value.statuses) {
              try {
                const upd = await connectDB.query(
                  `UPDATE public.whatsapp_messages
                   SET status = $1, read = CASE WHEN $1 = 'read' THEN true ELSE read END
                   WHERE wamid = $2
                   RETURNING id, chat_id`,
                  [st.status, st.id]
                );

                if (upd.rows.length > 0) {
                  console.log(`[WA Status] ${st.id} -> ${st.status} (${st.recipient_id})`);
                } else {
                  console.warn(`[WA Status] wamid not found in DB: ${st.id} (${st.status})`);
                }

                if (st.status === 'failed') {
                  console.error(
                    `[WA Status] FAILED ${st.id}:`,
                    JSON.stringify(st.errors || [], null, 2)
                  );
                }
              } catch (e) {
                console.error('[WA Status] update error:', e.message);
              }
            }
            continue; // status payload mein messages nahi hote
          }

          if (value && value.messages && value.messages.length > 0) {
            for (const msg of value.messages) {
              const from = msg.from; // e.g. "919131734930"
              const msgId = msg.id;

              let text = '';
              let mediaUrl = null;
              let mediaType = null;

              if (msg.type === 'text') {
                text = msg.text?.body || '';
              } else if (msg.type === 'image') {
                text = msg.image?.caption || 'Image received';
                mediaType = 'image';
              } else if (msg.type === 'document') {
                text = msg.document?.caption || msg.document?.filename || 'Document received';
                mediaType = 'document';
              } else if (msg.type === 'button') {
                text = msg.button?.text || '';
              } else if (msg.type === 'interactive') {
                text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
              } else {
                text = `[${msg.type || 'message'}]`;
              }

              if (!text) continue;

              const cleanDigits = from.replace(/\D/g, '');
              const last10 = cleanDigits.slice(-10);

              // 1. Look up chat in whatsapp_chats
              let chatRes = await connectDB.query(
                `SELECT id, lead_id, contact_name, phone FROM public.whatsapp_chats 
                 WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
                 ORDER BY id DESC LIMIT 1`,
                [last10]
              ).catch(() => ({ rows: [] }));

              let chatId = chatRes.rows[0]?.id;
              let contactName = chatRes.rows[0]?.contact_name;
              let leadId = chatRes.rows[0]?.lead_id;

              // 2. If not found in chats, look up lead in public.leads
              if (!chatId) {
                const leadRes = await connectDB.query(
                  `SELECT id, name, phone, stage, value, assigned FROM public.leads 
                   WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
                   LIMIT 1`,
                  [last10]
                ).catch(() => ({ rows: [] }));

                if (leadRes.rows.length > 0) {
                  const lead = leadRes.rows[0];
                  leadId = lead.id;
                  contactName = lead.name;

                  const newChat = await connectDB.query(
                    `INSERT INTO public.whatsapp_chats 
                     (contact_name, phone, stage, deal_value, assigned_agent, lead_id, last_message, last_message_time, unread_count)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 1) RETURNING id`,
                    [lead.name, from, lead.stage || 'New Inquiry', lead.value || '₹0', lead.assigned || 'Rajesh Kumar', String(lead.id), text]
                  );
                  chatId = newChat.rows[0]?.id;
                } else {
                  const profileName = value.contacts?.[0]?.profile?.name || `+${from}`;
                  contactName = profileName;
                  const newChat = await connectDB.query(
                    `INSERT INTO public.whatsapp_chats 
                     (contact_name, phone, stage, deal_value, assigned_agent, last_message, last_message_time, unread_count)
                     VALUES ($1, $2, 'New Inquiry', '₹0', 'Unassigned', $3, NOW(), 1) RETURNING id`,
                    [profileName, from, text]
                  );
                  chatId = newChat.rows[0]?.id;
                }
              }

              if (chatId) {
                // Insert message with sender = 'incoming'
                await connectDB.query(
                  `INSERT INTO public.whatsapp_messages (chat_id, text, sender, timestamp, read, media_url, media_type, wamid)
                   VALUES ($1, $2, 'incoming', NOW(), false, $3, $4, $5)`,
                  [chatId, text, mediaUrl, mediaType, msgId]
                );

                // Update chat with last message and unread count
                await connectDB.query(
                  `UPDATE public.whatsapp_chats 
                   SET last_message = $1, last_message_time = NOW(), unread_count = COALESCE(unread_count, 0) + 1 
                   WHERE id::text = $2`,
                  [text, String(chatId)]
                );

                console.log(`[WhatsApp Webhook] Incoming message saved for chat ${chatId} (${contactName}): "${text}"`);

                // Log lead activity
                if (leadId) {
                  await connectDB.query(
                    `INSERT INTO public.lead_activities (lead_id, type, description, performed_by) 
                     VALUES ($1, 'WhatsApp', $2, $3)`,
                    [leadId, `WhatsApp message received: "${text.slice(0, 80)}"`, contactName || 'Customer']
                  ).catch(() => {});
                }

                // Trigger WhatsApp AI Bot Engine processing
                import('../bot/bot-engine.js').then((m) => {
                  m.processInboundWhatsAppMessage({ from, text, msgId, mediaUrl, mediaType });
                }).catch((e) => console.error('[Bot Engine Inbound Hook Error]:', e.message));

                // Trigger Workflow Engine inbound reply / stop rules hook
                if (leadId) {
                  connectDB.query(`SELECT company_id FROM public.leads WHERE id = $1`, [leadId])
                    .then((cRes) => {
                      const compId = cRes.rows[0]?.company_id;
                      if (compId) {
                        import('../workflows/workflow-events.js').then((w) => {
                          w.emitInboundMessage(from, text, compId);
                        }).catch((e) => console.error('[Workflow Inbound Hook Error]:', e.message));
                      }
                    }).catch(() => {});
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp Webhook Processing Error]:', err.message);
  }
};
