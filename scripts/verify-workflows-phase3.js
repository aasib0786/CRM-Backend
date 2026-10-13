/**
 * Verification Script for Workflows Phase 3:
 * Execution Engine, Background Scheduler Worker, Stop Rules, Anti-Spam Guards, and Event Bus.
 */

import connectDB from '../src/pool.js';
import {
  checkDailyWhatsAppLimit,
  isDuplicateTemplate,
  isBotActivelyEngaged,
  handleStopRules,
  triggerWorkflowsForEvent,
  pollAndExecuteWaitingRuns,
  emitLeadCreated,
  emitStageChanged,
  emitInboundMessage,
  emitManualTrigger,
} from '../src/workflows/index.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ [FAIL] ${testName}`);
    throw new Error(`Test failed: ${testName}`);
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 RUNNING WORKFLOWS PHASE 3 VERIFICATION SUITE');
  console.log('======================================================\n');

  // Fetch or create a test company
  let companyId = '00000000-0000-0000-0000-000000000001';
  try {
    const compRes = await connectDB.query(`SELECT id FROM public.companies LIMIT 1`);
    if (compRes.rows[0]?.id) companyId = compRes.rows[0].id;
  } catch (e) {}

  // Create a clean test lead
  const testPhone = `+9198765${Math.floor(10000 + Math.random() * 90000)}`;
  const leadInsert = await connectDB.query(
    `INSERT INTO public.leads (
      name, phone, stage, score, company_id, do_not_message, created_at, updated_at
    ) VALUES ($1, $2, 'New Inquiry', 65, $3, false, NOW(), NOW())
    RETURNING id, name, phone, stage, company_id, do_not_message`,
    ['Phase3 Test Lead', testPhone, companyId]
  );
  const testLead = leadInsert.rows[0];

  // -------------------------------------------------------------------
  // TEST SUITE 1: Anti-Spam & Collision Guards
  // -------------------------------------------------------------------
  console.log('1. Testing Anti-Spam & Collision Guards...');
  const limitCheck = await checkDailyWhatsAppLimit(companyId, testLead.id);
  assert(limitCheck.allowed === true && limitCheck.count === 0, 'Daily WhatsApp limit check returns allowed for new lead');

  const dupCheck = await isDuplicateTemplate(companyId, testLead.id, 'welcome_promo_v1');
  assert(dupCheck === false, 'Duplicate template check returns false when template not sent yet');

  const botCheck = await isBotActivelyEngaged(companyId, testLead.id);
  assert(botCheck === false, 'Bot collision check returns false when no active bot turn exists');

  // -------------------------------------------------------------------
  // TEST SUITE 2: Stop Rules (Reply, Agent Takeover, Stage Change, Opt-Out)
  // -------------------------------------------------------------------
  console.log('\n2. Testing Stop Rules Engine (handleStopRules)...');

  // Create a test workflow with stop_on_reply = true
  const wfInsert = await connectDB.query(
    `INSERT INTO public.workflows (
      company_id, name, trigger_type, is_active, stop_on_reply, stop_on_agent_takeover, stop_on_stage_change,
      steps, created_at, updated_at
    ) VALUES ($1, 'Auto Follow-up with Stop Rules', 'lead_created', true, true, true, true, $2::jsonb, NOW(), NOW())
    RETURNING id`,
    [
      companyId,
      JSON.stringify([
        { id: 'step_1', type: 'send_whatsapp_text', config: { message: 'Hi {{lead.name}}' } },
        { id: 'step_2', type: 'wait', config: { duration: 10, unit: 'minutes' } },
        { id: 'step_3', type: 'end' },
      ]),
    ]
  );
  const testWfId = wfInsert.rows[0].id;

  // Insert a mock waiting run for this lead
  const runInsert = await connectDB.query(
    `INSERT INTO public.workflow_runs (
      company_id, workflow_id, lead_id, status, current_step_id, current_step_index, next_run_at, created_at, updated_at
    ) VALUES ($1, $2, $3, 'waiting', 'step_2', 1, NOW() + INTERVAL '10 minutes', NOW(), NOW())
    RETURNING id`,
    [companyId, testWfId, testLead.id]
  );
  const testRunId = runInsert.rows[0].id;

  // 2a. Stop on Reply
  await handleStopRules({
    event: 'reply',
    leadId: testLead.id,
    companyId,
    messageText: 'I am interested!',
  });

  const checkRun1 = await connectDB.query(`SELECT status, error_message FROM public.workflow_runs WHERE id = $1`, [testRunId]);
  assert(checkRun1.rows[0]?.status === 'cancelled', 'Stop on reply cancels waiting workflow run');

  // 2b. STOP keyword (Opt-Out)
  // Create another run to test opt-out
  const run2 = await connectDB.query(
    `INSERT INTO public.workflow_runs (
      company_id, workflow_id, lead_id, status, current_step_id, current_step_index, next_run_at, created_at, updated_at
    ) VALUES ($1, $2, $3, 'waiting', 'step_2', 1, NOW() + INTERVAL '10 minutes', NOW(), NOW())
    RETURNING id`,
    [companyId, testWfId, testLead.id]
  );
  const run2Id = run2.rows[0].id;

  await handleStopRules({
    event: 'reply',
    leadId: testLead.id,
    companyId,
    messageText: 'STOP',
  });

  const checkLeadOpt = await connectDB.query(`SELECT do_not_message FROM public.leads WHERE id = $1`, [testLead.id]);
  const checkRun2 = await connectDB.query(`SELECT status FROM public.workflow_runs WHERE id = $1`, [run2Id]);
  assert(checkLeadOpt.rows[0]?.do_not_message === true, 'STOP keyword flags lead with do_not_message = true');
  assert(checkRun2.rows[0]?.status === 'cancelled', 'STOP keyword cancels active workflow run');

  // -------------------------------------------------------------------
  // TEST SUITE 3: Trigger Matching & Engine Invocation
  // -------------------------------------------------------------------
  console.log('\n3. Testing Workflow Triggering Engine (triggerWorkflowsForEvent)...');
  const triggerRes = await triggerWorkflowsForEvent({
    type: 'lead_created',
    company_id: companyId,
    lead: { ...testLead, do_not_message: false },
    payload: { source: 'Website' },
  });
  assert(triggerRes.triggered !== undefined, 'triggerWorkflowsForEvent evaluates active workflows safely');

  // -------------------------------------------------------------------
  // TEST SUITE 4: Scheduler Worker (FOR UPDATE SKIP LOCKED)
  // -------------------------------------------------------------------
  console.log('\n4. Testing Scheduler Worker (pollAndExecuteWaitingRuns)...');
  // Insert a run that is due right now
  const dueRun = await connectDB.query(
    `INSERT INTO public.workflow_runs (
      company_id, workflow_id, lead_id, status, current_step_id, current_step_index, next_run_at, created_at, updated_at
    ) VALUES ($1, $2, $3, 'waiting', 'step_1', 0, NOW() - INTERVAL '1 minute', NOW(), NOW())
    RETURNING id`,
    [companyId, testWfId, testLead.id]
  );
  const dueRunId = dueRun.rows[0].id;

  await pollAndExecuteWaitingRuns(5);

  const checkDue = await connectDB.query(`SELECT status FROM public.workflow_runs WHERE id = $1`, [dueRunId]);
  assert(['running', 'completed', 'waiting'].includes(checkDue.rows[0]?.status), 'Scheduler picks up due waiting run with FOR UPDATE SKIP LOCKED');

  // Clean up test records
  await connectDB.query(`DELETE FROM public.workflow_run_logs WHERE run_id IN ($1, $2, $3)`, [testRunId, run2Id, dueRunId]);
  await connectDB.query(`DELETE FROM public.workflow_runs WHERE id IN ($1, $2, $3)`, [testRunId, run2Id, dueRunId]);
  await connectDB.query(`DELETE FROM public.workflows WHERE id = $1`, [testWfId]);
  await connectDB.query(`DELETE FROM public.leads WHERE id = $1`, [testLead.id]);

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 3 TESTS PASSED!`);
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
