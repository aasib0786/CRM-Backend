/**
 * Workflow Event Bus & Trigger Hooks (Phase 3)
 * Bridges CRM actions (lead creation, stage change, inbound message, assignment, handoff)
 * directly into the Workflow Engine and Stop Rules.
 */

import connectDB from '../pool.js';
import { triggerWorkflowsForEvent, handleStopRules, runWorkflowExecution } from './workflow-engine.js';

/**
 * Hook: Triggered when a new lead is created
 */
export async function emitLeadCreated(lead, companyId) {
  if (!lead || !companyId) return;

  return triggerWorkflowsForEvent({
    type: 'lead_created',
    company_id: companyId,
    lead,
    payload: { source: lead.source, project_id: lead.project_id },
  }).catch((err) => {
    console.error('[Workflow Event] emitLeadCreated error:', err.message);
  });
}

/**
 * Hook: Triggered when a lead stage changes
 */
export async function emitStageChanged(lead, fromStage, toStage, companyId) {
  if (!lead || !companyId) return;

  // 1. Check stop rules on stage change (e.g. Won, Lost, or configured stop stage)
  handleStopRules({
    event: 'stage_change',
    leadId: lead.id,
    companyId,
    newStage: toStage,
  }).catch((e) => console.warn('[Workflow Event] Stop rule on stage change error:', e.message));

  // 2. Trigger workflows listening for stage_changed
  return triggerWorkflowsForEvent({
    type: 'stage_changed',
    company_id: companyId,
    lead: { ...lead, stage: toStage },
    previousLead: { ...lead, stage: fromStage },
    payload: { from_stage: fromStage, to_stage: toStage },
  }).catch((err) => {
    console.error('[Workflow Event] emitStageChanged error:', err.message);
  });
}

/**
 * Hook: Triggered when a lead is assigned to an agent
 */
export async function emitLeadAssigned(lead, agentId, companyId) {
  if (!lead || !companyId) return;

  return triggerWorkflowsForEvent({
    type: 'lead_assigned',
    company_id: companyId,
    lead: { ...lead, assigned_user_id: agentId },
    payload: { agent_id: agentId },
  }).catch((err) => {
    console.error('[Workflow Event] emitLeadAssigned error:', err.message);
  });
}

/**
 * Hook: Triggered when lead score changes / crosses threshold
 */
export async function emitScoreCrossed(lead, newScore, previousScore, companyId) {
  if (!lead || !companyId) return;

  return triggerWorkflowsForEvent({
    type: 'score_crossed',
    company_id: companyId,
    lead: { ...lead, score: newScore },
    previousLead: { ...lead, score: previousScore },
    payload: { score: newScore, previousScore },
  }).catch((err) => {
    console.error('[Workflow Event] emitScoreCrossed error:', err.message);
  });
}

/**
 * Hook: Triggered when a tag is added to a lead
 */
export async function emitTagAdded(lead, tag, companyId) {
  if (!lead || !companyId) return;

  return triggerWorkflowsForEvent({
    type: 'tag_added',
    company_id: companyId,
    lead,
    payload: { tag },
  }).catch((err) => {
    console.error('[Workflow Event] emitTagAdded error:', err.message);
  });
}

/**
 * Hook: Triggered when bot hands off conversation to human
 */
export async function emitBotHandedOff(lead, reason, companyId) {
  if (!lead || !companyId) return;

  // Enforce agent takeover stop rule
  handleStopRules({
    event: 'agent_takeover',
    leadId: lead.id,
    companyId,
    reason,
  }).catch((e) => console.warn('[Workflow Event] Stop rule on handoff error:', e.message));

  return triggerWorkflowsForEvent({
    type: 'bot_handed_off',
    company_id: companyId,
    lead,
    payload: { reason },
  }).catch((err) => {
    console.error('[Workflow Event] emitBotHandedOff error:', err.message);
  });
}

/**
 * Hook: Triggered when an inbound WhatsApp message arrives from a customer
 */
export async function emitInboundMessage(leadPhone, text, companyId) {
  if (!leadPhone || !companyId) return;

  const digits = String(leadPhone).replace(/\D/g, '').slice(-10);

  // Find matching lead
  const { rows } = await connectDB.query(
    `SELECT id, name, do_not_message FROM public.leads 
     WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1 AND company_id = $2 
     LIMIT 1`,
    [digits, companyId]
  );

  const lead = rows[0];
  if (!lead) return;

  // Process reply stop rules (including STOP keyword for opt-out)
  await handleStopRules({
    event: 'reply',
    leadId: lead.id,
    companyId,
    messageText: text,
  });
}

/**
 * Hook: Manual workflow execution triggered from API or UI
 */
export async function emitManualTrigger(workflowId, leadId, companyId, userId = null) {
  if (!workflowId || !leadId || !companyId) {
    throw new Error('workflowId, leadId, and companyId are required for manual trigger');
  }

  // Fetch workflow
  const { rows: wfRows } = await connectDB.query(
    `SELECT * FROM public.workflows WHERE id = $1 AND company_id = $2`,
    [workflowId, companyId]
  );
  const workflow = wfRows[0];
  if (!workflow) throw new Error('Workflow not found');

  // Fetch lead
  const { rows: leadRows } = await connectDB.query(
    `SELECT * FROM public.leads WHERE id = $1 AND company_id = $2`,
    [leadId, companyId]
  );
  const lead = leadRows[0];
  if (!lead) throw new Error('Lead not found');

  const steps = Array.isArray(workflow.steps) ? workflow.steps : (typeof workflow.steps === 'string' ? JSON.parse(workflow.steps || '[]') : []);
  if (steps.length === 0) throw new Error('Workflow has no steps configured');

  // Create manual run
  const { rows: runRows } = await connectDB.query(
    `INSERT INTO public.workflow_runs (
      company_id, workflow_id, lead_id, status,
      current_step_id, current_step_index,
      trigger_event, started_at, created_at, updated_at
    ) VALUES ($1, $2, $3, 'running', $4, 0, $5::jsonb, NOW(), NOW(), NOW())
    RETURNING id`,
    [
      companyId,
      workflow.id,
      lead.id,
      steps[0]?.id || 'step-0',
      JSON.stringify({ type: 'manual', userId, triggered_at: new Date().toISOString() }),
    ]
  );

  const runId = runRows[0]?.id;
  if (runId) {
    setImmediate(() => {
      runWorkflowExecution(runId).catch((err) => {
        console.error(`[Workflow Engine] Error executing manual run ${runId}:`, err);
      });
    });
  }

  return { success: true, runId };
}
