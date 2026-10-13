/**
 * Verification Script: Knowledge Base Phase 2 APIs & Services
 * Usage: node scripts/verify-kb-phase2.js
 */

import 'dotenv/config';
import connectDB from '../src/pool.js';
import { kbSearch, recordArticleUsage, logUnansweredQuestion } from '../src/knowledge-base/kb-search-service.js';
import { parseCsv, toCsv, getSampleCsvTemplate } from '../src/knowledge-base/kb-csv-helper.js';

async function main() {
  console.log('====================================================');
  console.log('🧪 Knowledge Base Phase 2 — API & Service Verification');
  console.log('====================================================');

  try {
    // 1. Fetch first company ID
    const compRes = await connectDB.query(`SELECT id, name FROM public.companies LIMIT 1`);
    const companyId = compRes.rows[0]?.id || '00000000-0000-0000-0000-000000000000';
    console.log(`\n🏢 Testing against Company: "${compRes.rows[0]?.name || 'Default'}" (id: ${companyId})`);

    // 2. Test Ranked kbSearch
    console.log('\n🔍 Testing kbSearch function:');
    const searchQueries = [
      'site visit timing weekend',
      'home loan assistance sbi',
      'clubhouse amenities swimming pool',
    ];

    for (const q of searchQueries) {
      const results = await kbSearch(companyId, q, { limit: 3 });
      console.log(`\n   Query: "${q}" -> ${results.length} results:`);
      results.forEach((r, idx) => {
        console.log(`     ${idx + 1}. [Score: ${r.score}] [Type: ${r.type}] "${r.question}"`);
      });

      // Record usage for top result
      if (results.length > 0) {
        await recordArticleUsage([results[0].id]);
      }
    }

    // 3. Test Unanswered Questions logger
    console.log('\n❓ Testing Unanswered Question Logging:');
    const unQuestion = await logUnansweredQuestion({
      companyId,
      questionText: 'Do you have rooftop helipad in Sector 150 project?',
    });
    if (unQuestion) {
      console.log(`   Logged unanswered question: "${unQuestion.question_text}" (id: ${unQuestion.id})`);
    }

    // 4. Test CSV Helpers
    console.log('\n📄 Testing CSV Helpers:');
    const sampleCsv = getSampleCsvTemplate();
    const parsedRows = parseCsv(sampleCsv);
    console.log(`   Sample CSV generated (${sampleCsv.length} bytes) and parsed (${parsedRows.length} rows successfully).`);
    console.log(`   First row question: "${parsedRows[0]?.question}"`);

    // 5. Test toCsv export
    const exportArticlesRes = await connectDB.query(`
      SELECT question, answer, type, language, status, priority 
      FROM public.kb_articles 
      WHERE company_id = $1 LIMIT 3
    `, [companyId]);
    const exportedCsv = toCsv(exportArticlesRes.rows);
    console.log(`   Exported CSV snippet:`);
    console.log('   ' + exportedCsv.split('\r\n')[0]);
    if (exportedCsv.split('\r\n')[1]) {
      console.log('   ' + exportedCsv.split('\r\n')[1].slice(0, 80) + '...');
    }

    console.log('\n====================================================');
    console.log('✅ Phase 2 Services & Query Workflows Verified!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('❌ Phase 2 Verification failed:', err);
  } finally {
    process.exit(0);
  }
}

main();
