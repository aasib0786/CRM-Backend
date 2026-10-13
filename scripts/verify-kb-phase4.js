import dotenv from 'dotenv';
dotenv.config();

import connectDB from '../src/pool.js';
import { kbSearch, recordArticleUsage, logUnansweredQuestion } from '../src/knowledge-base/kb-search-service.js';
import { buildSystemPrompt, generateAIReply, generateFallbackResponse } from '../src/bot/llm-service.js';

async function verifyPhase4() {
  console.log('====================================================');
  console.log('🤖 Verifying Phase 4: Bot Integration & Knowledge Base');
  console.log('====================================================\n');

  try {
    // 1. Resolve test company
    const { rows: compRows } = await connectDB.query(`SELECT id, name FROM public.companies LIMIT 1`);
    if (compRows.length === 0) {
      throw new Error('No company found in database to test.');
    }
    const companyId = compRows[0].id;
    console.log(`✅ Using company: "${compRows[0].name}" (${companyId})`);

    // 2. Test Ranked KB Retrieval for Bot Prompt
    const testQuery = 'What documents are required to book?';
    console.log(`\n🔍 1. Testing kbSearch for question: "${testQuery}"`);
    const searchResults = await kbSearch(companyId, testQuery, { limit: 4, minScore: 0.15 });
    console.log(`   Found ${searchResults.length} matching articles:`);
    searchResults.forEach((art, i) => {
      console.log(`   #${i + 1} [Score: ${art.score}] Q: ${art.question}`);
    });

    if (searchResults.length === 0) {
      throw new Error('Expected at least 1 matching article for documents inquiry.');
    }

    // 3. Test System Prompt Construction
    console.log('\n📝 2. Testing buildSystemPrompt with Knowledge Base injection:');
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
    console.log(`   Prompt includes "VERIFIED KNOWLEDGE BASE": ${hasKbHeader ? '✅ Yes' : '❌ No'}`);
    console.log(`   Prompt includes article content: ${hasArticleContent ? '✅ Yes' : '❌ No'}`);

    if (!hasKbHeader || !hasArticleContent) {
      throw new Error('System prompt missing verified knowledge articles.');
    }

    // 4. Test Usage Count Tracking
    console.log('\n📊 3. Testing recordArticleUsage increment:');
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
    console.log(`   Article ${targetArticleId}: usage_count ${beforeCount} -> ${afterCount}`);
    console.log(`   last_used_at: ${afterRows[0].last_used_at}`);

    if (afterCount !== beforeCount + 1) {
      throw new Error(`Usage count did not increment. Expected ${beforeCount + 1}, got ${afterCount}`);
    }
    console.log('   ✅ Article usage tracking working perfectly.');

    // 5. Test Unanswered Question Logging & Safe Fallback
    const unanswerableQuery = 'Do you offer personal helicopter landing pad on the rooftop?';
    console.log(`\n❓ 4. Testing unanswerable question: "${unanswerableQuery}"`);
    const zeroResults = await kbSearch(companyId, unanswerableQuery, { limit: 4, minScore: 0.15 });
    console.log(`   kbSearch results count: ${zeroResults.length} (Expected 0)`);

    const unanswerLogged = await logUnansweredQuestion({
      companyId,
      questionText: unanswerableQuery,
    });
    console.log(`   Logged to kb_unanswered with ID: ${unanswerLogged?.id}, status: ${unanswerLogged?.status}`);

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
    console.log(`   Fallback response generated:\n   "${fallbackResponse.reply}"`);
    const isSafe = fallbackResponse.reply.toLowerCase().includes('confirm') || fallbackResponse.reply.toLowerCase().includes('expert');
    console.log(`   Safe response contains expert confirmation: ${isSafe ? '✅ Yes' : '❌ No'}`);

    // 7. Test AI Reply with verified knowledge
    console.log('\n🤖 5. Testing generateAIReply with verified Knowledge Base:');
    const aiReplyResult = await generateAIReply({
      botSettings: { display_name: 'Aria', primary_language: 'en' },
      companyName: compRows[0].name,
      lead: { name: 'Vikram Mehta' },
      knowledgeArticles: searchResults,
      userMessage: testQuery,
    });
    console.log(`   AI Bot Reply: "${aiReplyResult.reply}"`);
    console.log(`   Provider: ${aiReplyResult.provider}, Model: ${aiReplyResult.model}, Fallback: ${aiReplyResult.isFallback}`);

    console.log('\n====================================================');
    console.log('🎉 PHASE 4 VERIFICATION PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ Phase 4 Verification Error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

verifyPhase4();
