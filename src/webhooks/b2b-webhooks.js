import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';
import { determineLeadAssignee } from '../leads/assignmentService.js';

// Provider display names
const PROVIDER_NAMES = {
  indiamart: 'IndiaMart',
  justdial: 'JustDial',
  tradeindia: 'TradeIndia',
  social: 'Social Media',
  facebook: 'Social Media',
  instagram: 'Social Media',
  whatsapp: 'WhatsApp',
};

// Provider default lead scores
const PROVIDER_SCORES = {
  indiamart: 85,
  justdial: 80,
  tradeindia: 78,
  social: 70,
  whatsapp: 88,
  website_forms: 75,
};

export const receiveB2BLead = async (req, res) => {
  try {
    const providerParam = (req.params.provider || req.query.provider || 'b2b').toLowerCase();
    const key = req.params.key || req.query.key || null;
    const body = req.body || {};

    // Source display name
    const sourceName = PROVIDER_NAMES[providerParam] || 'B2B Portal';
    const defaultScore = PROVIDER_SCORES[providerParam] || 75;

    // Normalizing fields from various Indian B2B portals (IndiaMart, JustDial, TradeIndia, Facebook)
    const name = (
      body.SENDER_NAME ||
      body.sender_name ||
      body.caller_name ||
      body.buyer_name ||
      body.full_name ||
      body.name ||
      body.contact_name ||
      `${body.first_name || ''} ${body.last_name || ''}`.trim() ||
      `${sourceName} Lead`
    ).trim();

    const phone = (
      body.SENDER_MOBILE ||
      body.sender_mobile ||
      body.mobile ||
      body.phone ||
      body.contact ||
      body.mobile_number ||
      body.phone_number ||
      ''
    ).toString().replace(/[^\d+]/g, '').trim();

    const email = (
      body.SENDER_EMAIL ||
      body.sender_email ||
      body.email ||
      body.buyer_email ||
      ''
    ).toString().trim().toLowerCase();

    const company = (
      body.SENDER_COMPANY ||
      body.sender_company ||
      body.company ||
      body.company_name ||
      body.organization ||
      ''
    ).toString().trim();

    const city = (
      body.SENDER_CITY ||
      body.sender_city ||
      body.city ||
      body.location ||
      ''
    ).toString().trim();

    const product = (
      body.QUERY_PRODUCT_NAME ||
      body.query_product_name ||
      body.product ||
      body.product_name ||
      body.category ||
      ''
    ).toString().trim();

    const message = (
      body.QUERY_MESSAGE ||
      body.query_message ||
      body.requirement ||
      body.message ||
      body.query ||
      body.notes ||
      body.comments ||
      ''
    ).toString().trim();

    if (!phone && !email) {
      return res.status(400).json({
        success: false,
        message: 'Phone or email required for lead creation',
      });
    }

    // Assemble rich notes
    const noteLines = [];
    if (message) noteLines.push(`Inquiry: ${message}`);
    if (product) noteLines.push(`Product: ${product}`);
    if (city) noteLines.push(`City: ${city}`);
    const fullNotes = noteLines.join('\n') || null;

    // 10-Minute duplicate check
    let duplicateLead = null;
    const dupQuery = `
      SELECT id, name FROM public.leads
      WHERE ((phone = $1 AND phone != '') OR (email = $2 AND email != ''))
        AND created_at >= NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows: dupRows } = await connectDB.query(dupQuery, [phone, email]);
    if (dupRows.length > 0) {
      duplicateLead = dupRows[0];
    }

    if (duplicateLead) {
      // Update existing lead with latest details
      await connectDB.query(
        `UPDATE public.leads
         SET company = COALESCE(NULLIF($1, ''), company),
             notes = COALESCE(NULLIF($2, ''), notes),
             updated_at = NOW(),
             last_activity = NOW()
         WHERE id = $3`,
        [company, fullNotes, duplicateLead.id]
      );

      await connectDB.query(
        `INSERT INTO public.lead_activities (lead_id, type, description, performed_by)
         VALUES ($1, $2, $3, $2)`,
        [duplicateLead.id, sourceName, `Update received from ${sourceName}: ${fullNotes || 'Repeat submission'}`]
      );

      return res.status(200).json({
        success: true,
        duplicate: true,
        lead_id: duplicateLead.id,
        message: `Submission logged to existing lead from ${sourceName}`,
      });
    }

    // Insert new lead into public.leads
    const metaData = {
      provider: providerParam,
      source_name: sourceName,
      key,
      city,
      product,
      raw: body,
      received_at: new Date().toISOString(),
    };

    // Auto-assign lead according to active assignment rules
    const assignmentResult = await determineLeadAssignee({
      name,
      company: company || `${sourceName} Lead`,
      source: sourceName,
      priority: 'High',
    }).catch(() => null);
    const assignedAgent = assignmentResult?.assigned || null;

    const { rows: newLeadRows } = await connectDB.query(
      `INSERT INTO public.leads (
         name, company, phone, email, source, stage, priority, assigned, notes, meta, score, last_activity, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'New Inquiry', 'High', $6, $7, $8, $9, NOW(), NOW(), NOW())
       RETURNING *`,
      [name, company || `${sourceName} Lead`, phone, email, sourceName, assignedAgent, fullNotes, JSON.stringify(metaData), defaultScore]
    );

    const lead = newLeadRows[0];

    // Log Activity
    await logActivity({
      type: 'lead_created',
      title: `${sourceName} Lead Captured`,
      description: `${name} (${company || 'New Lead'}) received via ${sourceName}`,
      userName: sourceName,
      leadName: name,
      leadId: lead.id,
      detail: fullNotes || `Lead captured from ${sourceName}`,
    }).catch(() => {});

    // Notification bell alert
    await connectDB.query(
      `INSERT INTO public.notifications (type, title, description, lead_id, lead_name, read, scheduled_at, created_at)
       VALUES ('lead', $1, $2, $3, $4, false, NOW(), NOW())`,
      [
        `New ${sourceName} Lead: ${name}`,
        `${phone ? phone + ' • ' : ''}${city ? city + ' • ' : ''}${sourceName}`,
        lead.id,
        name,
      ]
    ).catch(() => {});

    // Trigger WhatsApp AI Sales Bot Greeting if source is bot-enabled
    import('../bot/bot-engine.js').then((m) => {
      m.handleLeadCreated(lead.id, lead.company_id);
    }).catch((e) => console.error('[Bot B2B Webhook Trigger Error]:', e.message));

    // Trigger Workflows event bus (lead_created)
    import('../workflows/workflow-events.js').then((w) => {
      w.emitLeadCreated(lead, lead.company_id);
    }).catch((e) => console.error('[Workflow B2B Webhook Trigger Error]:', e.message));

    return res.status(201).json({
      success: true,
      message: `${sourceName} lead captured successfully`,
      lead_id: lead.id,
      data: lead,
    });
  } catch (err) {
    console.error('receiveB2BLead error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process webhook' });
  }
};
