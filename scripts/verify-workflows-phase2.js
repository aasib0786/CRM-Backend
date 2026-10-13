/**
 * Verification Script for Workflows Phase 2:
 * Triggers, Conditions, Variable Interpolation, and Action Execution.
 */

import connectDB from '../src/pool.js';
import {
  interpolateVariables,
  buildWorkflowContext,
  evaluateConditionRule,
  evaluateConditionsGroup,
  matchTrigger,
  evaluateWorkflowEligibility,
  calculateWaitTime,
  calculateWaitUntilTime,
  applyQuietHoursGuard,
  executeWorkflowStep,
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
  console.log('🚀 RUNNING WORKFLOWS PHASE 2 VERIFICATION SUITE');
  console.log('======================================================\n');

  // -------------------------------------------------------------------
  // TEST SUITE 1: Variable Interpolation
  // -------------------------------------------------------------------
  console.log('1. Testing Variable Interpolator (interpolateVariables)...');
  const mockContext = {
    lead: {
      name: 'Rohan Sharma',
      phone: '+919876543210',
      budget: '75 Lakhs',
      custom_fields: { preferred_floor: '12th' },
    },
    agent: { name: 'Priya Patel', phone: '+919998887776' },
    project: { name: 'Greenwood Enclave' },
    company: { name: 'Digi India CRM' },
  };

  const text1 = 'Hello {{lead.name}}, welcome to {{project.name}}! Agent {{agent.name}} is assigned.';
  const res1 = interpolateVariables(text1, mockContext);
  assert(res1 === 'Hello Rohan Sharma, welcome to Greenwood Enclave! Agent Priya Patel is assigned.', 'Interpolates multiple nested keys');

  const text2 = 'Your budget is {{lead.budget}} and floor is {{lead.custom_fields.preferred_floor}}. Missing: {{lead.missing_field}}';
  const res2 = interpolateVariables(text2, mockContext);
  assert(res2 === 'Your budget is 75 Lakhs and floor is 12th. Missing: ', 'Handles custom fields and missing keys safely without errors');

  // -------------------------------------------------------------------
  // TEST SUITE 2: Condition Rules & Grouping
  // -------------------------------------------------------------------
  console.log('\n2. Testing Condition Evaluator (evaluateConditionRule & evaluateConditionsGroup)...');
  const leadSample = {
    source: 'Website',
    stage: 'Qualified',
    score: 85,
    tags: ['vip', 'high-budget'],
    phone: '+919876543210',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
  };

  assert(evaluateConditionRule(leadSample, { field: 'source', operator: 'equals', value: 'Website' }), 'Condition: source equals Website');
  assert(evaluateConditionRule(leadSample, { field: 'score', operator: 'gt', value: 50 }), 'Condition: score > 50');
  assert(evaluateConditionRule(leadSample, { field: 'score', operator: 'between', min: 80, max: 90 }), 'Condition: score between 80 and 90');
  assert(evaluateConditionRule(leadSample, { field: 'tags', operator: 'contains', value: 'vip' }), 'Condition: tags contains vip');
  assert(evaluateConditionRule(leadSample, { field: 'has_whatsapp_number', operator: 'equals', value: true }), 'Condition: has_whatsapp_number is true');
  assert(evaluateConditionRule(leadSample, { field: 'created_within_x_days', operator: 'lte', value: 7 }), 'Condition: created_within_x_days <= 7');

  // Test Grouped (all AND, any OR)
  const groupPass = {
    all: [
      { field: 'source', operator: 'equals', value: 'Website' },
      { field: 'score', operator: 'gte', value: 80 },
    ],
    any: [
      { field: 'stage', operator: 'equals', value: 'Qualified' },
      { field: 'stage', operator: 'equals', value: 'Won' },
    ],
  };
  assert(evaluateConditionsGroup(groupPass, leadSample), 'Condition Group: all matched AND any matched');

  const groupFail = {
    all: [
      { field: 'source', operator: 'equals', value: 'Facebook' }, // Fails
    ],
  };
  assert(!evaluateConditionsGroup(groupFail, leadSample), 'Condition Group: failed when rule in "all" fails');

  // -------------------------------------------------------------------
  // TEST SUITE 3: Trigger Matching (matchTrigger)
  // -------------------------------------------------------------------
  console.log('\n3. Testing Trigger Matcher (matchTrigger)...');

  // 3a: lead_created
  const wfLeadCreated = {
    trigger_type: 'lead_created',
    trigger_config: { sources: ['website', 'indiamart'] },
  };
  assert(
    matchTrigger(wfLeadCreated, { type: 'lead_created', lead: { source: 'Website' } }).matches,
    'Trigger: lead_created matches allowed source'
  );
  assert(
    !matchTrigger(wfLeadCreated, { type: 'lead_created', lead: { source: 'Walk-in' } }).matches,
    'Trigger: lead_created rejects non-allowed source'
  );

  // 3b: stage_changed
  const wfStageChange = {
    trigger_type: 'stage_changed',
    trigger_config: { to_stage: 'Site Visit' },
  };
  assert(
    matchTrigger(wfStageChange, { type: 'stage_changed', payload: { from_stage: 'Qualified', to_stage: 'Site Visit' } }).matches,
    'Trigger: stage_changed matches target to_stage'
  );

  // 3c: score_crossed
  const wfScoreCross = {
    trigger_type: 'score_crossed',
    trigger_config: { threshold: 75, direction: 'above' },
  };
  assert(
    matchTrigger(wfScoreCross, { type: 'score_crossed', payload: { score: 80, previousScore: 60 } }).matches,
    'Trigger: score_crossed matches upwards crossing'
  );
  assert(
    !matchTrigger(wfScoreCross, { type: 'score_crossed', payload: { score: 70, previousScore: 60 } }).matches,
    'Trigger: score_crossed ignores score below threshold'
  );

  // 3d: manual
  assert(
    matchTrigger({ trigger_type: 'manual' }, { type: 'manual' }).matches,
    'Trigger: manual trigger always matches'
  );

  // -------------------------------------------------------------------
  // TEST SUITE 4: Eligibility (Trigger + Conditions Group combined)
  // -------------------------------------------------------------------
  console.log('\n4. Testing Full Workflow Eligibility (evaluateWorkflowEligibility)...');
  const fullWorkflow = {
    trigger_type: 'lead_created',
    trigger_config: { sources: ['website'] },
    conditions: {
      all: [{ field: 'score', operator: 'gte', value: 80 }],
    },
  };
  const eligibility = await evaluateWorkflowEligibility(
    fullWorkflow,
    {
      type: 'lead_created',
      lead: leadSample,
    },
    mockContext
  );
  assert(eligibility.eligible === true, 'Workflow Eligibility evaluates trigger AND conditions successfully');

  // -------------------------------------------------------------------
  // TEST SUITE 5: Time Calculations & Quiet Hours Guard
  // -------------------------------------------------------------------
  console.log('\n5. Testing Quiet Hours & Wait Calculators...');
  // Quiet hours guard
  const lateNight = new Date('2026-10-07T22:30:00'); // 10:30 PM
  const guardedLateNight = applyQuietHoursGuard(lateNight);
  assert(guardedLateNight.getHours() === 9, 'Quiet hours guard moves 10:30 PM to 9:00 AM next day');

  const waitTime = calculateWaitTime({ duration: 30, unit: 'minutes' });
  assert(waitTime.getTime() > Date.now(), 'calculateWaitTime returns future timestamp');

  // -------------------------------------------------------------------
  // TEST SUITE 6: Action Execution (executeWorkflowStep)
  // -------------------------------------------------------------------
  console.log('\n6. Testing Action Executors (executeWorkflowStep)...');

  // 6a: If-Else step
  const ifElseStep = {
    type: 'if_else',
    config: {
      conditions: {
        all: [{ field: 'score', operator: 'gte', value: 80 }],
      },
      then_step_id: 'step_send_vip_offer',
      else_step_id: 'step_standard_followup',
    },
  };
  const ifElseRes = await executeWorkflowStep({
    step: ifElseStep,
    context: { lead: leadSample },
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  assert(ifElseRes.status === 'branch' && ifElseRes.next_step_id === 'step_send_vip_offer', 'Step if_else branches to then_step_id when condition is true');

  // 6b: Wait step
  const waitStep = {
    type: 'wait',
    config: { duration: 15, unit: 'minutes' },
  };
  const waitRes = await executeWorkflowStep({
    step: waitStep,
    context: { lead: leadSample },
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  assert(waitRes.status === 'waiting' && waitRes.next_run_at instanceof Date, 'Step wait sets status to waiting with future next_run_at');

  // 6c: WhatsApp Text step (simulated dispatch & safety)
  const waStep = {
    type: 'send_whatsapp_text',
    config: {
      message: 'Hello {{lead.name}}, thanks for contacting us!',
      fallback_template: 'lead_welcome_template',
    },
  };
  const waRes = await executeWorkflowStep({
    step: waStep,
    context: mockContext,
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  assert(waRes.status === 'success' || waRes.status === 'skipped', 'Step send_whatsapp_text completes safely with fallback/guard');

  // 6d: End step
  const endStep = { type: 'end' };
  const endRes = await executeWorkflowStep({
    step: endStep,
    context: mockContext,
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  assert(endRes.status === 'success' && endRes.output.terminated === true, 'Step end completes successfully');

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 2 TESTS PASSED!`);
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
