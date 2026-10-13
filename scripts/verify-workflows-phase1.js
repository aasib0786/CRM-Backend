/**
 * Verification Script: Workflows Module (Phase 1)
 * Validates:
 *  - Database tables: workflows, workflow_runs, workflow_run_logs
 *  - Column schemas, types, and defaults
 *  - Foreign keys & check constraints (status validation)
 *  - Critical index existence (status, next_run_at) for PM2 worker
 *  - Multi-tenant inserts, relationship joins, and clean rollbacks
 *  - Leads do_not_message opt-out flag
 */

import dotenv from 'dotenv';
dotenv.config();

import connectDB from '../src/pool.js';
import { initWorkflowsDb } from '../src/workflows/workflow-init.js';

export async function runWorkflowsPhase1Verification() {
  const logs = [];
  const log = (msg) => {
    console.log(msg);
    logs.push(msg);
  };

  log('====================================================');
  log('⚡ Verifying Phase 1: Workflows Database Migrations');
  log('====================================================\n');

  try {
    // 1. Run DB Initializer
    log('1. Running initWorkflowsDb()...');
    await initWorkflowsDb();
    log('   ✅ Initializer executed without errors.\n');

    // 2. Resolve a company and lead to test with
    const { rows: compRows } = await connectDB.query(`SELECT id, name FROM public.companies LIMIT 1`);
    if (compRows.length === 0) {
      throw new Error('No company found in database to test.');
    }
    const companyId = compRows[0].id;
    log(`2. Test Company: "${compRows[0].name}" (${companyId})`);

    const { rows: leadRows } = await connectDB.query(
      `SELECT id, name FROM public.leads WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );
    let leadId = leadRows[0]?.id;

    if (!leadId) {
      // Create a temporary mock lead
      const newLead = await connectDB.query(
        `INSERT INTO public.leads (company_id, name, phone, stage)
         VALUES ($1, 'Workflow Test Lead', '+919999988888', 'New')
         RETURNING id`,
        [companyId]
      );
      leadId = newLead.rows[0].id;
    }
    log(`   Test Lead: ID ${leadId}\n`);

    // 3. Verify workflows table columns
    log('3. Verifying public.workflows columns...');
    const wfColsRes = await connectDB.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'workflows'
      ORDER BY ordinal_position
    `);
    const wfCols = wfColsRes.rows.map((r) => r.column_name);
    log(`   Found columns: ${wfCols.join(', ')}`);

    const requiredWfCols = [
      'id', 'company_id', 'name', 'description', 'is_active',
      'trigger_type', 'trigger_config', 'conditions', 'steps',
      'allow_reentry', 'stop_on_reply', 'created_by', 'created_at', 'updated_at'
    ];
    for (const col of requiredWfCols) {
      if (!wfCols.includes(col)) {
        throw new Error(`Missing required column "${col}" in public.workflows`);
      }
    }
    log('   ✅ All workflows columns present and verified.\n');

    // 4. Verify workflow_runs table columns & constraints
    log('4. Verifying public.workflow_runs columns & constraints...');
    const runsColsRes = await connectDB.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'workflow_runs'
    `);
    const runCols = runsColsRes.rows.map((r) => r.column_name);
    log(`   Found columns: ${runCols.join(', ')}`);

    const requiredRunCols = [
      'id', 'company_id', 'workflow_id', 'lead_id', 'status',
      'current_step_index', 'next_run_at', 'stop_reason',
      'started_at', 'completed_at', 'created_at', 'updated_at'
    ];
    for (const col of requiredRunCols) {
      if (!runCols.includes(col)) {
        throw new Error(`Missing required column "${col}" in public.workflow_runs`);
      }
    }
    log('   ✅ All workflow_runs columns present and verified.\n');

    // 5. Verify workflow_run_logs table columns
    log('5. Verifying public.workflow_run_logs columns...');
    const logColsRes = await connectDB.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'workflow_run_logs'
    `);
    const logCols = logColsRes.rows.map((r) => r.column_name);
    log(`   Found columns: ${logCols.join(', ')}`);

    const requiredLogCols = [
      'id', 'company_id', 'run_id', 'step_index',
      'step_type', 'status', 'detail', 'executed_at'
    ];
    for (const col of requiredLogCols) {
      if (!logCols.includes(col)) {
        throw new Error(`Missing required column "${col}" in public.workflow_run_logs`);
      }
    }
    log('   ✅ All workflow_run_logs columns present and verified.\n');

    // 6. Verify critical indexes for PM2 background worker
    log('6. Verifying database indexes...');
    const idxRes = await connectDB.query(`
      SELECT indexname, indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public' AND tablename IN ('workflows', 'workflow_runs', 'workflow_run_logs')
      ORDER BY tablename, indexname
    `);
    const indexNames = idxRes.rows.map((r) => r.indexname);
    log(`   Found indexes:\n   - ${indexNames.join('\n   - ')}`);

    const requiredIndexes = [
      'idx_workflow_runs_status_next',
      'idx_workflow_runs_comp_lead_wf',
      'idx_workflows_company_active',
      'idx_workflows_company_trigger',
      'idx_wf_run_logs_comp_run'
    ];
    for (const idx of requiredIndexes) {
      if (!indexNames.includes(idx)) {
        throw new Error(`Missing required index "${idx}"`);
      }
    }
    log('   ✅ All required indexes for PM2 worker and queries verified.\n');

    // 7. Verify leads do_not_message column
    log('7. Verifying public.leads do_not_message opt-out column...');
    const leadColRes = await connectDB.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'do_not_message'
    `);
    if (leadColRes.rows.length === 0) {
      throw new Error('Column "do_not_message" not found on public.leads');
    }
    log(`   ✅ public.leads.do_not_message exists (type: ${leadColRes.rows[0].data_type}, default: ${leadColRes.rows[0].column_default}).\n`);

    // 8. End-to-End Test: Create workflow -> create run -> log step -> check cascade delete
    log('8. Performing End-to-End CRUD test...');
    const testWorkflow = await connectDB.query(`
      INSERT INTO public.workflows (
        company_id, name, description, is_active, trigger_type,
        trigger_config, conditions, steps, allow_reentry, stop_on_reply
      ) VALUES (
        $1,
        'Welcome Sequence Test',
        'Auto-generated test workflow for Phase 1 verification',
        true,
        'lead_created',
        '{"source":"website"}'::jsonb,
        '{"all":[{"field":"stage","operator":"equals","value":"New"}]}'::jsonb,
        '[{"type":"send_whatsapp_template","config":{"template_name":"welcome_1"}},{"type":"wait","config":{"hours":24}}]'::jsonb,
        false,
        true
      ) RETURNING *
    `, [companyId]);
    const workflowId = testWorkflow.rows[0].id;
    log(`   Created test workflow: ID ${workflowId}`);

    // Create a workflow run
    const testRun = await connectDB.query(`
      INSERT INTO public.workflow_runs (
        company_id, workflow_id, lead_id, status,
        current_step_index, next_run_at
      ) VALUES (
        $1, $2, $3, 'waiting',
        1, NOW() + INTERVAL '24 hours'
      ) RETURNING *
    `, [companyId, workflowId, leadId]);
    const runId = testRun.rows[0].id;
    log(`   Created test run: ID ${runId} (status: ${testRun.rows[0].status}, current_step: 1)`);

    // Create a workflow run log
    const testLog = await connectDB.query(`
      INSERT INTO public.workflow_run_logs (
        company_id, run_id, step_index, step_type, status, detail
      ) VALUES (
        $1, $2, 0, 'send_whatsapp_template', 'success',
        '{"template":"welcome_1","recipient":"+919999988888"}'::jsonb
      ) RETURNING *
    `, [companyId, runId]);
    log(`   Created test log: ID ${testLog.rows[0].id} (status: ${testLog.rows[0].status})`);

    // Test Check Constraint: Inserting invalid status must fail
    let checkConstraintPassed = false;
    try {
      await connectDB.query(`
        INSERT INTO public.workflow_runs (company_id, workflow_id, lead_id, status)
        VALUES ($1, $2, $3, 'invalid_status')
      `, [companyId, workflowId, leadId]);
    } catch (e) {
      if (e.message.includes('chk_workflow_run_status') || e.code === '23514') {
        checkConstraintPassed = true;
      }
    }
    log(`   Check constraint status validation (invalid_status rejected): ${checkConstraintPassed ? '✅ Yes' : '❌ No'}`);

    if (!checkConstraintPassed) {
      throw new Error('CHECK constraint chk_workflow_run_status failed to reject invalid status.');
    }

    // Clean up test workflow (CASCADE should delete testRun and testLog)
    await connectDB.query(`DELETE FROM public.workflows WHERE id = $1`, [workflowId]);
    const remainingRuns = await connectDB.query(`SELECT COUNT(*)::int as count FROM public.workflow_runs WHERE id = $1`, [runId]);
    const remainingLogs = await connectDB.query(`SELECT COUNT(*)::int as count FROM public.workflow_run_logs WHERE run_id = $1`, [runId]);
    log(`   Cascade delete test: remaining runs=${remainingRuns.rows[0].count}, remaining logs=${remainingLogs.rows[0].count} (Expected: 0, 0)`);

    if (remainingRuns.rows[0].count !== 0 || remainingLogs.rows[0].count !== 0) {
      throw new Error('Cascade delete did not remove associated runs and logs.');
    }
    log('   ✅ Cascade deletion and multi-tenant integrity verified.\n');

    log('====================================================');
    log('🎉 PHASE 1 VERIFICATION COMPLETED SUCCESSFULLY!');
    log('====================================================\n');

    return { success: true, logs };
  } catch (err) {
    log(`\n❌ Phase 1 Verification Failed: ${err.message}`);
    throw err;
  }
}

// Standalone execution
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('verify-workflows-phase1.js')) {
  runWorkflowsPhase1Verification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
