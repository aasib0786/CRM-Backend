import connectDB from '../pool.js';

export const getTimeBlock = (date = new Date()) => {
  const hours = date instanceof Date ? date.getHours() : new Date(date).getHours();
  if (hours < 12) return 'Morning';
  if (hours < 17) return 'Afternoon';
  return 'Evening';
};

export const getInitials = (name = 'System') => {
  if (!name || name === 'System') return 'SY';
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 3) || 'SY'
  );
};

/**
 * Universal Activity Logger
 * Call this function anywhere in backend controllers to record an audit trail event.
 */
export const logActivity = async ({
  type = 'note',
  title = '',
  description = '',
  userName = 'System',
  agent = '',
  userInitials = '',
  action = '',
  leadName = '',
  leadId = null,
  detail = '',
  timeBlock = '',
  timestamp = new Date(),
  metadata = {},
}) => {
  try {
    const ts = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
    const finalAgent = agent || userName || 'System';
    const finalInitials = userInitials || getInitials(finalAgent);
    const finalBlock = timeBlock || getTimeBlock(ts);
    const finalDetail = detail || description || title || '';

    let normalizedType = (type || 'note').toLowerCase().replace(/\s+/g, '_');
    if (normalizedType === 'stage_changed') normalizedType = 'stage_change';
    if (normalizedType === 'lead_create') normalizedType = 'lead_created';
    if (normalizedType === 'quotations') normalizedType = 'quotation';
    if (normalizedType === 'project_create' || normalizedType === 'projects') normalizedType = 'project';
    if (normalizedType === 'inventory' || normalizedType === 'inventory_item') normalizedType = 'unit';

    let defaultAction = action;
    if (!defaultAction) {
      const actionMap = {
        call: 'logged a call with',
        call_scheduled: 'scheduled a call with',
        call_deleted: 'deleted call with',
        note: 'added a note on',
        stage_change: 'moved',
        lead_created: 'created lead',
        lead_updated: 'updated lead',
        lead_deleted: 'deleted lead',
        whatsapp: 'sent WhatsApp to',
        assignment: 'assigned',
        reassigned: 'reassigned',
        score_change: 'score changed for',
        quotation: 'created quotation for',
        quotation_updated: 'updated quotation for',
        quotation_status: 'updated quotation status for',
        quotation_deleted: 'deleted quotation',
        project: 'created project',
        project_updated: 'updated project',
        project_deleted: 'deleted project',
        unit: 'added unit in',
        unit_updated: 'updated unit in',
        unit_booked: 'booked unit for',
        unit_deleted: 'deleted unit in',
        task: 'created task for',
        task_completed: 'completed task for',
        task_updated: 'updated task for',
        task_deleted: 'deleted task for',
        document: 'uploaded document for',
        campaign: 'created campaign',
        campaign_launched: 'launched campaign',
        campaign_deleted: 'deleted campaign',
      };
      defaultAction = actionMap[normalizedType] || 'performed activity on';
    }

    const { rows } = await connectDB.query(
      `INSERT INTO public.activities (
        type, title, description, user_name, user_initials,
        action, lead_name, lead_id, detail, time_block, timestamp, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        normalizedType,
        title || `${normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)} logged`,
        description || finalDetail,
        finalAgent,
        finalInitials,
        defaultAction,
        leadName || null,
        leadId ? String(leadId) : null,
        finalDetail,
        finalBlock,
        ts,
        JSON.stringify(metadata || {}),
      ]
    );

    // If leadId is present, also update last_activity on leads table
    if (leadId) {
      await connectDB.query(
        `UPDATE public.leads SET last_activity = NOW(), updated_at = NOW() WHERE id::text = $1`,
        [String(leadId)]
      ).catch(() => {});
    }

    return rows[0];
  } catch (err) {
    console.error('logActivity error:', err.message);
    return null;
  }
};
