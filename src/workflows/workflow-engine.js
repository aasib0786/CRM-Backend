/**
 * Workflow Execution Engine (Phase 3)
 * Orchestrates workflow runs, sequentially processes steps, evaluates branches,
 * enforces stop rules, daily anti-spam limits (max 3 WA/day), quiet hours,
 * duplicate template protection, and bot collision guards.
 */

import connectDB from '../pool.js';
import { buildWorkflowContext } from './workflow-variables.js';
import { evaluateWorkflowEligibility } from './workflow-triggers.js';
import { executeWorkflowStep } from './workflow-actions.js';
import { logActivity } from '../activities/activityLogger.js';

const DAILY_WHATSAPP_LIMIT = 3;

/**
 * Checks if a lead has exceeded the 24-hour WhatsApp message limit across workflows
 */
export async function checkDailyWhatsAppLimit(companyId, leadId) {
  if (!leadId) return { allowed: true, count: 0 };

  try {
    const { rows } = await connectDB.query(
      `SELECT COUNT(*)::int AS count
       FROM public.workflow_run_logs l
       JOIN public.workflow_runs r ON r.id = l.run_id
       WHERE l.company_id = $1
         AND r.lead_id = $2
         AND l.step_type IN ('send_whatsapp_text', 'send_whatsapp_template')
         AND l.status = 'success'
         AND l.executed_at >= NOW() - INTERVAL '24 hours'`,
      [companyId, leadId]
    );

    const count = rows[0]?.count || 0;
    return {
      allowed: count < DAILY_WHATSAPP_LIMIT,
      count,
      limit: DAILY_WHATSAPP_LIMIT,
    };
  } catch (err) {
    console.warn('[Workflow Engine] Error checking WhatsApp limit:', err.message);
    return { allowed: true, count: 0 };
  }
}

/**
 * Checks if the exact WhatsApp template was already dispatched to this lead in the last 24h
 */
export async function isDuplicateTemplate(companyId, leadId, templateName) {
  if (!leadId || !templateName) return false;

  try {
    const { rows } = await connectDB.query(
      `SELECT l.id
       FROM public.workflow_run_logs l
       JOIN public.workflow_runs r ON r.id = l.run_id
       WHERE l.company_id = $1
         AND r.lead_id = $2
         AND l.step_type = 'send_whatsapp_template'
         AND l.status = 'success'
         AND (l.input_payload->>'template_name' = $3 OR l.input_payload->>'templateName' = $3)
         AND l.executed_at >= NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [companyId, leadId, templateName]
    );

    return rows.length > 0;
  } catch (err) {
    console.warn('[Workflow Engine] Error checking duplicate template:', err.message);
    return false;
  }
}

/**
 * Checks whether an active bot conversation is currently ongoing to prevent collision
 */
export async function isBotActivelyEngaged(companyId, leadId) {
  if (!leadId) return false;

  try {
    const { rows } = await connectDB.query(
      `SELECT id FROM public.bot_conversations
       WHERE company_id = $1
         AND lead_id = $2
         AND status = 'active'
         AND updated_at >= NOW() - INTERVAL '15 minutes'
       LIMIT 1`,
      [companyId, leadId]
    );

    return rows.length > 0;
  } catch (err) {
    return false;
  }
}

/**
 * Main engine loop to execute steps of a workflow run
 */
export async function runWorkflowExecution(runId) {
  if (!runId) return;

  // 1. Fetch Run + Workflow + Lead Details
  const { rows } = await connectDB.query(
    `SELECT 
      r.id AS run_id, r.company_id, r.workflow_id, r.lead_id, r.status,
      r.current_step_id, r.current_step_index, r.context_data,
      w.name AS workflow_name, w.steps, w.is_active,
      l.do_not_message, l.phone, l.name AS lead_name, l.stage AS lead_stage
    FROM public.workflow_runs r
    JOIN public.workflows w ON w.id = r.workflow_id
    LEFT JOIN public.leads l ON l.id = r.lead_id
    WHERE r.id = $1`,
    [runId]
  );

  const run = rows[0];
  if (!run) return;

  // Guard: if run cancelled or completed, stop
  if (['completed', 'cancelled', 'failed'].includes(run.status)) {
    return;
  }

  // Guard: if lead opted out (do_not_message)
  if (run.do_not_message) {
    console.log(`[Workflow Engine] Cancelling run ${runId}: Lead has do_not_message flag enabled`);
    await connectDB.query(
      `UPDATE public.workflow_runs 
       SET status = 'cancelled', completed_at = NOW(), error_message = 'Lead opted out (do_not_message)'
       WHERE id = $1`,
      [runId]
    );
    return;
  }

  // Parse steps list
  let steps = [];
  if (Array.isArray(run.steps)) {
    steps = run.steps;
  } else if (typeof run.steps === 'string') {
    try { steps = JSON.parse(run.steps); } catch (e) { steps = []; }
  }

  if (steps.length === 0) {
    await connectDB.query(
      `UPDATE public.workflow_runs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [runId]
    );
    return;
  }

  // Build / update live execution context
  const context = await buildWorkflowContext({
    companyId: run.company_id,
    leadId: run.lead_id,
    extraContext: run.context_data || {},
  });

  let currentIndex = Number(run.current_step_index || 0);

  // Mark run as active running
  await connectDB.query(
    `UPDATE public.workflow_runs SET status = 'running', updated_at = NOW() WHERE id = $1`,
    [runId]
  );

  // 2. Sequential Step Processing Loop
  while (currentIndex < steps.length) {
    const currentStep = steps[currentIndex];
    if (!currentStep) break;

    const stepType = String(currentStep.type || '').toLowerCase();

    // Guard: Bot collision protection on outbound messages
    if (['send_whatsapp_text', 'send_whatsapp_template'].includes(stepType)) {
      const botActive = await isBotActivelyEngaged(run.company_id, run.lead_id);
      if (botActive) {
        console.log(`[Workflow Engine] Postponing step for lead ${run.lead_id}: AI Bot is actively talking`);
        const delayUntil = new Date(Date.now() + 15 * 60 * 1000); // Wait 15 minutes
        await connectDB.query(
          `UPDATE public.workflow_runs 
           SET status = 'waiting', next_run_at = $1, current_step_id = $2, current_step_index = $3, updated_at = NOW()
           WHERE id = $4`,
          [delayUntil, currentStep.id || 'step', currentIndex, runId]
        );
        return;
      }

      // Guard: Daily WhatsApp Cap (Max 3/day)
      const capCheck = await checkDailyWhatsAppLimit(run.company_id, run.lead_id);
      if (!capCheck.allowed) {
        console.log(`[Workflow Engine] Daily WhatsApp limit (${DAILY_WHATSAPP_LIMIT}) reached for lead ${run.lead_id}`);
        // Push run to next morning 9:00 AM
        const nextMorning = new Date();
        nextMorning.setDate(nextMorning.getDate() + 1);
        nextMorning.setHours(9, 0, 0, 0);

        await connectDB.query(
          `UPDATE public.workflow_runs 
           SET status = 'waiting', next_run_at = $1, current_step_id = $2, current_step_index = $3, updated_at = NOW()
           WHERE id = $4`,
          [nextMorning, currentStep.id || 'step', currentIndex, runId]
        );
        return;
      }

      // Guard: Duplicate Template Protection
      if (stepType === 'send_whatsapp_template') {
        const tName = currentStep.config?.template_name || currentStep.config?.templateName;
        const isDup = await isDuplicateTemplate(run.company_id, run.lead_id, tName);
        if (isDup) {
          console.log(`[Workflow Engine] Duplicate template "${tName}" blocked for lead ${run.lead_id}`);
          // Move forward to next step instead of duplicating
          currentIndex++;
          continue;
        }
      }
    }

    // Execute step
    const stepResult = await executeWorkflowStep({
      step: currentStep,
      context,
      runId,
      companyId: run.company_id,
    });

    // Handle 'waiting' status (wait / wait_until)
    if (stepResult.status === 'waiting') {
      const nextRunAt = stepResult.next_run_at || new Date(Date.now() + 60000);
      await connectDB.query(
        `UPDATE public.workflow_runs 
         SET status = 'waiting', next_run_at = $1, current_step_id = $2, current_step_index = $3, updated_at = NOW()
         WHERE id = $4`,
        [nextRunAt, currentStep.id || `step-${currentIndex}`, currentIndex + 1, runId]
      );
      return; // Execution suspends until scheduler fires
    }

    // Handle branching (if_else)
    if (stepResult.status === 'branch') {
      const targetId = stepResult.next_step_id;
      if (targetId) {
        const foundIndex = steps.findIndex((s) => String(s.id) === String(targetId));
        if (foundIndex !== -1) {
          currentIndex = foundIndex;
          continue;
        }
      }
      // If branch step id not found, proceed sequentially
      currentIndex++;
      continue;
    }

    // Handle terminal step (end)
    if (stepType === 'end' || stepResult.output?.terminated) {
      await connectDB.query(
        `UPDATE public.workflow_runs 
         SET status = 'completed', completed_at = NOW(), current_step_index = $1, updated_at = NOW()
         WHERE id = $2`,
        [currentIndex, runId]
      );
      return;
    }

    // Handle step failure
    if (stepResult.status === 'failed') {
      console.warn(`[Workflow Engine] Step ${currentStep.id} failed in run ${runId}:`, stepResult.error);
      // If step failure is configured to halt workflow
      if (currentStep.config?.halt_on_error !== false) {
        await connectDB.query(
          `UPDATE public.workflow_runs 
           SET status = 'failed', completed_at = NOW(), error_message = $1, updated_at = NOW()
           WHERE id = $2`,
          [stepResult.error || 'Step execution failed', runId]
        );
        return;
      }
    }

    currentIndex++;
  }

  // All steps completed!
  await connectDB.query(
    `UPDATE public.workflow_runs 
     SET status = 'completed', completed_at = NOW(), current_step_index = $1, updated_at = NOW()
     WHERE id = $2`,
    [currentIndex, runId]
  );

  console.log(`[Workflow Engine] Workflow run ${runId} completed successfully.`);
}

/**
 * Triggers matching workflows for an incoming system event
 *
 * @param {object} triggerEvent
 *  {
 *    type: 'lead_created' | 'stage_changed' | ...,
 *    company_id: string,
 *    lead: object,
 *    previousLead?: object,
 *    payload?: object,
 *    userId?: string
 *  }
 */
export async function triggerWorkflowsForEvent(triggerEvent) {
  if (!triggerEvent || !triggerEvent.company_id || !triggerEvent.type) {
    return { triggered: 0, runs: [] };
  }

  const { company_id, type } = triggerEvent;

  try {
    // 1. Fetch all active workflows for this company and trigger type
    const { rows: workflows } = await connectDB.query(
      `SELECT * FROM public.workflows 
       WHERE company_id = $1 
         AND trigger_type = $2 
         AND is_active = true 
       ORDER BY created_at ASC`,
      [company_id, type]
    );

    if (workflows.length === 0) {
      return { triggered: 0, runs: [] };
    }

    const createdRuns = [];

    for (const wf of workflows) {
      // 2. Check full eligibility (trigger matcher + conditions group)
      const eligibility = await evaluateWorkflowEligibility(wf, triggerEvent);
      if (!eligibility.eligible) {
        continue;
      }

      const steps = Array.isArray(wf.steps) ? wf.steps : (typeof wf.steps === 'string' ? JSON.parse(wf.steps || '[]') : []);
      if (steps.length === 0) continue;

      const firstStep = steps[0];

      // 3. Create run record in public.workflow_runs
      const { rows: runRows } = await connectDB.query(
        `INSERT INTO public.workflow_runs (
          company_id, workflow_id, lead_id, status,
          current_step_id, current_step_index,
          trigger_event, started_at, created_at, updated_at
        ) VALUES ($1, $2, $3, 'running', $4, 0, $5::jsonb, NOW(), NOW(), NOW())
        RETURNING id`,
        [
          company_id,
          wf.id,
          triggerEvent.lead?.id || null,
          firstStep.id || 'step-0',
          JSON.stringify(triggerEvent),
        ]
      );

      const runId = runRows[0]?.id;
      if (runId) {
        createdRuns.push(runId);
        // Kick off execution asynchronously
        setImmediate(() => {
          runWorkflowExecution(runId).catch((err) => {
            console.error(`[Workflow Engine] Error executing run ${runId}:`, err);
          });
        });
      }
    }

    return { triggered: createdRuns.length, runs: createdRuns };
  } catch (err) {
    console.error('[Workflow Engine] Error triggering workflows:', err.message);
    return { triggered: 0, error: err.message };
  }
}

/**
 * Handles workflow stop rules (reply, agent takeover, stage change, opt-out)
 */
export async function handleStopRules({
  event,
  leadId,
  companyId,
  reason,
  newStage,
  messageText = '',
}) {
  if (!leadId || !companyId) return;

  try {
    const textLower = String(messageText || '').trim().toLowerCase();

    // 1. Opt-out / STOP keyword check
    if (['stop', 'unsubscribe', 'optout', 'opt-out', 'cancel'].includes(textLower)) {
      console.log(`[Workflow Engine] STOP keyword received from lead ${leadId}. Marking do_not_message = true.`);
      await connectDB.query(
        `UPDATE public.leads 
         SET do_not_message = true, updated_at = NOW() 
         WHERE id = $1 AND company_id = $2`,
        [leadId, companyId]
      );

      // Cancel ALL active or waiting runs for this lead
      await connectDB.query(
        `UPDATE public.workflow_runs 
         SET status = 'cancelled', completed_at = NOW(), error_message = 'Lead requested STOP (opt-out)', updated_at = NOW()
         WHERE lead_id = $1 AND company_id = $2 AND status IN ('running', 'waiting')`,
        [leadId, companyId]
      );
      return;
    }

    // 2. Lead Replied (stop_on_reply)
    if (event === 'reply') {
      await connectDB.query(
        `UPDATE public.workflow_runs r
         SET status = 'cancelled', completed_at = NOW(), error_message = 'Cancelled: Lead replied', updated_at = NOW()
         FROM public.workflows w
         WHERE r.workflow_id = w.id
           AND r.lead_id = $1
           AND r.company_id = $2
           AND r.status IN ('running', 'waiting')
           AND w.stop_on_reply = true`,
        [leadId, companyId]
      );
    }

    // 3. Agent Takeover (stop_on_agent_takeover)
    if (event === 'agent_takeover') {
      await connectDB.query(
        `UPDATE public.workflow_runs r
         SET status = 'cancelled', completed_at = NOW(), error_message = 'Cancelled: Agent took over', updated_at = NOW()
         FROM public.workflows w
         WHERE r.workflow_id = w.id
           AND r.lead_id = $1
           AND r.company_id = $2
           AND r.status IN ('running', 'waiting')
           AND w.stop_on_agent_takeover = true`,
        [leadId, companyId]
      );
    }

    // 4. Stage Change (stop_on_stage_change or Won/Lost)
    if (event === 'stage_change') {
      const isClosedStage = ['won', 'lost', 'closed won', 'closed lost'].includes(String(newStage || '').toLowerCase());
      
      await connectDB.query(
        `UPDATE public.workflow_runs r
         SET status = 'cancelled', completed_at = NOW(), error_message = $3, updated_at = NOW()
         FROM public.workflows w
         WHERE r.workflow_id = w.id
           AND r.lead_id = $1
           AND r.company_id = $2
           AND r.status IN ('running', 'waiting')
           AND (w.stop_on_stage_change = true OR $4 = true)`,
        [leadId, companyId, `Cancelled: Lead stage changed to ${newStage}`, isClosedStage]
      );
    }
  } catch (err) {
    console.error('[Workflow Engine] Error handling stop rules:', err.message);
  }
}
