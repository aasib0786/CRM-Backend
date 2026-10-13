/**
 * Workflow Dry-Run Simulation Engine (Phase 5)
 * Simulates workflow execution step-by-step on a real or mock lead
 * WITHOUT sending real WhatsApp/emails, calling external webhooks, or mutating database state.
 */

import connectDB from '../pool.js';
import { buildWorkflowContext, interpolateVariables } from './workflow-variables.js';
import { evaluateConditionsGroup } from './workflow-conditions.js';
import { isCustomerServiceWindowOpen, calculateWaitTime, calculateWaitUntilTime } from './workflow-actions.js';

/**
 * Simulates a single workflow step execution safely in-memory
 */
export async function simulateWorkflowStep({ step, context, companyId }) {
  const stepType = String(step.type || '').toLowerCase().trim();
  const config = step.config || {};
  const lead = context.lead || {};

  switch (stepType) {
    case 'send_whatsapp_template': {
      const templateName = interpolateVariables(config.template_name || config.templateName || '', context);
      const rawParams = Array.isArray(config.body_params) ? config.body_params : (config.params || []);
      const interpolatedParams = rawParams.map((p) => interpolateVariables(String(p), context));

      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: 'Would send WhatsApp Template',
        details: {
          recipient_phone: lead.phone || 'Unknown phone',
          template_name: templateName,
          parameters: interpolatedParams,
          simulated_delivery: 'Simulated via Meta Cloud API',
        },
      };
    }

    case 'send_whatsapp_text': {
      const messageText = interpolateVariables(config.message || config.text || '', context);
      const windowOpen = await isCustomerServiceWindowOpen(lead.phone, companyId);

      let action = 'Would send WhatsApp plain text message';
      let note = '24-hour customer service window is OPEN';
      let fallbackUsed = false;

      if (!windowOpen) {
        if (config.fallback_template) {
          action = `Would send Fallback Template: "${config.fallback_template}"`;
          note = '24-hour customer service window is CLOSED. Safe fallback template selected to prevent Meta 131047 error.';
          fallbackUsed = true;
        } else {
          action = 'Step would be SKIPPED';
          note = '24-hour customer service window is CLOSED and no fallback template was provided.';
        }
      }

      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: !windowOpen && !config.fallback_template ? 'simulated_skip' : 'simulated_success',
        action,
        details: {
          recipient_phone: lead.phone || 'Unknown phone',
          evaluated_message: messageText,
          customer_service_window_open: windowOpen,
          fallback_template: config.fallback_template || null,
          note,
        },
      };
    }

    case 'send_email': {
      const toEmail = interpolateVariables(config.to || lead.email || '', context);
      const subject = interpolateVariables(config.subject || '', context);
      const body = interpolateVariables(config.body || config.html || '', context);

      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: toEmail ? 'simulated_success' : 'simulated_skip',
        action: toEmail ? 'Would send Email' : 'Skipped (No recipient email)',
        details: {
          to: toEmail,
          subject,
          body_preview: body.slice(0, 150) + (body.length > 150 ? '...' : ''),
        },
      };
    }

    case 'wait': {
      const waitDate = calculateWaitTime(config);
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_pause',
        action: `Would pause workflow for ${config.duration || 1} ${config.unit || 'minutes'}`,
        details: {
          duration: config.duration || 1,
          unit: config.unit || 'minutes',
          resumes_at: waitDate.toISOString(),
          respect_quiet_hours: config.respect_quiet_hours ?? false,
        },
        resumes_at: waitDate,
      };
    }

    case 'wait_until': {
      const targetDate = calculateWaitUntilTime(config);
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_pause',
        action: `Would pause workflow until ${config.time || 'target time'}`,
        details: {
          scheduled_for: targetDate.toISOString(),
          days: config.days || 'any',
          respect_quiet_hours: config.respect_quiet_hours ?? true,
        },
        resumes_at: targetDate,
      };
    }

    case 'if_else': {
      const conditionsGroup = config.conditions || { all: config.rules || [] };
      const passed = evaluateConditionsGroup(conditionsGroup, lead, context);
      const nextStepId = passed
        ? (config.then_step_id || config.thenStepId)
        : (config.else_step_id || config.elseStepId);

      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_branch',
        action: `Condition evaluated to ${passed ? 'TRUE (Then branch)' : 'FALSE (Else branch)'}`,
        details: {
          condition_passed: passed,
          branch: passed ? 'then' : 'else',
          next_step_id: nextStepId || 'Next sequential step',
        },
        nextStepId,
      };
    }

    case 'assign_agent': {
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would assign lead to agent`,
        details: {
          mode: config.mode || 'specific',
          agent_name: config.agent_name || (config.mode === 'round_robin' ? 'Next Round-Robin Agent' : 'Assigned Agent'),
        },
      };
    }

    case 'change_stage': {
      const stageName = interpolateVariables(config.stage || '', context);
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would update pipeline stage`,
        details: {
          previous_stage: lead.stage || 'Current',
          new_stage: stageName,
        },
      };
    }

    case 'add_tag': {
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would attach tag "${config.tag}" to lead`,
        details: { tag: config.tag },
      };
    }

    case 'remove_tag': {
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would remove tag "${config.tag}" from lead`,
        details: { tag: config.tag },
      };
    }

    case 'create_task': {
      const taskTitle = interpolateVariables(config.title || '', context);
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would create follow-up task for agent`,
        details: {
          title: taskTitle,
          due_in_hours: config.due_in_hours || 24,
        },
      };
    }

    case 'notify_agent': {
      const alertTitle = interpolateVariables(config.title || '', context);
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would dispatch in-app alert to sales agent`,
        details: { title: alertTitle },
      };
    }

    case 'start_bot': {
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: 'Would resume AI Sales Bot for lead',
        details: { bot_status: 'active' },
      };
    }

    case 'stop_bot': {
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: 'Would pause AI Sales Bot for lead',
        details: { bot_status: 'paused' },
      };
    }

    case 'webhook': {
      const url = interpolateVariables(config.url || '', context);
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_success',
        action: `Would send HTTP ${config.method || 'POST'} to webhook`,
        details: { url, method: config.method || 'POST' },
      };
    }

    case 'end': {
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_end',
        action: 'Terminates workflow execution cleanly',
        details: { is_terminal: true },
      };
    }

    default:
      return {
        stepId: step.id,
        type: stepType,
        title: step.title,
        status: 'simulated_unknown',
        action: `Step type ${stepType}`,
        details: config,
      };
  }
}

/**
 * Runs a complete dry-run simulation of a workflow on a lead
 *
 * @param {object} params
 * @param {object} [params.workflow] - In-memory or unsaved workflow object
 * @param {string} [params.workflowId] - Saved workflow UUID
 * @param {string} [params.leadId] - Existing lead UUID to simulate with
 * @param {object} [params.mockLead] - Custom test lead object
 * @param {string} params.companyId - Multi-tenant Company UUID
 * @returns {Promise<object>} Simulation report with step logs and branching
 */
export async function runWorkflowDryRun({
  workflow = null,
  workflowId = null,
  leadId = null,
  mockLead = null,
  companyId,
}) {
  let wf = workflow;

  // 1. Fetch saved workflow if workflowId is passed
  if (!wf && workflowId) {
    const { rows } = await connectDB.query(
      `SELECT * FROM public.workflows WHERE id = $1 AND company_id = $2`,
      [workflowId, companyId]
    );
    wf = rows[0] || null;
  }

  if (!wf) {
    throw new Error('Workflow definition or valid workflowId is required for dry-run simulation');
  }

  // 2. Resolve lead record
  let lead = mockLead;
  if (!lead && leadId) {
    const { rows } = await connectDB.query(
      `SELECT * FROM public.leads WHERE id = $1 AND company_id = $2`,
      [leadId, companyId]
    );
    lead = rows[0] || null;
  }

  // Fallback demo lead if none exists
  if (!lead) {
    lead = {
      id: 'demo-lead-id',
      name: 'Rohan Sharma',
      phone: '+919876543210',
      email: 'rohan.sharma@example.com',
      stage: 'New Inquiry',
      score: 75,
      budget: '85 Lakhs',
      source: 'Website',
      tags: ['Website', 'High-Intent'],
      company_id: companyId,
    };
  }

  // 3. Build execution context
  const context = await buildWorkflowContext({
    companyId,
    leadId: lead.id,
    lead,
    extraContext: { dryRun: true },
  });

  // 4. Check global conditions eligibility
  const conditions = wf.conditions || {};
  const isEligible = evaluateConditionsGroup(conditions, context.lead, context);

  const simulationReport = {
    workflowName: wf.name || 'Untitled Workflow',
    triggerType: wf.trigger_type || 'lead_created',
    simulatedLead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      stage: lead.stage,
      score: lead.score,
    },
    conditionsMatched: isEligible,
    stepsSimulated: [],
    terminalReason: null,
  };

  if (!isEligible) {
    simulationReport.terminalReason = 'Lead does not satisfy configured workflow filter conditions';
    return simulationReport;
  }

  // 5. Simulate sequential step execution
  let steps = [];
  if (Array.isArray(wf.steps)) {
    steps = wf.steps;
  } else if (typeof wf.steps === 'string') {
    try { steps = JSON.parse(wf.steps); } catch (e) { steps = []; }
  }

  let currentIndex = 0;
  const maxIterations = 50; // Guard against infinite branch loops
  let iteration = 0;

  while (currentIndex < steps.length && iteration < maxIterations) {
    iteration++;
    const step = steps[currentIndex];
    if (!step) break;

    const stepResult = await simulateWorkflowStep({ step, context, companyId });
    simulationReport.stepsSimulated.push(stepResult);

    if (step.type === 'end' || stepResult.details?.is_terminal) {
      simulationReport.terminalReason = 'Reached End step';
      break;
    }

    if (step.type === 'if_else' && stepResult.nextStepId) {
      const branchIndex = steps.findIndex((s) => String(s.id) === String(stepResult.nextStepId));
      if (branchIndex !== -1) {
        currentIndex = branchIndex;
        continue;
      }
    }

    currentIndex++;
  }

  if (iteration >= maxIterations) {
    simulationReport.terminalReason = 'Max simulation steps limit reached';
  } else if (!simulationReport.terminalReason) {
    simulationReport.terminalReason = 'All steps simulated successfully to completion';
  }

  return simulationReport;
}
