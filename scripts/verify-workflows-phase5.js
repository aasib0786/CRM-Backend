/**
 * Verification Script for Workflows Phase 5:
 * Dry-Run Simulation Engine, Default Template Seeding, and End-to-End Safety.
 */

import connectDB from '../src/pool.js';
import { seedDefaultWorkflows } from '../src/workflows/workflow-init.js';
import { runWorkflowDryRun, simulateWorkflowStep } from '../src/workflows/workflow-dryrun.js';
import { PREMADE_WORKFLOW_TEMPLATES } from '../src/workflows/workflow-templates.js';

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
  console.log('🚀 RUNNING WORKFLOWS PHASE 5 VERIFICATION SUITE');
  console.log('======================================================\n');

  // Fetch or setup test company
  let companyId = '00000000-0000-0000-0000-000000000001';
  try {
    const compRes = await connectDB.query(`SELECT id FROM public.companies LIMIT 1`);
    if (compRes.rows[0]?.id) companyId = compRes.rows[0].id;
  } catch (e) {}

  // -------------------------------------------------------------------
  // TEST SUITE 1: Template Definitions & Seeding
  // -------------------------------------------------------------------
  console.log('1. Testing Template Definitions & Seeder...');
  assert(PREMADE_WORKFLOW_TEMPLATES.length === 5, 'All 5 pre-made industry workflow templates are defined');
  assert(PREMADE_WORKFLOW_TEMPLATES.every((t) => t.steps?.length > 0), 'Every template has structured actionable steps');

  // Run seeder
  await seedDefaultWorkflows();
  const { rows: wfRows } = await connectDB.query(
    `SELECT COUNT(*)::int AS count FROM public.workflows WHERE company_id = $1`,
    [companyId]
  );
  assert(wfRows[0]?.count >= 1, 'Default workflows exist in database for tenant company');

  // -------------------------------------------------------------------
  // TEST SUITE 2: Dry-Run Simulation Engine
  // -------------------------------------------------------------------
  console.log('\n2. Testing Dry-Run Simulation Engine (runWorkflowDryRun)...');

  const testWorkflow = {
    name: 'Dry Run Test Workflow',
    trigger_type: 'lead_created',
    conditions: {
      all: [{ field: 'score', operator: 'gte', value: 50 }],
    },
    steps: [
      {
        id: 'step_1',
        type: 'send_whatsapp_text',
        title: 'Welcome Message',
        config: {
          message: 'Hello {{lead.name}}, your budget of {{lead.budget}} is noted!',
          fallback_template: 'lead_welcome_v1',
        },
      },
      {
        id: 'step_2',
        type: 'wait',
        title: 'Wait 2 Hours',
        config: { duration: 2, unit: 'hours', respect_quiet_hours: true },
      },
      {
        id: 'step_3',
        type: 'if_else',
        title: 'Score Check Branch',
        config: {
          conditions: {
            all: [{ field: 'score', operator: 'gte', value: 80 }],
          },
          then_step_id: 'step_vip',
          else_step_id: 'step_end',
        },
      },
      {
        id: 'step_vip',
        type: 'add_tag',
        title: 'Tag VIP',
        config: { tag: 'VIP' },
      },
      {
        id: 'step_end',
        type: 'end',
        title: 'End',
      },
    ],
  };

  const mockLead = {
    id: 'test-dryrun-lead-1',
    name: 'Ananya Verma',
    phone: '+919876543210',
    email: 'ananya@example.com',
    score: 85,
    stage: 'New Inquiry',
    budget: '95 Lakhs',
    source: 'Website',
  };

  const simResult = await runWorkflowDryRun({
    workflow: testWorkflow,
    mockLead,
    companyId,
  });

  assert(simResult.conditionsMatched === true, 'Dry-run evaluates condition eligibility accurately');
  assert(simResult.stepsSimulated.length >= 3, 'Dry-run iterates through sequential steps');

  // Verify variable interpolation in simulation
  const waStepSim = simResult.stepsSimulated.find((s) => s.type === 'send_whatsapp_text');
  assert(
    waStepSim?.details?.evaluated_message === 'Hello Ananya Verma, your budget of 95 Lakhs is noted!',
    'Dry-run interpolates variables in simulated message bodies'
  );

  // Verify wait calculation in simulation
  const waitStepSim = simResult.stepsSimulated.find((s) => s.type === 'wait');
  assert(
    waitStepSim?.details?.resumes_at !== undefined,
    'Dry-run computes future execution timestamp for wait steps'
  );

  // Verify branching in simulation (Ananya has score 85 >= 80, so should branch to step_vip)
  const ifElseSim = simResult.stepsSimulated.find((s) => s.type === 'if_else');
  assert(
    ifElseSim?.details?.branch === 'then',
    'Dry-run simulates correct branch for If/Else based on lead attributes'
  );

  // -------------------------------------------------------------------
  // TEST SUITE 3: Ineligible Lead Simulation Check
  // -------------------------------------------------------------------
  console.log('\n3. Testing Ineligible Lead Simulation...');
  const lowScoreLead = {
    ...mockLead,
    score: 30, // Less than required 50
  };

  const ineligResult = await runWorkflowDryRun({
    workflow: testWorkflow,
    mockLead: lowScoreLead,
    companyId,
  });

  assert(ineligResult.conditionsMatched === false, 'Dry-run catches ineligible lead and halts gracefully');
  assert(ineligResult.stepsSimulated.length === 0, 'No steps simulated when conditions are not satisfied');

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 5 TESTS PASSED!`);
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
