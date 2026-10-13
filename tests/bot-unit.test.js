/**
 * Unit Tests for WhatsApp AI Sales Bot
 * Run with: node --test backend/tests/bot-unit.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripMarkdown,
  countWords,
  limitWords,
  buildSystemPrompt,
  extractJsonFromResponse,
  generateFallbackResponse,
} from '../src/bot/llm-service.js';

import { checkHandoffConditions } from '../src/bot/bot-handoff-service.js';

test('1. stripMarkdown removes WhatsApp disallowed formatting', () => {
  const input = '**Exclusive Offer** on _3 BHK_ luxury apartments! Click [here](https://crm.com) for #1 deals.';
  const output = stripMarkdown(input);
  assert.ok(!output.includes('**'));
  assert.ok(!output.includes('__'));
  assert.ok(!output.includes('#'));
  assert.ok(output.includes('Exclusive Offer on 3 BHK luxury apartments! Click here for 1 deals.'));
});

test('2. countWords and limitWords enforce strict word budget', () => {
  const sample = 'One two three four five six seven eight nine ten';
  assert.equal(countWords(sample), 10);
  assert.equal(countWords('   '), 0);

  const limited = limitWords(sample, 5);
  assert.equal(countWords(limited), 5);
  assert.ok(limited.endsWith('.'));
});

test('3. buildSystemPrompt correctly incorporates persona, tone, language, and knowledge', () => {
  const botSettings = {
    display_name: 'Aria',
    persona: 'Senior Luxury Real Estate Consultant',
    communication_style: 'friendly',
    primary_language: 'hinglish',
    max_bot_turns: 8,
    qualification_questions: [
      { id: 'requirement', question: 'What configuration do you prefer?', required: true },
      { id: 'budget', question: 'What is your budget?', required: true },
    ],
  };

  const lead = { name: 'Vikram Mehta', phone: '+919988776655' };
  const project = { name: 'Greenwood Towers', location: 'Golf Course Road, Gurgaon' };
  const knowledgeArticles = [
    { title: 'Payment Plan', content: 'Construction linked payment plan: 20:80' },
  ];

  const prompt = buildSystemPrompt({
    botSettings,
    companyName: 'Digi India Estates',
    lead,
    project,
    knowledgeArticles,
    collectedData: { requirement: '3 BHK' },
  });

  assert.ok(prompt.includes('Aria'));
  assert.ok(prompt.includes('Senior Luxury Real Estate Consultant'));
  assert.ok(prompt.includes('Digi India Estates'));
  assert.ok(prompt.includes('Vikram Mehta'));
  assert.ok(prompt.includes('Greenwood Towers'));
  assert.ok(prompt.includes('Hinglish'));
  assert.ok(prompt.includes('Payment Plan'));
  assert.ok(prompt.includes('STRICT GUARDRAILS'));
  assert.ok(prompt.includes('under 60 words'));
});

test('4. extractJsonFromResponse reliably parses raw JSON and markdown fenced blocks', () => {
  // Direct JSON
  const direct = '{"reply": "Hello there!", "wants_human": false}';
  const parsedDirect = extractJsonFromResponse(direct);
  assert.equal(parsedDirect.reply, 'Hello there!');
  assert.equal(parsedDirect.wants_human, false);

  // Fenced JSON
  const fenced = '```json\n{\n  "reply": "We have 3 BHK ready to move.",\n  "intent": "inquiry"\n}\n```';
  const parsedFenced = extractJsonFromResponse(fenced);
  assert.equal(parsedFenced.reply, 'We have 3 BHK ready to move.');
  assert.equal(parsedFenced.intent, 'inquiry');

  // Trailing commas cleanup
  const trailingComma = '{\n  "reply": "All good",\n  "intent": "pricing",\n}';
  const parsedTrailing = extractJsonFromResponse(trailingComma);
  assert.equal(parsedTrailing.reply, 'All good');
});

test('5. generateFallbackResponse extracts qualifications and detects sentiment', () => {
  const botSettings = {
    display_name: 'Aria',
    handoff_keywords: ['call me', 'human', 'agent'],
  };

  // Case A: Qualification extraction (budget & BHK)
  const resA = generateFallbackResponse({
    botSettings,
    userMessage: 'I need a 2 BHK apartment in Noida under 85 Lakhs',
    collectedData: {},
  });
  assert.equal(resA.extracted.requirement, '2 BHK');
  assert.ok(resA.extracted.budget.toLowerCase().includes('85 lakh'));
  assert.equal(resA.sentiment, 'neutral');

  // Case B: Negative sentiment detection
  const resB = generateFallbackResponse({
    botSettings,
    userMessage: 'This is the worst service, stop calling me!',
    collectedData: {},
  });
  assert.equal(resB.sentiment, 'negative');

  // Case C: Explicit human request
  const resC = generateFallbackResponse({
    botSettings,
    userMessage: 'Can an executive call me now?',
    collectedData: {},
  });
  assert.equal(resC.wants_human, true);
  assert.equal(resC.intent, 'human_request');
});

test('6. checkHandoffConditions evaluates all 5 criteria accurately', () => {
  const botSettings = {
    max_bot_turns: 8,
    handoff_keywords: ['human', 'agent', 'call me'],
    qualification_questions: [
      { id: 'requirement', question: 'Requirement?', required: true },
      { id: 'budget', question: 'Budget?', required: true },
    ],
  };

  // Criterion 1: Explicit human request
  const handoff1 = checkHandoffConditions({
    conversation: { turn_count: 2 },
    botSettings,
    llmResult: { wants_human: true },
    userMessage: 'I want to talk with a representative',
  });
  assert.equal(handoff1.shouldHandoff, true);
  assert.ok(handoff1.reason.includes('human expert') || handoff1.reason.includes('keyword'));

  // Criterion 2: All required qualification questions completed
  const handoff2 = checkHandoffConditions({
    conversation: { turn_count: 2 },
    botSettings,
    collectedData: { requirement: '3 BHK', budget: '1.5 Cr' },
    llmResult: { wants_human: false },
    userMessage: 'My budget is 1.5 Cr',
  });
  assert.equal(handoff2.shouldHandoff, true);
  assert.ok(handoff2.reason.includes('qualification questions completed'));

  // Criterion 3: Max turns limit reached
  const handoff3 = checkHandoffConditions({
    conversation: { turn_count: 8 },
    botSettings,
    collectedData: {},
    llmResult: { wants_human: false },
    userMessage: 'Still thinking',
  });
  assert.equal(handoff3.shouldHandoff, true);
  assert.ok(handoff3.reason.includes('Max bot turns limit reached'));

  // Criterion 4: Negative sentiment
  const handoff4 = checkHandoffConditions({
    conversation: { turn_count: 1 },
    botSettings,
    collectedData: {},
    llmResult: { sentiment: 'negative' },
    userMessage: 'I am angry and dissatisfied',
  });
  assert.equal(handoff4.shouldHandoff, true);
  assert.ok(handoff4.reason.includes('Negative sentiment'));

  // Criterion 5: Retaining conversation when criteria not met
  const retaining = checkHandoffConditions({
    conversation: { turn_count: 1 },
    botSettings,
    collectedData: { requirement: '3 BHK' }, // missing budget
    llmResult: { wants_human: false, sentiment: 'neutral' },
    userMessage: 'Looking for 3 BHK',
  });
  assert.equal(retaining.shouldHandoff, false);
});
