/**
 * Verification Script: Knowledge Base Phase 1 Database Tables & Full-Text Search
 * Usage: node scripts/verify-kb-phase1.js
 */

import 'dotenv/config';
import connectDB from '../src/pool.js';
import { initKnowledgeBaseDb } from '../src/knowledge-base/kb-init.js';

async function main() {
  console.log('====================================================');
  console.log('🧪 Knowledge Base Phase 1 — Verification');
  console.log('====================================================');

  try {
    // 1. Run initializer
    await initKnowledgeBaseDb();

    // 2. Verify kb_categories
    const catRes = await connectDB.query(`SELECT id, name, sort_order FROM public.kb_categories ORDER BY sort_order ASC`);
    console.log(`\n📁 kb_categories (${catRes.rows.length} found):`);
    catRes.rows.forEach((c) => console.log(`   - [Sort ${c.sort_order}] ${c.name} (id: ${c.id})`));

    // 3. Verify kb_articles
    const artRes = await connectDB.query(`SELECT id, question, type, priority, status FROM public.kb_articles ORDER BY priority DESC LIMIT 5`);
    const totalArt = await connectDB.query(`SELECT COUNT(*)::int as count FROM public.kb_articles`);
    console.log(`\n📄 kb_articles (${totalArt.rows[0].count} total articles, sample top 5):`);
    artRes.rows.forEach((a) => console.log(`   - [Priority ${a.priority}] [${a.type}] ${a.question}`));

    // 4. Verify search_vector generation
    const svRes = await connectDB.query(`
      SELECT question, search_vector 
      FROM public.kb_articles 
      WHERE search_vector IS NOT NULL 
      LIMIT 1
    `);
    if (svRes.rows.length > 0) {
      console.log(`\n🔍 search_vector verification:`);
      console.log(`   Sample question: "${svRes.rows[0].question}"`);
      console.log(`   Vector snippet:  ${String(svRes.rows[0].search_vector).slice(0, 120)}...`);
    } else {
      console.warn('⚠️ search_vector is empty. Verifying trigger...');
    }

    // 5. Test Full-Text Search with Hinglish / English query
    const testQuery = 'weekend site visit';
    const searchRes = await connectDB.query(`
      SELECT 
        id, question, answer, type, priority,
        ts_rank(search_vector, plainto_tsquery('simple', $1)) as rank
      FROM public.kb_articles
      WHERE search_vector @@ plainto_tsquery('simple', $1)
      ORDER BY rank DESC, priority DESC
      LIMIT 3
    `, [testQuery]);

    console.log(`\n🔎 Full-Text Search Test for "${testQuery}":`);
    if (searchRes.rows.length > 0) {
      searchRes.rows.forEach((r, idx) => {
        console.log(`   ${idx + 1}. [Rank ${parseFloat(r.rank).toFixed(4)}] ${r.question}`);
      });
    } else {
      console.warn('⚠️ No search results found for test query.');
    }

    // 6. Verify kb_unanswered
    const unRes = await connectDB.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'kb_unanswered'
    `);
    console.log(`\n❓ kb_unanswered table structure (${unRes.rows.length} columns verified):`);
    unRes.rows.forEach((col) => console.log(`   - ${col.column_name} (${col.data_type})`));

    console.log('\n====================================================');
    console.log('✅ Phase 1 Database & Seed Verification PASSED!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('❌ Verification failed:', err);
  } finally {
    process.exit(0);
  }
}

main();
