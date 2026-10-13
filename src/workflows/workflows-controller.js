/**
 * Workflows REST API Controller (Phase 4)
 * Multi-tenant, scoped by company_id, with runs history, step logs,
 * template instantiation, and manual trigger support.
 */

import connectDB from '../pool.js';
import { PREMADE_WORKFLOW_TEMPLATES } from './workflow-templates.js';
import { emitManualTrigger } from './workflow-events.js';

/**
 * Resolves the authenticated company ID from request or database fallback
 */
async function getCompanyId(req) {
  let compId = req.company_id || req.user?.company_id || req.query?.company_id || req.headers?.['x-company-id'];
  if (!compId) {
    const { rows } = await connectDB.query(`SELECT id FROM public.companies LIMIT 1`);
    compId = rows[0]?.id || '00000000-0000-0000-0000-000000000001';
  }
  return compId;
}

/**
 * GET /api/v1/workflows
 * Lists all workflows for company with aggregate execution statistics
 */
export const getWorkflows = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);

    const { rows } = await connectDB.query(
      `SELECT 
        w.*,
        COALESCE(COUNT(r.id), 0)::int AS total_runs,
        COALESCE(COUNT(CASE WHEN r.status IN ('running', 'waiting') THEN 1 END), 0)::int AS active_runs,
        COALESCE(COUNT(CASE WHEN r.status = 'completed' THEN 1 END), 0)::int AS completed_runs,
        COALESCE(COUNT(CASE WHEN r.status = 'failed' THEN 1 END), 0)::int AS failed_runs,
        MAX(r.created_at) AS last_triggered_at
       FROM public.workflows w
       LEFT JOIN public.workflow_runs r ON r.workflow_id = w.id
       WHERE w.company_id = $1
       GROUP BY w.id
       ORDER BY w.created_at DESC`,
      [companyId]
    );

    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('getWorkflows error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/v1/workflows/templates
 * Returns list of pre-built workflow templates
 */
export const getWorkflowTemplates = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      count: PREMADE_WORKFLOW_TEMPLATES.length,
      data: PREMADE_WORKFLOW_TEMPLATES,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/v1/workflows/from-template
 * Instantiates a template into an active workflow for the company
 */
export const createWorkflowFromTemplate = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { template_id, name } = req.body;

    const template = PREMADE_WORKFLOW_TEMPLATES.find((t) => t.id === template_id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const wfName = name || template.name;
    const { rows } = await connectDB.query(
      `INSERT INTO public.workflows (
        company_id, name, description, is_active, trigger_type,
        trigger_config, conditions, steps,
        stop_on_reply, stop_on_agent_takeover, stop_on_stage_change,
        created_at, updated_at
      ) VALUES ($1, $2, $3, true, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        companyId,
        wfName,
        template.description,
        template.trigger_type,
        JSON.stringify(template.trigger_config || {}),
        JSON.stringify(template.conditions || {}),
        JSON.stringify(template.steps || []),
        template.stop_on_reply ?? true,
        template.stop_on_agent_takeover ?? true,
        template.stop_on_stage_change ?? true,
      ]
    );

    return res.status(201).json({
      success: true,
      message: `Workflow created from template "${template.name}"`,
      data: rows[0],
    });
  } catch (err) {
    console.error('createWorkflowFromTemplate error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/v1/workflows/:id
 * Fetches a single workflow by ID
 */
export const getWorkflowById = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { id } = req.params;

    const { rows } = await connectDB.query(
      `SELECT * FROM public.workflows WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workflow not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/v1/workflows
 * Creates a new custom workflow
 */
export const createWorkflow = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const {
      name,
      description,
      trigger_type = 'lead_created',
      trigger_config = {},
      conditions = {},
      steps = [],
      is_active = true,
      stop_on_reply = true,
      stop_on_agent_takeover = true,
      stop_on_stage_change = true,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Workflow name is required' });
    }

    const { rows } = await connectDB.query(
      `INSERT INTO public.workflows (
        company_id, name, description, is_active, trigger_type,
        trigger_config, conditions, steps,
        stop_on_reply, stop_on_agent_takeover, stop_on_stage_change,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, NOW(), NOW())
      RETURNING *`,
      [
        companyId,
        name.trim(),
        description || null,
        Boolean(is_active),
        trigger_type,
        JSON.stringify(trigger_config),
        JSON.stringify(conditions),
        JSON.stringify(steps),
        Boolean(stop_on_reply),
        Boolean(stop_on_agent_takeover),
        Boolean(stop_on_stage_change),
      ]
    );

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('createWorkflow error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/v1/workflows/:id
 * Updates an existing workflow
 */
export const updateWorkflow = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { id } = req.params;
    const {
      name,
      description,
      trigger_type,
      trigger_config,
      conditions,
      steps,
      is_active,
      stop_on_reply,
      stop_on_agent_takeover,
      stop_on_stage_change,
    } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.workflows SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        trigger_type = COALESCE($3, trigger_type),
        trigger_config = COALESCE($4::jsonb, trigger_config),
        conditions = COALESCE($5::jsonb, conditions),
        steps = COALESCE($6::jsonb, steps),
        is_active = COALESCE($7, is_active),
        stop_on_reply = COALESCE($8, stop_on_reply),
        stop_on_agent_takeover = COALESCE($9, stop_on_agent_takeover),
        stop_on_stage_change = COALESCE($10, stop_on_stage_change),
        updated_at = NOW()
       WHERE id = $11 AND company_id = $12
       RETURNING *`,
      [
        name,
        description,
        trigger_type,
        trigger_config ? JSON.stringify(trigger_config) : null,
        conditions ? JSON.stringify(conditions) : null,
        steps ? JSON.stringify(steps) : null,
        is_active,
        stop_on_reply,
        stop_on_agent_takeover,
        stop_on_stage_change,
        id,
        companyId,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workflow not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('updateWorkflow error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/v1/workflows/:id/toggle
 * Fast toggle of active status
 */
export const toggleWorkflow = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { id } = req.params;

    const { rows } = await connectDB.query(
      `UPDATE public.workflows 
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id, name, is_active`,
      [id, companyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workflow not found' });
    }

    return res.status(200).json({
      success: true,
      message: `Workflow ${rows[0].is_active ? 'activated' : 'paused'}`,
      data: rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/v1/workflows/:id
 * Deletes a workflow and cascades its runs and logs
 */
export const deleteWorkflow = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { id } = req.params;

    const { rowCount } = await connectDB.query(
      `DELETE FROM public.workflows WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Workflow not found' });
    }

    return res.status(200).json({ success: true, message: 'Workflow deleted successfully' });
  } catch (err) {
    console.error('deleteWorkflow error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/v1/workflows/:id/trigger
 * Manually executes a workflow on a specific lead
 */
export const triggerWorkflowManual = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { id } = req.params;
    const { lead_id } = req.body;

    if (!lead_id) {
      return res.status(400).json({ success: false, message: 'lead_id is required' });
    }

    const result = await emitManualTrigger(id, lead_id, companyId, req.user?.id);
    return res.status(200).json({
      success: true,
      message: 'Workflow execution triggered successfully',
      data: result,
    });
  } catch (err) {
    console.error('triggerWorkflowManual error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/v1/workflows/:id/runs
 * Retrieves historical execution runs for a workflow
 */
export const getWorkflowRuns = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { id } = req.params;
    const limit = Math.min(100, Number(req.query.limit || 50));
    const offset = Number(req.query.offset || 0);

    const { rows } = await connectDB.query(
      `SELECT 
        r.*,
        l.name AS lead_name,
        l.phone AS lead_phone,
        l.stage AS lead_stage,
        ROUND(EXTRACT(EPOCH FROM (COALESCE(r.completed_at, NOW()) - r.started_at)))::int AS duration_seconds
       FROM public.workflow_runs r
       LEFT JOIN public.leads l ON l.id = r.lead_id
       WHERE r.workflow_id = $1 AND r.company_id = $2
       ORDER BY r.created_at DESC
       LIMIT $3 OFFSET $4`,
      [id, companyId, limit, offset]
    );

    const countRes = await connectDB.query(
      `SELECT COUNT(*)::int AS total FROM public.workflow_runs WHERE workflow_id = $1 AND company_id = $2`,
      [id, companyId]
    );

    return res.status(200).json({
      success: true,
      total: countRes.rows[0]?.total || 0,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error('getWorkflowRuns error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/v1/workflows/runs/:runId
 * Retrieves detailed step execution audit logs for a single run
 */
export const getWorkflowRunDetails = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { runId } = req.params;

    const runRes = await connectDB.query(
      `SELECT 
        r.*,
        w.name AS workflow_name,
        l.name AS lead_name,
        l.phone AS lead_phone
       FROM public.workflow_runs r
       JOIN public.workflows w ON w.id = r.workflow_id
       LEFT JOIN public.leads l ON l.id = r.lead_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [runId, companyId]
    );

    if (runRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Workflow run not found' });
    }

    const { rows: logs } = await connectDB.query(
      `SELECT * FROM public.workflow_run_logs 
       WHERE run_id = $1 AND company_id = $2
       ORDER BY executed_at ASC`,
      [runId, companyId]
    );

    return res.status(200).json({
      success: true,
      data: {
        run: runRes.rows[0],
        logs,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/v1/workflows/runs/:runId/cancel
 * Cancels an active or waiting workflow run
 */
export const cancelWorkflowRun = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { runId } = req.params;

    const { rows } = await connectDB.query(
      `UPDATE public.workflow_runs 
       SET status = 'cancelled', completed_at = NOW(), error_message = 'Cancelled manually by user'
       WHERE id = $1 AND company_id = $2 AND status IN ('running', 'waiting')
       RETURNING id, status`,
      [runId, companyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Active or waiting run not found to cancel' });
    }

    return res.status(200).json({
      success: true,
      message: 'Workflow run cancelled successfully',
      data: rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/v1/workflows/lead/:leadId
 * Retrieves all workflow executions for a specific lead (for lead detail widget)
 */
export const getLeadWorkflowRuns = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { leadId } = req.params;

    const { rows } = await connectDB.query(
      `SELECT 
        r.id AS run_id,
        r.status,
        r.current_step_id,
        r.current_step_index,
        r.next_run_at,
        r.started_at,
        r.completed_at,
        r.error_message,
        w.id AS workflow_id,
        w.name AS workflow_name,
        w.trigger_type
       FROM public.workflow_runs r
       JOIN public.workflows w ON w.id = r.workflow_id
       WHERE r.lead_id = $1 AND r.company_id = $2
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [leadId, companyId]
    );

    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/v1/workflows/dry-run
 * Simulates workflow execution without modifying DB or sending messages
 */
export const runDryRunSimulation = async (req, res) => {
  try {
    const companyId = await getCompanyId(req);
    const { workflow, workflowId, leadId, mockLead } = req.body;
    const { runWorkflowDryRun } = await import('./workflow-dryrun.js');

    const report = await runWorkflowDryRun({
      workflow,
      workflowId,
      leadId,
      mockLead,
      companyId,
    });

    return res.status(200).json({ success: true, data: report });
  } catch (err) {
    console.error('runDryRunSimulation error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

