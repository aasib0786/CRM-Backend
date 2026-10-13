/**
 * Knex Migration: Workflows Module (Phase 1)
 * Creates:
 *  - workflows: Automated WhatsApp/lead workflow definitions with triggers, conditions, and steps
 *  - workflow_runs: State tracking for individual lead workflow executions
 *  - workflow_run_logs: Detailed audit log of every step execution
 *  - Indexes for PM2 background worker (status, next_run_at) and multi-tenant queries
 *  - do_not_message opt-out column on public.leads
 */

exports.up = async function (knex) {
  await knex.raw(`
    -- 1. workflows
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

    -- Ensure all columns exist if table already existed partially
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

    -- 2. workflow_runs
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

    -- 3. workflow_run_logs
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

    -- 4. Ensure leads table has do_not_message opt-out flag
    ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS do_not_message BOOLEAN DEFAULT false;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.workflow_run_logs CASCADE;
    DROP TABLE IF EXISTS public.workflow_runs CASCADE;
    DROP TABLE IF EXISTS public.workflows CASCADE;
  `);
};
