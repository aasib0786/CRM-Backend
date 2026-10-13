/**
 * Workflow Variable Interpolator (Phase 2)
 * Replaces {{lead.name}}, {{agent.name}}, {{project.name}}, etc.
 * with real values from the workflow execution context.
 */

import connectDB from '../pool.js';

/**
 * Builds a standardized workflow context object from a lead ID or pre-fetched lead
 */
export async function buildWorkflowContext({
  companyId,
  leadId = null,
  lead = null,
  extraContext = {},
}) {
  let leadData = lead;

  if (!leadData && leadId) {
    const { rows } = await connectDB.query(
      `SELECT * FROM public.leads WHERE id = $1 AND company_id = $2`,
      [leadId, companyId]
    );
    leadData = rows[0] || null;
  }

  if (!leadData) {
    leadData = { id: leadId, name: 'Valued Customer', phone: '', email: '', company_id: companyId };
  }

  // Fetch Company Name
  let companyName = 'CRM Pro';
  try {
    const compRes = await connectDB.query(`SELECT name FROM public.companies WHERE id = $1`, [companyId]);
    if (compRes.rows[0]?.name) companyName = compRes.rows[0].name;
  } catch (e) {}

  // Fetch Assigned Agent
  let agentName = leadData.assigned || leadData.assigned_to || 'Senior Sales Consultant';
  let agentEmail = '';
  let agentPhone = '';

  if (leadData.assigned_user_id || leadData.assigned_id) {
    try {
      const uRes = await connectDB.query(
        `SELECT name, email, phone FROM public.users WHERE id = $1`,
        [leadData.assigned_user_id || leadData.assigned_id]
      );
      if (uRes.rows[0]) {
        agentName = uRes.rows[0].name || agentName;
        agentEmail = uRes.rows[0].email || '';
        agentPhone = uRes.rows[0].phone || '';
      }
    } catch (e) {}
  }

  // Fetch Linked Project
  let projectName = 'Selected Project';
  if (leadData.project_id) {
    try {
      const pRes = await connectDB.query(`SELECT name FROM public.projects WHERE id = $1`, [leadData.project_id]);
      if (pRes.rows[0]?.name) projectName = pRes.rows[0].name;
    } catch (e) {}
  }

  // Custom fields parsing
  let customFields = {};
  if (leadData.custom_fields) {
    if (typeof leadData.custom_fields === 'string') {
      try { customFields = JSON.parse(leadData.custom_fields); } catch (e) {}
    } else if (typeof leadData.custom_fields === 'object') {
      customFields = leadData.custom_fields;
    }
  }

  return {
    lead: {
      ...leadData,
      custom_fields: customFields,
      requirement: customFields.requirement || leadData.requirement || '',
      budget: customFields.budget || leadData.budget || '',
      location: customFields.location || leadData.location || '',
      timeline: customFields.timeline || leadData.timeline || '',
    },
    agent: {
      name: agentName,
      email: agentEmail,
      phone: agentPhone,
    },
    project: {
      id: leadData.project_id || null,
      name: projectName,
    },
    company: {
      id: companyId,
      name: companyName,
    },
    ...extraContext,
  };
}

/**
 * Replaces {{variable.path}} tags with values from the context object
 *
 * Examples:
 *  "Hello {{lead.name}}, your budget of {{lead.budget}} is noted."
 *  "Agent {{agent.name}} will call you."
 */
export function interpolateVariables(templateText, context = {}) {
  if (!templateText || typeof templateText !== 'string') return '';

  return templateText.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path) => {
    const parts = path.split('.');
    let current = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return '';
      }
      current = current[part];
    }

    if (current === null || current === undefined) {
      return '';
    }

    if (typeof current === 'object') {
      return JSON.stringify(current);
    }

    return String(current);
  });
}
