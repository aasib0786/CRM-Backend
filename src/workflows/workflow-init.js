/**
 * Workflows Database Initializer (Phase 1)
 * Creates and verifies:
 *  - workflows: Automated workflow definitions (trigger_type, trigger_config, conditions, steps, allow_reentry, stop_on_reply)
 *  - workflow_runs: Per-lead run state (status, current_step_index, next_run_at, stop_reason)
 *  - workflow_run_logs: Step-by-step audit logs (step_index, step_type, status, detail)
 *  - PM2 worker index on (status, next_run_at) and multi-tenant indexes
 *  - do_not_message opt-out column on public.leads
 */

import connectDB from '../pool.js';

export async function initWorkflowsDb() {
  try {
    console.log('⚡ Checking & Initializing Workflows Tables (Phase 1)...');

    // 1. workflows table
    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.workflows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true NOT NULL,
        trigger_type VARCHAR(50) NOT NULL,
        trigger_config JSONB DEFAULT '{}'::jsonb NOT NULL,
        conditions JSONB DEFAULT '{"all":[],"any":[]}'::jsonb NOT NULL,
        steps JSONB DEFAULT '[]'::jsonb NOT NULL,
        allow_reentry BOOLEAN DEFAULT false NOT NULL,
        stop_on_reply BOOLEAN DEFAULT true NOT NULL,
        created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Ensure all required columns exist in case table was partially created
    await connectDB.query(`
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS company_id UUID;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(50) DEFAULT 'lead_created';
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS trigger_config JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '{"all":[],"any":[]}'::jsonb;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS allow_reentry BOOLEAN DEFAULT false;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS stop_on_reply BOOLEAN DEFAULT true;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS created_by UUID;
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

      CREATE INDEX IF NOT EXISTS idx_workflows_company_active ON public.workflows(company_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_workflows_company_trigger ON public.workflows(company_id, trigger_type);
    `);

    // 2. workflow_runs table
    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.workflow_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
        lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'running' NOT NULL,
        current_step_index INT DEFAULT 0 NOT NULL,
        next_run_at TIMESTAMPTZ,
        stop_reason TEXT,
        started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT chk_workflow_run_status CHECK (status IN ('running', 'waiting', 'completed', 'stopped', 'failed'))
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_next ON public.workflow_runs(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_comp_lead_wf ON public.workflow_runs(company_id, lead_id, workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_company_status ON public.workflow_runs(company_id, status);
    `);

    // 3. workflow_run_logs table
    await connectDB.query(`
      CREATE TABLE IF NOT EXISTS public.workflow_run_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        run_id UUID NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
        step_index INT NOT NULL,
        step_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        detail JSONB DEFAULT '{}'::jsonb NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT chk_workflow_run_log_status CHECK (status IN ('success', 'skipped', 'failed'))
      );

      CREATE INDEX IF NOT EXISTS idx_wf_run_logs_comp_run ON public.workflow_run_logs(company_id, run_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_wf_run_logs_comp_executed ON public.workflow_run_logs(company_id, executed_at DESC);
    `);

    // 4. Ensure leads opt-out column
    await connectDB.query(`
      ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS do_not_message BOOLEAN DEFAULT false;
    console.log('✅ Workflows database tables, indexes and constraints initialized successfully.');

    // Seed default demo workflows for existing companies if empty
    await seedDefaultWorkflows();
  } catch (err) {
    console.error('❌ Error initializing Workflows DB:', err.message);
    throw err;
  }
}

/**
 * Seeds default production workflow templates for companies that have no workflows configured yet.
 */
export async function seedDefaultWorkflows() {
  try {
    const { rows: companies } = await connectDB.query(`SELECT id, name FROM public.companies LIMIT 20`);
    if (companies.length === 0) return;

    const { PREMADE_WORKFLOW_TEMPLATES } = await import('./workflow-templates.js');

    for (const company of companies) {
      const { rows: existing } = await connectDB.query(
        `SELECT COUNT(*)::int AS count FROM public.workflows WHERE company_id = $1`,
        [company.id]
      );

      if ((existing[0]?.count || 0) === 0) {
        console.log(`[Workflows Seeder] Seeding pre-built workflows for company: "${company.name}" (${company.id})`);

        for (let i = 0; i < PREMADE_WORKFLOW_TEMPLATES.length; i++) {
          const tpl = PREMADE_WORKFLOW_TEMPLATES[i];
          const isActive = i < 2; // First 2 active by default, rest paused

          await connectDB.query(
            `INSERT INTO public.workflows (
              company_id, name, description, is_active, trigger_type,
              trigger_config, conditions, steps,
              stop_on_reply, stop_on_agent_takeover, stop_on_stage_change,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, NOW(), NOW())`,
            [
              company.id,
              tpl.name,
              tpl.description,
              isActive,
              tpl.trigger_type,
              JSON.stringify(tpl.trigger_config || {}),
              JSON.stringify(tpl.conditions || {}),
              JSON.stringify(tpl.steps || []),
              tpl.stop_on_reply ?? true,
              tpl.stop_on_agent_takeover ?? true,
              tpl.stop_on_stage_change ?? true,
            ]
          );
        }
      }
    }
  } catch (seedErr) {
    console.warn('[Workflows Seeder] Seeding warning:', seedErr.message);
  }
}

