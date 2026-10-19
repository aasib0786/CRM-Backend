import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';

// Helper to format date into friendly human text like "Today 10:30 AM", "Yesterday 4:00 PM", "2 days ago"
const formatCallDate = (date) => {
  if (!date) return 'Recently';
  const d = new Date(date);
  const now = new Date();
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (d.toDateString() === now.toDateString()) {
    return `Today ${timeStr}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${timeStr}`;
  }
  if (diffDays <= 7 && diffDays > 1) {
    return `${diffDays} days ago ${timeStr}`;
  }
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${timeStr}`;
};

// Helper to parse duration string like "5m 20s" or "02:14" to seconds
const parseDurationToSecs = (dur) => {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur;
  const str = String(dur).trim();
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseInt(p, 10) || 0);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  let total = 0;
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  if (sMatch) total += parseInt(sMatch[1], 10);
  return total;
};

// Format seconds into "Xm Ys"
const formatSecsToDuration = (secs) => {
  if (!secs || secs <= 0) return '0m';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
};

// Seed initial realistic calls if table is empty
const ensureSeedCalls = async () => {
  try {
    const { rows: countRows } = await connectDB.query(`SELECT COUNT(*) as count FROM public.calls`);
    if (parseInt(countRows[0]?.count || 0, 10) > 0) return;

    // Fetch existing leads if available
    const { rows: leads } = await connectDB.query(`SELECT id, name, phone, company, assigned_to FROM public.leads LIMIT 10`);

    const sampleCalls = [
      { name: "Vikram Mehta", phone: "9876543210", agent: "Rajesh Kumar", dur: "5m 20s", secs: 320, status: "Connected", outcome: "Interested", notes: "Discussed 3BHK flat in Bandra. Site visit on Saturday.", hoursAgo: 2 },
      { name: "Anita Desai", phone: "9845123456", agent: "Priya Sharma", dur: "0m", secs: 0, status: "Missed", outcome: "No Answer", notes: "Rang once, no response.", hoursAgo: 4 },
      { name: "Suresh Nair", phone: "9712345678", agent: "Rajesh Kumar", dur: "3m 45s", secs: 225, status: "Connected", outcome: "Follow Up Required", notes: "Final offer discussed. Will follow up tomorrow.", hoursAgo: 6 },
      { name: "Kavita Joshi", phone: "9632145870", agent: "Amit Patel", dur: "8m 12s", secs: 492, status: "Connected", outcome: "Interested", notes: "Answered parking and maintenance queries.", hoursAgo: 26 },
      { name: "Rahul Verma", phone: "9521478963", agent: "Sneha Rao", dur: "0m", secs: 0, status: "Busy", outcome: "Busy", notes: "Line busy.", hoursAgo: 28 },
      { name: "Deepika Singh", phone: "9415263780", agent: "Priya Sharma", dur: "6m 05s", secs: 365, status: "Connected", outcome: "Converted", notes: "Booking finalized for Andheri 2BHK.", hoursAgo: 30 },
      { name: "Sunita Rao", phone: "9201364875", agent: "Rajesh Kumar", dur: "2m 30s", secs: 150, status: "Connected", outcome: "Call Back Later", notes: "Will speak in the evening.", hoursAgo: 48 },
    ];

    for (let i = 0; i < sampleCalls.length; i++) {
      const s = sampleCalls[i];
      const lead = leads[i % (leads.length || 1)];
      const leadId = lead ? lead.id : null;
      const cName = lead?.name || s.name;
      const cPhone = lead?.phone || s.phone;
      const cAgent = lead?.assigned_to || s.agent;

      await connectDB.query(
        `INSERT INTO public.calls (contact_name, phone, direction, duration, duration_seconds, status, outcome, purpose, agent, notes, lead_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW() - INTERVAL '${s.hoursAgo} hours')`,
        [cName, cPhone, 'outbound', s.dur, s.secs, s.status, s.outcome, 'Follow-up', cAgent, s.notes, leadId]
      ).catch(() => {});
    }
  } catch (e) {
    console.error("Error seeding calls:", e.message);
  }
};

// Seed initial scheduled calls if table is empty
const ensureSeedScheduledCalls = async () => {
  try {
    const { rows: countRows } = await connectDB.query(`SELECT COUNT(*) as count FROM public.scheduled_calls`);
    if (parseInt(countRows[0]?.count || 0, 10) > 0) return;

    const sampleScheduled = [
      { name: "Sarah Chen", company: "TechVentures", phone: "9812345678", minsAhead: 45, purpose: "Demo", agent: "Rajesh Kumar", notes: "Product walkthrough presentation" },
      { name: "Marcus Webb", company: "Skyline Infra", phone: "9723456789", minsAhead: 90, purpose: "Follow-up", agent: "Priya Sharma", notes: "Discuss commercial leasing quotation" },
      { name: "Elena Ruiz", company: "GreenLeaf Organic", phone: "9634567890", minsAhead: 150, purpose: "Proposal", agent: "Amit Patel", notes: "Contract review" },
      { name: "Ravi Iyer", company: "CloudFirst Tech", phone: "9812345670", minsAhead: 1440, purpose: "Discovery", agent: "Rajesh Kumar", notes: "Initial requirement gathering" },
      { name: "Neha Gupta", company: "MediCare Health", phone: "9545678901", minsAhead: 1800, purpose: "Demo", agent: "Sneha Rao", notes: "Portal demonstration" },
    ];

    for (const sc of sampleScheduled) {
      await connectDB.query(
        `INSERT INTO public.scheduled_calls (lead_name, company, phone, scheduled_time, purpose, agent, notes, status)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${sc.minsAhead} minutes', $4, $5, $6, 'Scheduled')`,
        [sc.name, sc.company, sc.phone, sc.purpose, sc.agent, sc.notes]
      ).catch(() => {});
    }
  } catch (e) {
    console.error("Error seeding scheduled calls:", e.message);
  }
};

// ── GET ALL CALL LOGS ──
export const getCalls = async (req, res) => {
  try {
    await ensureSeedCalls();

    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    const { search, status, agent } = req.query;
    let query = `
      SELECT c.*, u.name as user_name
      FROM public.calls c
      LEFT JOIN public.users u ON c.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (companyId) {
      params.push(companyId);
      query += ` AND c.company_id = $${params.length}`;
    } else {
      query += ` AND 1=0`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(c.contact_name) LIKE $${params.length} OR c.phone LIKE $${params.length} OR LOWER(COALESCE(c.notes, '')) LIKE $${params.length})`;
    }

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }

    if (agent && agent !== 'all') {
      params.push(agent);
      query += ` AND (c.agent = $${params.length} OR u.name = $${params.length})`;
    }

    query += ` ORDER BY c.created_at DESC`;

    const { rows } = await connectDB.query(query, params);

    const formatted = rows.map((r) => {
      const durSecs = r.duration_seconds || parseDurationToSecs(r.duration);
      return {
        id: r.id,
        contact_name: r.contact_name,
        leadName: r.contact_name,
        phone: r.phone,
        direction: r.direction || 'outbound',
        duration: r.duration || formatSecsToDuration(durSecs),
        durationSeconds: durSecs,
        duration_seconds: durSecs,
        status: r.status || 'Connected',
        outcome: r.outcome || 'Connected',
        purpose: r.purpose || 'Follow-up',
        recording_url: r.recording_url,
        hasRecording: !!r.recording_url,
        notes: r.notes || '',
        agent: r.agent || r.user_name || 'Agent',
        lead_id: r.lead_id,
        leadId: r.lead_id,
        user_id: r.user_id,
        date: formatCallDate(r.created_at),
        dateSort: r.created_at,
        created_at: r.created_at,
      };
    });

    return res.status(200).json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('getCalls error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET DYNAMIC CALL STATS ──
export const getCallStats = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    let whereFilter = 'WHERE 1=1';
    const sParams = [];
    if (companyId) {
      sParams.push(companyId);
      whereFilter += ` AND company_id = $${sParams.length}`;
    } else {
      whereFilter += ` AND 1=0`;
    }

    // Query today's calls and overall stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total_all,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as total_today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND LOWER(status) = 'connected') as connected_today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND LOWER(status) IN ('missed', 'busy', 'no answer')) as missed_today,
        COALESCE(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0), 0) as avg_duration_seconds
      FROM public.calls
      ${whereFilter}
    `;
    const { rows } = await connectDB.query(statsQuery, sParams);
    const s = rows[0] || {};

    const avgSecs = Math.round(parseFloat(s.avg_duration_seconds || 0));

    return res.status(200).json({
      success: true,
      data: {
        totalToday: parseInt(s.total_today || 0, 10),
        connected: parseInt(s.connected_today || 0, 10),
        missed: parseInt(s.missed_today || 0, 10),
        avgDuration: formatSecsToDuration(avgSecs),
        totalAll: parseInt(s.total_all || 0, 10),
      },
    });
  } catch (err) {
    console.error('getCallStats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── CREATE / LOG A CALL ──
export const createCall = async (req, res) => {
  try {
    const {
      contact_name,
      leadName,
      phone,
      direction,
      duration,
      duration_seconds,
      durationSeconds,
      status,
      outcome,
      purpose,
      recording_url,
      notes,
      lead_id,
      leadId,
      agent,
    } = req.body;

    const contactName = contact_name || leadName || 'Contact';
    const rawLeadId = lead_id || leadId;
    const validLeadId = rawLeadId && typeof rawLeadId === 'string' && /^[0-9a-fA-F-]{36}$/.test(rawLeadId.trim())
      ? rawLeadId.trim()
      : null;

    const validUserId = req.user?.id && typeof req.user.id === 'string' && /^[0-9a-fA-F-]{36}$/.test(req.user.id.trim())
      ? req.user.id.trim()
      : null;

    const durSecs = duration_seconds || durationSeconds || parseDurationToSecs(duration);
    const durStr = duration || formatSecsToDuration(durSecs);
    const callAgent = agent || req.user?.name || req.user?.email || 'Agent';
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.body?.company_id || null;

    const { rows } = await connectDB.query(
      `INSERT INTO public.calls (contact_name, phone, direction, duration, duration_seconds, status, outcome, purpose, agent, recording_url, notes, lead_id, user_id, company_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()) RETURNING *`,
      [
        contactName,
        phone || '',
        direction || 'outbound',
        durStr,
        durSecs,
        status || 'Completed',
        outcome || 'Connected',
        purpose || 'Follow-up',
        callAgent,
        recording_url || null,
        notes || null,
        validLeadId,
        validUserId,
        companyId,
      ]
    );

    const detail = `Duration: ${durStr} • ${status || 'Completed'}${outcome ? ` - ${outcome}` : ''}${notes ? ` • ${notes}` : ''}`;

    // Log activity
    await logActivity({
      type: 'call',
      title: 'Call logged',
      description: detail,
      userName: callAgent,
      action: 'logged a call with',
      leadName: contactName,
      leadId: validLeadId,
      detail,
    }).catch(() => {});

    if (validLeadId) {
      await connectDB.query(
        `INSERT INTO lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
        [validLeadId, 'Call', detail, callAgent]
      ).catch(() => {});
      await connectDB.query(
        `UPDATE leads SET last_activity = NOW(), updated_at = NOW() WHERE id::text = $1`,
        [validLeadId]
      ).catch(() => {});
    }

    const created = rows[0];
    return res.status(201).json({
      success: true,
      data: {
        id: created.id,
        leadName: created.contact_name,
        contact_name: created.contact_name,
        phone: created.phone,
        agent: created.agent,
        duration: created.duration,
        durationSeconds: created.duration_seconds,
        status: created.status,
        outcome: created.outcome,
        purpose: created.purpose,
        hasRecording: !!created.recording_url,
        notes: created.notes || '',
        date: formatCallDate(created.created_at),
        dateSort: created.created_at,
        created_at: created.created_at,
      },
    });
  } catch (err) {
    console.error('createCall error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── UPDATE A CALL (Notes / Outcome) ──
export const updateCall = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, outcome, status, purpose } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.calls
       SET 
         notes = COALESCE($1, notes),
         outcome = COALESCE($2, outcome),
         status = COALESCE($3, status),
         purpose = COALESCE($4, purpose)
       WHERE id = $5 RETURNING *`,
      [notes, outcome, status, purpose, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Call record not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('updateCall error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE A CALL ──
export const deleteCall = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await connectDB.query(`DELETE FROM public.calls WHERE id = $1 RETURNING contact_name`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }
    const cName = rows[0]?.contact_name || 'Contact';

    await logActivity({
      type: 'call_deleted',
      title: 'Call log deleted',
      description: `Call record with ${cName} was deleted`,
      userName: req.user?.name || 'Admin',
      action: 'deleted call with',
      leadName: cName,
      detail: `Call log removed`,
    });

    return res.status(200).json({ success: true, message: 'Call log deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET SCHEDULED CALLS ──
export const getScheduledCalls = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    let schedQuery = `SELECT * FROM public.scheduled_calls WHERE 1=1`;
    const sParams = [];
    if (companyId) {
      sParams.push(companyId);
      schedQuery += ` AND company_id = $${sParams.length}`;
    } else {
      schedQuery += ` AND 1=0`;
    }
    schedQuery += ` ORDER BY scheduled_time ASC`;

    const { rows } = await connectDB.query(schedQuery, sParams);

    const formatted = rows.map((r) => {
      const d = new Date(r.scheduled_time);
      const now = new Date();
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const isToday = d.toDateString() === now.toDateString();
      const displayTime = isToday
        ? `Today ${timeStr}`
        : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${timeStr}`;

      return {
        id: r.id,
        leadName: r.lead_name,
        company: r.company || '',
        phone: r.phone,
        time: displayTime,
        timeSort: r.scheduled_time,
        scheduled_time: r.scheduled_time,
        purpose: r.purpose || 'Follow-up',
        agent: r.agent || 'Agent',
        notes: r.notes || '',
        status: r.status || 'Scheduled',
        lead_id: r.lead_id,
      };
    });

    return res.status(200).json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('getScheduledCalls error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── CREATE / SCHEDULE A CALL ──
export const createScheduledCall = async (req, res) => {
  try {
    const { leadName, company, phone, timeSort, scheduled_time, purpose, agent, notes, lead_id, leadId } = req.body;

    const schedTime = scheduled_time || timeSort || new Date();
    const rawLeadId = lead_id || leadId;
    const validLeadId = rawLeadId && typeof rawLeadId === 'string' && /^[0-9a-fA-F-]{36}$/.test(rawLeadId.trim())
      ? rawLeadId.trim()
      : null;
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.body?.company_id || null;

    const { rows } = await connectDB.query(
      `INSERT INTO public.scheduled_calls (lead_name, company, phone, scheduled_time, purpose, agent, notes, status, lead_id, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Scheduled', $8, $9) RETURNING *`,
      [
        leadName || 'Lead',
        company || '',
        phone || '',
        schedTime,
        purpose || 'Follow-up',
        agent || req.user?.name || 'Agent',
        notes || '',
        validLeadId,
        companyId,
      ]
    );

    const created = rows[0];
    await logActivity({
      type: 'call_scheduled',
      title: 'Call scheduled',
      description: `Scheduled ${purpose || 'call'} with ${leadName || 'Lead'} for ${new Date(schedTime).toLocaleString()}`,
      userName: agent || req.user?.name || 'Agent',
      action: 'scheduled a call with',
      leadName: leadName || 'Lead',
      leadId: validLeadId,
      detail: `Purpose: ${purpose || 'Follow-up'}`,
    }).catch(() => {});

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('createScheduledCall error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE / CANCEL SCHEDULED CALL ──
export const deleteScheduledCall = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await connectDB.query(`DELETE FROM public.scheduled_calls WHERE id = $1 RETURNING lead_name`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Scheduled call not found' });
    }
    return res.status(200).json({ success: true, message: 'Scheduled call cancelled successfully' });
  } catch (err) {
    console.error('deleteScheduledCall error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};
