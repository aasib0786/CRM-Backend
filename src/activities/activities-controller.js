import connectDB from '../pool.js';
import { logActivity, getTimeBlock, getInitials } from './activityLogger.js';

export { logActivity, getTimeBlock, getInitials };

// Helper to format activity row into frontend DTO
export const toActivityDTO = (row) => {
  if (!row) return null;
  const ts = row.timestamp ? new Date(row.timestamp) : new Date();
  const agent = row.user_name || 'System';
  const initials =
    row.user_initials ||
    getInitials(agent);

  let type = (row.type || 'note').toLowerCase().replace(/\s+/g, '_');
  if (type === 'stage_changed') type = 'stage_change';
  if (type === 'lead_create') type = 'lead_created';
  if (type === 'quotations') type = 'quotation';
  if (type === 'project_create' || type === 'projects') type = 'project';
  if (type === 'inventory' || type === 'inventory_item') type = 'unit';

  const action =
    row.action ||
    (type === 'call'
      ? 'logged a call with'
      : type === 'call_scheduled'
      ? 'scheduled a call with'
      : type === 'note'
      ? 'added a note on'
      : type === 'stage_change'
      ? 'moved'
      : type === 'lead_created'
      ? 'created a lead'
      : type === 'whatsapp'
      ? 'sent WhatsApp to'
      : type === 'assignment'
      ? 'assigned'
      : type === 'score_change'
      ? 'score changed for'
      : type === 'quotation'
      ? 'created quotation for'
      : type === 'project'
      ? 'created project'
      : type === 'unit'
      ? 'added unit in'
      : type === 'task'
      ? 'created task for'
      : 'performed activity on');

  const timeFormatted = ts.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const block = row.time_block || getTimeBlock(ts);

  let metadata = {};
  if (row.metadata && typeof row.metadata === 'object') {
    metadata = row.metadata;
  } else if (typeof row.metadata === 'string') {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = {};
    }
  }

  return {
    id: row.id,
    type,
    agent,
    agentInitials: initials,
    action,
    leadName: row.lead_name || 'General Activity',
    leadId: row.lead_id || null,
    detail: row.detail || row.description || row.title || '',
    title: row.title || '',
    time: timeFormatted,
    timeBlock: block,
    timeSort: ts.toISOString(),
    timestamp: ts.toISOString(),
    metadata,
  };
};

export const getActivities = async (req, res) => {
  try {
    const { date, agent, type, lead_id, leadId, search, limit = 200, offset = 0 } = req.query;
    const targetLeadId = lead_id || leadId;

    // Fast-sync any leads created that don't have an activity record yet
    try {
      const missingLeads = await connectDB.query(`
        SELECT l.id, l.name, l.source, l.score, l.assigned, l.created_at
        FROM public.leads l
        LEFT JOIN public.activities a ON a.lead_id::text = l.id::text AND a.type = 'lead_created'
        WHERE a.id IS NULL
        LIMIT 50
      `);

      for (const lead of missingLeads.rows) {
        const uName = lead.assigned || 'System';
        const uInitials = uName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 3);
        const detail = `Source: ${lead.source || 'Manual'} • Score: ${lead.score || 50}`;
        const ts = lead.created_at ? new Date(lead.created_at) : new Date();
        const hours = ts.getHours();
        const block = hours < 12 ? 'Morning' : hours < 17 ? 'Afternoon' : 'Evening';

        await connectDB.query(
          `INSERT INTO public.activities (
            type, title, description, user_name, user_initials, action,
            lead_name, lead_id, detail, time_block, timestamp, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            'lead_created',
            'Lead created',
            detail,
            uName,
            uInitials,
            'created a lead',
            lead.name,
            String(lead.id),
            detail,
            block,
            ts,
            JSON.stringify({}),
          ]
        ).catch(() => {});
      }
    } catch {}

    let query = `SELECT * FROM public.activities WHERE 1=1`;
    const params = [];

    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    if (companyId) {
      params.push(companyId);
      query += ` AND company_id = $${params.length}`;
    }

    // Date filter: if specific date provided (YYYY-MM-DD)
    if (date && date !== 'all') {
      params.push(date);
      query += ` AND (
        to_char(timestamp, 'YYYY-MM-DD') = $${params.length} OR
        to_char(timestamp AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${params.length} OR
        to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $${params.length} OR
        DATE(timestamp) = $${params.length}::date
      )`;
    }

    // Agent filter
    if (agent && agent !== 'Everyone' && agent !== 'All') {
      params.push(agent);
      query += ` AND (user_name = $${params.length} OR user_name ILIKE $${params.length})`;
    }

    // Type filter
    if (type && type !== 'All Activities' && type !== 'all') {
      const typeMap = {
        Calls: 'call',
        call: 'call',
        Notes: 'note',
        note: 'note',
        'Stage Changes': 'stage_change',
        stage_change: 'stage_change',
        'Lead Created': 'lead_created',
        lead_created: 'lead_created',
        WhatsApp: 'whatsapp',
        whatsapp: 'whatsapp',
        Assignments: 'assignment',
        assignment: 'assignment',
        'Score Changes': 'score_change',
        score_change: 'score_change',
        Quotations: 'quotation',
        quotation: 'quotation',
        Projects: 'project',
        project: 'project',
        Units: 'unit',
        unit: 'unit',
        Tasks: 'task',
        task: 'task',
        Meetings: 'meeting',
        meeting: 'meeting',
      };
      const mappedType = typeMap[type] || type.toLowerCase();
      params.push(mappedType);
      query += ` AND (LOWER(type) = $${params.length} OR LOWER(type) LIKE '%' || $${params.length} || '%')`;
    }

    // Lead ID filter
    if (targetLeadId) {
      params.push(String(targetLeadId));
      query += ` AND (lead_id = $${params.length} OR lead_id::text = $${params.length})`;
    }

    // Search query
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND (lead_name ILIKE $${params.length} OR detail ILIKE $${params.length} OR description ILIKE $${params.length} OR user_name ILIKE $${params.length})`;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10) || 200);
    params.push(parseInt(offset, 10) || 0);

    const { rows } = await connectDB.query(query, params);
    const formattedData = rows.map(toActivityDTO);

    return res.status(200).json({
      success: true,
      count: formattedData.length,
      data: formattedData,
    });
  } catch (err) {
    console.error('getActivities error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createActivity = async (req, res) => {
  try {
    const {
      type = 'note',
      title,
      description,
      user_name,
      agent,
      user_initials,
      action,
      lead_name,
      leadName,
      lead_id,
      leadId,
      detail,
      time_block,
      timestamp,
      metadata = {},
    } = req.body;

    const row = await logActivity({
      type,
      title,
      description,
      userName: user_name || agent,
      userInitials: user_initials,
      action,
      leadName: lead_name || leadName,
      leadId: lead_id || leadId,
      detail,
      timeBlock: time_block,
      timestamp: timestamp || new Date(),
      metadata,
    });

    if (!row) {
      return res.status(500).json({ success: false, message: 'Failed to record activity' });
    }

    return res.status(201).json({
      success: true,
      message: 'Activity recorded successfully',
      data: toActivityDTO(row),
    });
  } catch (err) {
    console.error('createActivity error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const { id } = req.params;
    await connectDB.query(`DELETE FROM public.activities WHERE id::text = $1`, [id]);
    return res.status(200).json({ success: true, message: 'Activity deleted successfully' });
  } catch (err) {
    console.error('deleteActivity error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};
