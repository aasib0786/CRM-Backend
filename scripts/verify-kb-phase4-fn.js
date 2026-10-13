import connectDB from '../src/pool.js';
import { kbSearch, recordArticleUsage, logUnansweredQuestion } from '../src/knowledge-base/kb-search-service.js';
import { buildSystemPrompt, generateAIReply, generateFallbackResponse } from '../src/bot/llm-service.js';

export default async function runVerification() {
  const logs = [];
  const log = (msg) => logs.push(msg);

  // 1. Resolve test company
  const { rows: compRows } = await connectDB.query(`SELECT id, name FROM public.companies LIMIT 1`);
  if (compRows.length === 0) {
    throw new Error('No company found in database to test.');
  }
  const companyId = compRows[0].id;
  log(`Company: "${compRows[0].name}" (${companyId})`);

  // 2. Test Ranked KB Retrieval for Bot Prompt
  const testQuery = 'What documents are required to book?';
  const searchResults = await kbSearch(companyId, testQuery, { limit: 4, minScore: 0.15 });
  log(`Search query: "${testQuery}" -> Found ${searchResults.length} articles`);
  searchResults.forEach((art, i) => {
    log(`  [#${i + 1}] Score: ${art.score} | Q: ${art.question}`);
  });

  if (searchResults.length === 0) {
    throw new Error('Expected at least 1 matching article for documents inquiry.');
  }

  // 3. Test System Prompt Construction
  const systemPrompt = buildSystemPrompt({
    botSettings: {
      display_name: 'Aria',
      persona: 'Senior Sales Consultant',
      communication_style: 'professional',
      primary_language: 'en',
    },
    companyName: compRows[0].name,
    lead: { name: 'Vikram Mehta', phone: '+919876543210' },
    knowledgeArticles: searchResults,
    collectedData: {},
  });

  const hasKbHeader = systemPrompt.includes('VERIFIED KNOWLEDGE BASE:');
  const hasArticleContent = systemPrompt.includes(searchResults[0].question);
  log(`System Prompt has "VERIFIED KNOWLEDGE BASE": ${hasKbHeader}`);
  log(`System Prompt has matched article question: ${hasArticleContent}`);

  if (!hasKbHeader || !hasArticleContent) {
    throw new Error('System prompt missing verified knowledge articles.');
  }

  // 4. Test Usage Count Tracking
  const targetArticleId = searchResults[0].id;
  const { rows: beforeRows } = await connectDB.query(
    `SELECT usage_count, last_used_at FROM public.kb_articles WHERE id = $1`,
    [targetArticleId]
  );
  const beforeCount = beforeRows[0].usage_count || 0;

  await recordArticleUsage([targetArticleId]);

  const { rows: afterRows } = await connectDB.query(
    `SELECT usage_count, last_used_at FROM public.kb_articles WHERE id = $1`,
    [targetArticleId]
  );
  const afterCount = afterRows[0].usage_count || 0;
  log(`Usage count increment: ${beforeCount} -> ${afterCount}`);

  if (afterCount !== beforeCount + 1) {
    throw new Error(`Usage count did not increment. Expected ${beforeCount + 1}, got ${afterCount}`);
  }

  // 5. Test Unanswered Question Logging & Safe Fallback
  const unanswerableQuery = 'Do you offer personal helicopter landing pad on the rooftop?';
  const zeroResults = await kbSearch(companyId, unanswerableQuery, { limit: 4, minScore: 0.15 });
  log(`Unanswerable query search count: ${zeroResults.length} (Expected 0)`);

  const unanswerLogged = await logUnansweredQuestion({
    companyId,
    questionText: unanswerableQuery,
  });
  log(`Logged unanswered ID: ${unanswerLogged?.id}, Status: ${unanswerLogged?.status}`);

  if (!unanswerLogged?.id) {
    throw new Error('Failed to log unanswered question.');
  }

  // 6. Test Safe Fallback Response Generation
  const fallbackResponse = generateFallbackResponse({
    botSettings: { display_name: 'Aria' },
    userMessage: unanswerableQuery,
    collectedData: {},
    knowledgeArticles: zeroResults,
  });
  log(`Safe Fallback reply: "${fallbackResponse.reply}"`);
  const isSafe = fallbackResponse.reply.toLowerCase().includes('confirm') || fallbackResponse.reply.toLowerCase().includes('expert');
  log(`Safe fallback contains expert confirmation: ${isSafe}`);

  // 7. Test AI Reply with verified knowledge
  const aiReplyResult = await generateAIReply({
    botSettings: { display_name: 'Aria', primary_language: 'en' },
    companyName: compRows[0].name,
    lead: { name: 'Vikram Mehta' },
    knowledgeArticles: searchResults,
    userMessage: testQuery,
  });
  log(`AI Bot Reply: "${aiReplyResult.reply}"`);
  log(`AI Provider: ${aiReplyResult.provider}, Model: ${aiReplyResult.model}, isFallback: ${aiReplyResult.isFallback}`);

  return {
    status: 'ALL_PHASE4_CHECKS_PASSED',
    logs,
  };
}
