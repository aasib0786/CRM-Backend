import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';
import { getEmailTransporter, generateQuotationEmailHtml } from './quotationEmailService.js';

// ─── Helpers ──────────────────────────────────────────────────

const toQuotationDTO = (row) => {
  if (!row) return null;
  let items = [];
  if (Array.isArray(row.items)) {
    items = row.items;
  } else if (typeof row.items === 'string') {
    try { items = JSON.parse(row.items); } catch (e) { items = []; }
  }

  const formatDateStr = (d) => {
    if (!d) return '';
    if (typeof d === 'string') return d.split('T')[0];
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d);
  };

  const dateStr = formatDateStr(row.quote_date || row.created_at) || new Date().toISOString().split('T')[0];
  const validUntilStr = formatDateStr(row.valid_until) || '';

  const discountNum = Number(row.discount) || 0;
  const taxNum = Number(row.tax) || 0;
  const totalAmountNum = Number(row.total_amount) || 0;

  return {
    id: row.id,
    quoteNo: row.quote_number || `QT-${row.id}`,
    quote_number: row.quote_number || `QT-${row.id}`,
    leadId: row.lead_id || null,
    lead_id: row.lead_id || null,
    leadName: row.client_name || '',
    client_name: row.client_name || '',
    leadCompany: row.client_company || '',
    client_company: row.client_company || '',
    leadEmail: row.client_email || '',
    client_email: row.client_email || '',
    leadPhone: row.client_phone || '',
    client_phone: row.client_phone || '',
    agent: row.agent || 'Unassigned',
    date: dateStr,
    quote_date: dateStr,
    validUntil: validUntilStr,
    valid_until: validUntilStr,
    status: row.status || 'Draft',
    items,
    terms: row.terms || '',
    discount: discountNum,
    tax: taxNum,
    total_amount: totalAmountNum,
    total: totalAmountNum,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
};

const toTemplateDTO = (row) => {
  if (!row) return null;
  let items = [];
  if (Array.isArray(row.items)) {
    items = row.items;
  } else if (typeof row.items === 'string') {
    try { items = JSON.parse(row.items); } catch (e) { items = []; }
  }

  const formatDateStr = (d) => {
    if (!d) return '';
    if (typeof d === 'string') return d.split('T')[0];
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d);
  };

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdBy: row.created_by || 'Admin',
    created_by: row.created_by || 'Admin',
    createdAt: formatDateStr(row.created_at),
    created_at: row.created_at,
    updatedAt: formatDateStr(row.updated_at),
    updated_at: row.updated_at,
    itemCount: row.item_count || items.length,
    items,
  };
};

// ─── Quotation Endpoints ─────────────────────────────────────

export const getQuotations = async (req, res) => {
  try {
    const { leadId, lead_id, search, status, agent, dateFilter } = req.query;
    const targetLeadId = leadId || lead_id;

    let query = `SELECT * FROM public.quotations WHERE 1=1`;
    const params = [];
    let idx = 1;

    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    if (companyId) {
      query += ` AND company_id::text = $${idx}`;
      params.push(String(companyId));
      idx++;
    } else {
      query += ` AND 1=0`;
    }

    if (targetLeadId) {
      query += ` AND lead_id = $${idx}`;
      params.push(targetLeadId);
      idx++;
    }

    if (status && status !== 'All') {
      query += ` AND status = $${idx}`;
      params.push(status);
      idx++;
    }

    if (agent) {
      query += ` AND agent = $${idx}`;
      params.push(agent);
      idx++;
    }

    if (search) {
      query += ` AND (quote_number ILIKE $${idx} OR client_name ILIKE $${idx} OR client_company ILIKE $${idx} OR agent ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    if (dateFilter) {
      if (dateFilter === 'Today') {
        query += ` AND (quote_date = CURRENT_DATE OR (quote_date IS NULL AND created_at::date = CURRENT_DATE))`;
      } else if (dateFilter === 'This Week') {
        query += ` AND (quote_date >= CURRENT_DATE - INTERVAL '7 days' OR (quote_date IS NULL AND created_at >= CURRENT_DATE - INTERVAL '7 days'))`;
      } else if (dateFilter === 'This Month') {
        query += ` AND (quote_date >= CURRENT_DATE - INTERVAL '30 days' OR (quote_date IS NULL AND created_at >= CURRENT_DATE - INTERVAL '30 days'))`;
      }
    }

    query += ` ORDER BY created_at DESC`;
    const { rows } = await connectDB.query(query, params);
    const data = rows.map(toQuotationDTO);

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuotationStats = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    let query = `SELECT * FROM public.quotations`;
    const params = [];
    if (companyId) {
      query += ` WHERE company_id::text = $1`;
      params.push(String(companyId));
    } else {
      query += ` WHERE 1=0`;
    }
    const { rows } = await connectDB.query(query, params);
    const total = rows.length;
    const pending = rows.filter(r => r.status === 'Draft' || r.status === 'Sent').length;
    const accepted = rows.filter(r => r.status === 'Accepted').length;
    const rejected = rows.filter(r => r.status === 'Rejected').length;
    const expired = rows.filter(r => r.status === 'Expired').length;
    const totalValue = rows.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        total,
        pending,
        accepted,
        rejected,
        expired,
        totalValue
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuotationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await connectDB.query(
      `SELECT * FROM public.quotations WHERE id::text = $1 OR quote_number = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Quotation not found' });
    return res.status(200).json({ success: true, data: toQuotationDTO(rows[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createQuotation = async (req, res) => {
  try {
    const {
      quote_number,
      quoteNo,
      lead_id,
      leadId,
      client_name,
      leadName,
      client_company,
      leadCompany,
      client_email,
      leadEmail,
      client_phone,
      leadPhone,
      agent,
      quote_date,
      date,
      total_amount,
      discount,
      tax,
      status,
      valid_until,
      validUntil,
      items,
      terms
    } = req.body;

    const countRes = await connectDB.query(`SELECT COUNT(*)::int AS count FROM public.quotations`);
    const count = countRes.rows[0]?.count || 0;
    const qNum = quote_number || quoteNo || `QT-${String(count + 1).padStart(3, '0')}`;
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.body?.company_id || null;

    const { rows } = await connectDB.query(
      `INSERT INTO public.quotations (
        quote_number, lead_id, client_name, client_company, client_email, client_phone,
        agent, quote_date, total_amount, discount, tax, status, valid_until, items, terms, company_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
      RETURNING *`,
      [
        qNum,
        lead_id || leadId || null,
        client_name || leadName || 'Unnamed Client',
        client_company || leadCompany || '',
        client_email || leadEmail || null,
        client_phone || leadPhone || null,
        agent || 'Unassigned',
        quote_date || date || new Date().toISOString().split('T')[0],
        total_amount || 0,
        discount || 0,
        tax || 0,
        status || 'Draft',
        valid_until || validUntil || null,
        JSON.stringify(items || []),
        terms || '',
        companyId ? String(companyId) : null,
      ]
    );

    const createdQuotation = rows[0];
    const qAgent = agent || req.user?.name || 'Admin';
    const qDetail = `${qNum} • ₹${Number(total_amount || 0).toLocaleString('en-IN')}`;

    await logActivity({
      type: 'quotation',
      title: 'Quotation created',
      description: qDetail,
      userName: qAgent,
      action: 'created quotation',
      leadName: client_name || leadName || 'Client',
      leadId: lead_id || leadId ? String(lead_id || leadId) : null,
      detail: qDetail,
    });

    return res.status(201).json({ success: true, data: toQuotationDTO(createdQuotation) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      client_name,
      leadName,
      client_company,
      leadCompany,
      client_email,
      leadEmail,
      client_phone,
      leadPhone,
      agent,
      quote_date,
      date,
      total_amount,
      discount,
      tax,
      status,
      valid_until,
      validUntil,
      items,
      terms
    } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.quotations SET
        client_name = COALESCE($1, client_name),
        client_company = COALESCE($2, client_company),
        client_email = COALESCE($3, client_email),
        client_phone = COALESCE($4, client_phone),
        agent = COALESCE($5, agent),
        quote_date = COALESCE($6, quote_date),
        total_amount = COALESCE($7, total_amount),
        discount = COALESCE($8, discount),
        tax = COALESCE($9, tax),
        status = COALESCE($10, status),
        valid_until = COALESCE($11, valid_until),
        items = COALESCE($12, items),
        terms = COALESCE($13, terms),
        updated_at = NOW()
       WHERE id::text = $14 OR quote_number = $14 RETURNING *`,
      [
        client_name || leadName || null,
        client_company || leadCompany || null,
        client_email || leadEmail || null,
        client_phone || leadPhone || null,
        agent || null,
        quote_date || date || null,
        total_amount !== undefined ? total_amount : null,
        discount !== undefined ? discount : null,
        tax !== undefined ? tax : null,
        status || null,
        valid_until || validUntil || null,
        items ? JSON.stringify(items) : null,
        terms !== undefined ? terms : null,
        id
      ]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const updatedQ = rows[0];

    await logActivity({
      type: 'quotation_updated',
      title: 'Quotation updated',
      description: `${updatedQ.quote_number} updated`,
      userName: updatedQ.agent || req.user?.name || 'Admin',
      action: 'updated quotation for',
      leadName: updatedQ.client_name || 'Client',
      leadId: updatedQ.lead_id ? String(updatedQ.lead_id) : null,
      detail: `${updatedQ.quote_number} • Total: ₹${Number(updatedQ.total_amount || 0).toLocaleString('en-IN')}`,
    });

    return res.status(200).json({ success: true, data: toQuotationDTO(rows[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuotationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const { rows } = await connectDB.query(
      `UPDATE public.quotations SET status = $1, updated_at = NOW() WHERE id::text = $2 OR quote_number = $2 RETURNING *`,
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Quotation not found' });

    const updatedQ = rows[0];
    const performer = updatedQ.agent || req.user?.name || 'Admin';
    const detail = `${updatedQ.quote_number} • Status: ${status} • ₹${Number(updatedQ.total_amount || 0).toLocaleString('en-IN')}`;

    await logActivity({
      type: 'quotation',
      title: `Quotation ${status}`,
      description: detail,
      userName: performer,
      action: status === 'Sent' ? 'sent quotation to' : `marked quotation as ${status} for`,
      leadName: updatedQ.client_name || 'Client',
      leadId: updatedQ.lead_id ? String(updatedQ.lead_id) : null,
      detail,
    });

    return res.status(200).json({ success: true, data: toQuotationDTO(rows[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await connectDB.query(`DELETE FROM public.quotations WHERE id::text = $1 OR quote_number = $1 RETURNING id, quote_number, client_name`, [id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const deletedQ = result.rows[0];

    await logActivity({
      type: 'quotation_deleted',
      title: 'Quotation deleted',
      description: `${deletedQ.quote_number || 'Quotation'} was deleted`,
      userName: req.user?.name || 'Admin',
      action: 'deleted quotation',
      leadName: deletedQ.client_name || 'Client',
      detail: `${deletedQ.quote_number || 'Quotation'} removed`,
    });

    return res.status(200).json({ success: true, message: 'Quotation deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Quotation Templates Endpoints ───────────────────────────

export const getQuotationTemplates = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.quotation_templates ORDER BY created_at DESC`);
    const data = rows.map(toTemplateDTO);
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createQuotationTemplate = async (req, res) => {
  try {
    const { name, description, created_by, createdBy, items } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Template name is required' });

    const lineItems = items || [];
    const { rows } = await connectDB.query(
      `INSERT INTO public.quotation_templates (name, description, created_by, items, item_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
      [name, description || '', created_by || createdBy || 'Admin', JSON.stringify(lineItems), lineItems.length]
    );

    return res.status(201).json({ success: true, data: toTemplateDTO(rows[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuotationTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, created_by, createdBy, items } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.quotation_templates SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        created_by = COALESCE($3, created_by),
        items = COALESCE($4, items),
        item_count = COALESCE($5, item_count),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        name || null,
        description !== undefined ? description : null,
        created_by || createdBy || null,
        items ? JSON.stringify(items) : null,
        items ? items.length : null,
        id
      ]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Template not found' });
    return res.status(200).json({ success: true, data: toTemplateDTO(rows[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQuotationTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await connectDB.query(`DELETE FROM public.quotation_templates WHERE id = $1 RETURNING id`, [id]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Template not found' });
    return res.status(200).json({ success: true, message: 'Template deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const sendQuotationEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      to,
      cc,
      subject,
      message,
      markSent,
      logActivity: shouldLogActivity,
      sendCopy,
      quoteId,
      quoteNo,
      leadId,
      companyName,
      items: clientItems,
      totalFormatted,
      validUntil: clientValidUntil,
    } = req.body;

    if (!to || !to.trim()) {
      return res.status(400).json({ success: false, message: 'Recipient email address ("to") is required' });
    }

    const targetId = id || quoteId || quoteNo;
    let quotation = null;

    if (targetId && targetId !== 'send') {
      const { rows } = await connectDB.query(
        `SELECT * FROM public.quotations WHERE id::text = $1 OR quote_number = $1`,
        [targetId]
      );
      if (rows.length) {
        quotation = rows[0];
      }
    }

    const resolvedQuoteNo = quotation?.quote_number || quoteNo || 'QT-001';
    const clientName = quotation?.client_name || req.body.leadName || 'Valued Client';
    const resolvedAgent = quotation?.agent || req.body.agent || req.user?.name || 'Sales Team';
    const resolvedCompany = companyName || 'PropMax Solutions';
    const resolvedSubject = subject || `Quotation ${resolvedQuoteNo} from ${resolvedCompany}`;

    let resolvedItems = [];
    if (quotation?.items) {
      if (Array.isArray(quotation.items)) {
        resolvedItems = quotation.items;
      } else if (typeof quotation.items === 'string') {
        try { resolvedItems = JSON.parse(quotation.items); } catch (e) { resolvedItems = []; }
      }
    } else if (Array.isArray(clientItems)) {
      resolvedItems = clientItems;
    }

    const subtotal = resolvedItems.reduce((acc, it) => acc + (Number(it.qty || 1) * Number(it.rate || 0)), 0);
    const taxTotal = Number(quotation?.tax) || resolvedItems.reduce((acc, it) => {
      const base = Number(it.qty || 1) * Number(it.rate || 0);
      return acc + (base * (Number(it.taxPercent || it.tax || 0) / 100));
    }, 0);
    const discount = Number(quotation?.discount || 0);
    const total = Number(quotation?.total_amount) || Math.max(0, subtotal - discount + taxTotal);

    const emailHtml = generateQuotationEmailHtml({
      quoteNo: resolvedQuoteNo,
      clientName,
      companyName: resolvedCompany,
      message,
      items: resolvedItems,
      subtotal,
      discount,
      tax: taxTotal,
      total,
      date: quotation?.quote_date || req.body.date || new Date().toISOString().split('T')[0],
      validUntil: quotation?.valid_until || clientValidUntil || '',
      terms: quotation?.terms || req.body.terms || '',
      agent: resolvedAgent
    });

    const transporter = getEmailTransporter();
    const senderEmail = process.env.EMAIL_USER || process.env.EMAILUSER;

    const mailOptions = {
      from: `"${resolvedCompany}" <${senderEmail}>`,
      to: to.trim(),
      subject: resolvedSubject,
      html: emailHtml,
      text: `${message}\n\nQuotation ${resolvedQuoteNo}\nTotal: ₹${Number(total || 0).toLocaleString('en-IN')}\n\nFrom ${resolvedCompany}`
    };

    if (cc && cc.trim()) {
      mailOptions.cc = cc.trim();
    }

    if (sendCopy && senderEmail) {
      mailOptions.bcc = senderEmail;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Quotation Email] Sent successfully to ${to}. MessageId: ${info.messageId}`);

    // If markSent is true and we have quotation in DB, update status
    if (quotation && markSent !== false) {
      await connectDB.query(
        `UPDATE public.quotations SET status = 'Sent', updated_at = NOW() WHERE id = $1`,
        [quotation.id]
      ).catch(e => console.error('Error updating quote status to Sent:', e));
    }

    // Log Activity
    const targetLeadId = quotation?.lead_id || leadId;
    if (shouldLogActivity !== false && (targetLeadId || clientName)) {
      await logActivity({
        type: 'quotation_sent',
        title: 'Quotation sent via email',
        description: `Quotation ${resolvedQuoteNo} sent to ${to}`,
        userName: resolvedAgent,
        action: 'sent quotation via email to',
        leadName: clientName,
        leadId: targetLeadId ? String(targetLeadId) : null,
        detail: `Subject: ${resolvedSubject} • Total: ₹${Number(total || 0).toLocaleString('en-IN')}`
      }).catch(e => console.error('Error logging activity:', e));
    }

    return res.status(200).json({
      success: true,
      message: `Quotation sent successfully to ${to}`,
      messageId: info.messageId
    });
  } catch (err) {
    console.error('[Quotation Email Error]:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to send quotation email'
    });
  }
};

