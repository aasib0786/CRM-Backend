import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';
import { determineLeadAssignee } from '../leads/assignmentService.js';

// In-memory sliding-window IP rate limiter: max 20 requests per minute per IP
const ipRequestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

const isRateLimited = (ip) => {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
    ipRequestCounts.set(ip, { startTime: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
};

// Clean up stale rate-limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequestCounts.entries()) {
    if (now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
      ipRequestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

export const receiveFormLead = async (req, res) => {
  try {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    // 1. Rate Limiting
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    }

    const { key } = req.params;
    if (!key) {
      return res.status(400).json({ success: false, message: 'Webhook key required' });
    }

    // 2. Honeypot check (hidden "website" field for bots)
    const b = req.body || {};
    if (b.website && String(b.website).trim() !== '') {
      // Silently accept bot submission without creating lead
      return res.status(200).json({ success: true, message: 'Form submitted successfully' });
    }

    // 3. Find active account by webhook_key
    const { rows: accRows } = await connectDB.query(
      `SELECT * FROM public.integration_accounts
       WHERE webhook_key = $1 AND provider = 'website_forms' AND status = 'active'`,
      [key]
    );

    const acc = accRows[0];
    if (!acc) {
      return res.status(404).json({ success: false, message: 'Invalid or inactive webhook' });
    }

    // 4. Parse incoming fields
    const name = (
      b.name ||
      b.full_name ||
      [b.first_name, b.last_name].filter(Boolean).join(' ') ||
      'Website Lead'
    ).trim();

    const phone = (b.phone || b.mobile || b.contact || '').trim();
    const email = (b.email || '').trim().toLowerCase();
    const message = (b.message || b.notes || b.comments || b.query || b.requirement || '').trim();
    const company = (b.company || b.company_name || b.organization || acc.account_name || '').trim();

    // Assemble rich notes if extra fields like service, budget, timeline are provided
    const noteItems = [];
    if (message) noteItems.push(message);
    if (b.service) noteItems.push(`Service: ${b.service}`);
    if (b.budget) noteItems.push(`Budget: ${b.budget}`);
    if (b.timeline) noteItems.push(`Timeline: ${b.timeline}`);
    const fullNotes = noteItems.join('\n') || null;

    if (!phone && !email) {
      return res.status(400).json({ success: false, message: 'Phone or email required' });
    }

    // 5. Duplicate Check (within 10 minutes from same contact and account)
    let duplicateLead = null;
    if (phone || email) {
      const dupQuery = `
        SELECT id, name FROM public.leads
        WHERE ((phone = $1 AND phone != '') OR (email = $2 AND email != ''))
          AND (meta->>'integration_account_id' = $3 OR company_id = $4)
          AND created_at >= NOW() - INTERVAL '10 minutes'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const { rows: dupRows } = await connectDB.query(dupQuery, [phone, email, String(acc.id), acc.company_id || '']);
      if (dupRows.length > 0) {
        duplicateLead = dupRows[0];
      }
    }

    if (duplicateLead) {
      // Update existing lead with company or richer notes if provided
      await connectDB.query(
        `UPDATE public.leads
         SET company = COALESCE(NULLIF($1, ''), company),
             notes = COALESCE(NULLIF($2, ''), notes),
             updated_at = NOW(),
             last_activity = NOW()
         WHERE id = $3`,
        [company, fullNotes, duplicateLead.id]
      );

      // Record as activity rather than creating a duplicate lead
      await connectDB.query(
        `INSERT INTO public.lead_activities (lead_id, type, description, performed_by)
         VALUES ($1, 'Website Form', $2, 'Website Form')`,
        [duplicateLead.id, `Website Form Update: ${fullNotes || 'Repeat form submission'}`]
      );

      await connectDB.query(
        `UPDATE public.integration_accounts SET last_received_at = NOW() WHERE id = $1`,
        [acc.id]
      );

      return res.status(200).json({
        success: true,
        duplicate: true,
        lead_id: duplicateLead.id,
        message: 'Submission logged to existing lead',
      });
    }

    // 6. Insert new lead into leads table
    const metaData = {
      integration_account_id: acc.id,
      account_name: acc.account_name,
      page: req.get('referer') || null,
      ip: clientIp,
      raw: b,
    };

    // Auto-assign lead according to active assignment rules
    const assignmentResult = await determineLeadAssignee({
      name,
      company,
      source: 'Website Form',
      priority: 'High',
    }).catch(() => null);
    const assignedAgent = assignmentResult?.assigned || null;

    const { rows: newLeadRows } = await connectDB.query(
      `INSERT INTO public.leads (
         company_id, name, company, phone, email, source, stage, priority, assigned, notes, meta, score, last_activity, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'Website Form', 'New Inquiry', 'High', $6, $7, $8, 75, NOW(), NOW(), NOW())
       RETURNING *`,
      [acc.company_id || null, name, company, phone, email, assignedAgent, fullNotes, JSON.stringify(metaData)]
    );

    const lead = newLeadRows[0];

    // 7. Update integration_accounts last_received_at
    await connectDB.query(
      `UPDATE public.integration_accounts SET last_received_at = NOW() WHERE id = $1`,
      [acc.id]
    );

    // 8. Log activity & trigger in-app notification
    await logActivity({
      type: 'lead_created',
      title: 'Website Lead Captured',
      description: `${name} submitted form on ${acc.account_name}`,
      userName: 'Website Form',
      leadName: name,
      leadId: lead.id,
      detail: message || `Form submitted via ${acc.account_name}`,
    }).catch(() => {});

    await connectDB.query(
      `INSERT INTO public.notifications (type, title, description, lead_id, lead_name, read, scheduled_at, created_at)
       VALUES ('lead', $1, $2, $3, $4, false, NOW(), NOW())`,
      [
        `New Website Lead: ${name}`,
        `${phone ? phone + ' • ' : ''}${email ? email + ' • ' : ''}${acc.account_name}`,
        lead.id,
        name,
      ]
    ).catch(() => {});

    // Trigger WhatsApp AI Sales Bot Greeting if source is bot-enabled
    import('../bot/bot-engine.js').then((m) => {
      m.handleLeadCreated(lead.id, acc.company_id);
    }).catch((e) => console.error('[Bot Webhook Trigger Error]:', e.message));

    // Trigger Workflows event bus (lead_created)
    import('../workflows/workflow-events.js').then((w) => {
      w.emitLeadCreated(lead, acc.company_id);
    }).catch((e) => console.error('[Workflow Webhook Trigger Error]:', e.message));

    return res.status(201).json({
      success: true,
      message: 'Lead captured successfully',
      lead_id: lead.id,
    });
  } catch (err) {
    console.error('receiveFormLead error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process webhook' });
  }
};
