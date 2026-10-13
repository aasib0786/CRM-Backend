/**
 * Workflows Phase 2 Live Test Runner
 * Evaluates triggers, conditions, interpolations, and actions against live code.
 */

import {
  interpolateVariables,
  evaluateConditionRule,
  evaluateConditionsGroup,
  matchTrigger,
  evaluateWorkflowEligibility,
  calculateWaitTime,
  calculateWaitUntilTime,
  applyQuietHoursGuard,
  executeWorkflowStep,
} from './index.js';

export async function runWorkflowsPhase2TestSuite() {
  const results = [];

  function record(pass, name, details = {}) {
    results.push({ pass, name, details });
    if (!pass) console.error(`[FAIL] ${name}`, details);
  }

  // 1. Variable Interpolation
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
  record(
    res1 === 'Hello Rohan Sharma, welcome to Greenwood Enclave! Agent Priya Patel is assigned.',
    'Variable Interpolation: nested keys resolution',
    { res1 }
  );

  const text2 = 'Budget: {{lead.budget}}, Missing: {{lead.unknown}}';
  const res2 = interpolateVariables(text2, mockContext);
  record(
    res2 === 'Budget: 75 Lakhs, Missing: ',
    'Variable Interpolation: missing variable safe fallback',
    { res2 }
  );

  // 2. Conditions
  const leadSample = {
    source: 'Website',
    stage: 'Qualified',
    score: 85,
    tags: ['vip', 'high-budget'],
    phone: '+919876543210',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  };

  record(
    evaluateConditionRule(leadSample, { field: 'source', operator: 'equals', value: 'Website' }),
    'Condition: source equals Website'
  );
  record(
    evaluateConditionRule(leadSample, { field: 'score', operator: 'gt', value: 50 }),
    'Condition: score > 50'
  );
  record(
    evaluateConditionRule(leadSample, { field: 'score', operator: 'between', min: 80, max: 90 }),
    'Condition: score between 80 and 90'
  );
  record(
    evaluateConditionRule(leadSample, { field: 'tags', operator: 'contains', value: 'vip' }),
    'Condition: tags contains vip'
  );
  record(
    evaluateConditionRule(leadSample, { field: 'has_whatsapp_number', operator: 'equals', value: true }),
    'Condition: has_whatsapp_number'
  );

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
  record(
    evaluateConditionsGroup(groupPass, leadSample),
    'Condition Group: all AND any matching logic'
  );

  // 3. Trigger Matching
  const wfLeadCreated = {
    trigger_type: 'lead_created',
    trigger_config: { sources: ['website', 'indiamart'] },
  };
  record(
    matchTrigger(wfLeadCreated, { type: 'lead_created', lead: { source: 'Website' } }).matches,
    'Trigger Matcher: lead_created matches allowed source'
  );

  const wfStageChange = {
    trigger_type: 'stage_changed',
    trigger_config: { to_stage: 'Site Visit' },
  };
  record(
    matchTrigger(wfStageChange, { type: 'stage_changed', payload: { from_stage: 'Qualified', to_stage: 'Site Visit' } }).matches,
    'Trigger Matcher: stage_changed matches target to_stage'
  );

  const wfScoreCross = {
    trigger_type: 'score_crossed',
    trigger_config: { threshold: 75, direction: 'above' },
  };
  record(
    matchTrigger(wfScoreCross, { type: 'score_crossed', payload: { score: 80, previousScore: 60 } }).matches,
    'Trigger Matcher: score_crossed above threshold'
  );

  record(
    matchTrigger({ trigger_type: 'manual' }, { type: 'manual' }).matches,
    'Trigger Matcher: manual trigger matches'
  );

  // 4. Combined Eligibility
  const fullWorkflow = {
    trigger_type: 'lead_created',
    trigger_config: { sources: ['website'] },
    conditions: {
      all: [{ field: 'score', operator: 'gte', value: 80 }],
    },
  };
  const eligibility = await evaluateWorkflowEligibility(
    fullWorkflow,
    { type: 'lead_created', lead: leadSample },
    mockContext
  );
  record(eligibility.eligible === true, 'Workflow Eligibility: trigger + conditions group');

  // 5. Quiet Hours & Wait times
  const lateNight = new Date('2026-10-07T22:30:00');
  const guardedLateNight = applyQuietHoursGuard(lateNight);
  record(
    guardedLateNight.getHours() === 9,
    'Quiet Hours Guard: pushes late night to 9:00 AM'
  );

  // 6. Action Execution
  const ifElseStep = {
    type: 'if_else',
    config: {
      conditions: { all: [{ field: 'score', operator: 'gte', value: 80 }] },
      then_step_id: 'step_vip',
      else_step_id: 'step_regular',
    },
  };
  const ifElseRes = await executeWorkflowStep({
    step: ifElseStep,
    context: { lead: leadSample },
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  record(
    ifElseRes.status === 'branch' && ifElseRes.next_step_id === 'step_vip',
    'Action Executor: if_else evaluates and selects then_step_id branch'
  );

  const waitStep = {
    type: 'wait',
    config: { duration: 10, unit: 'minutes' },
  };
  const waitRes = await executeWorkflowStep({
    step: waitStep,
    context: { lead: leadSample },
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  record(
    waitRes.status === 'waiting' && waitRes.next_run_at instanceof Date,
    'Action Executor: wait step returns waiting status with future next_run_at'
  );

  const endStep = { type: 'end' };
  const endRes = await executeWorkflowStep({
    step: endStep,
    context: mockContext,
    companyId: '00000000-0000-0000-0000-000000000000',
  });
  record(
    endRes.status === 'success' && endRes.output.terminated === true,
    'Action Executor: end step terminates run'
  );

  const allPassed = results.every((r) => r.pass);
  return {
    success: allPassed,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}

export async function runWorkflowsPhase3TestSuite() {
  const {
    checkDailyWhatsAppLimit,
    isDuplicateTemplate,
    isBotActivelyEngaged,
    handleStopRules,
    triggerWorkflowsForEvent,
    pollAndExecuteWaitingRuns,
  } = await import('./index.js');
  const connectDB = (await import('../pool.js')).default;

  const results = [];
  function record(pass, name, details = {}) {
    results.push({ pass, name, details });
    if (!pass) console.error(`[FAIL] ${name}`, details);
  }

  // 1. Guard checks
  const limitCheck = await checkDailyWhatsAppLimit('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
  record(limitCheck.allowed === true, 'Anti-Spam: Daily WhatsApp limit allowed check');

  const dupCheck = await isDuplicateTemplate('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'promo_v1');
  record(dupCheck === false, 'Anti-Spam: Duplicate template check returns false when not sent');

  const botCheck = await isBotActivelyEngaged('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
  record(botCheck === false, 'Bot Collision: Bot active check returns false when no active session');

  const allPassed = results.every((r) => r.pass);
  return {
    success: allPassed,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}

