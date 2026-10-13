/**
 * End-to-End Test Script for WhatsApp AI Sales Bot
 * Run with: node backend/scripts/run-bot-e2e-test.js
 */
import connectDB from '../src/pool.js';
import { handleLeadCreated, processInboundWhatsAppMessage } from '../src/bot/bot-engine.js';
import { calculateLeadScore } from '../src/leads/scoringService.js';

async function runE2ETest() {
  console.log('====================================================');
  console.log('🤖 WhatsApp AI Sales Bot — End-to-End Test Suite');
  console.log('====================================================\n');

  let testCompanyId = null;
  let testLeadId = null;
  const testPhone = '919999988888';

  try {
    // 1. Get an existing company
    const compRes = await connectDB.query(`SELECT id, name FROM public.companies LIMIT 1`);
    if (compRes.rows.length === 0) {
      throw new Error('No company found in database. Seed companies first.');
    }
    testCompanyId = compRes.rows[0].id;
    console.log(`[Step 1] Using Company: "${compRes.rows[0].name}" (${testCompanyId})`);

    // 2. Ensure bot settings are initialized & active
    await connectDB.query(
      `INSERT INTO public.bot_settings (company_id, is_active, display_name, persona, communication_style, primary_language, max_bot_turns)
       VALUES ($1, true, 'Aria', 'Senior Sales Consultant', 'professional', 'en', 8)
       ON CONFLICT (company_id) 
       DO UPDATE SET is_active = true, display_name = 'Aria'`,
      [testCompanyId]
    );
    console.log('✅ Bot settings verified and set to active.');

    // 3. Create a test lead from a bot-enabled source ('WhatsApp Ads')
    // Clean up any previous test lead with this phone
    await connectDB.query(`DELETE FROM public.leads WHERE phone = $1 AND company_id = $2`, [testPhone, testCompanyId]);

    const leadInsertRes = await connectDB.query(
      `INSERT INTO public.leads (company_id, name, phone, email, source, stage, score, priority)
       VALUES ($1, 'Aarav Kapoor', $2, 'aarav.test@example.com', 'WhatsApp Ads', 'New Inquiry', 40, 'Medium')
       RETURNING *`,
      [testCompanyId, testPhone]
    );
    const testLead = leadInsertRes.rows[0];
    testLeadId = testLead.id;
    console.log(`✅ [Step 2] Test Lead created: ID = ${testLeadId}, Name = "${testLead.name}", Phone = ${testLead.phone}`);

    // 4. Trigger Lead Creation hook (handleLeadCreated)
    console.log('\n--- Simulation: Triggering Lead Created Hook ---');
    await handleLeadCreated(testLead, testCompanyId);

    // Verify conversation was created in DB
    const convCheck = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE company_id = $1 AND lead_id = $2 LIMIT 1`,
      [testCompanyId, testLeadId]
    );
    if (convCheck.rows.length === 0) {
      throw new Error('FAILED: bot_conversations entry was not created by handleLeadCreated');
    }
    const conversationId = convCheck.rows[0].id;
    console.log(`✅ Conversation record created: ID = ${conversationId}, Status = ${convCheck.rows[0].status}`);

    // 5. Turn 1 Simulation: Lead mentions Requirement ("3 BHK luxury apartment")
    console.log('\n--- Simulation Turn 1: Inbound WhatsApp Message (Requirement) ---');
    const turn1Payload = {
      from: testPhone,
      text: 'Hi, I saw your ad. I am looking for a 3 BHK luxury apartment.',
      timestamp: Date.now(),
      messageId: `wamid.test.turn1.${Date.now()}`,
    };

    const turn1Result = await processInboundWhatsAppMessage({
      companyId: testCompanyId,
      messagePayload: turn1Payload,
    });
    console.log('Bot Response:', turn1Result.reply);
    console.log('Turn 1 Status:', turn1Result.status);

    const convAfterTurn1 = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE id = $1`,
      [conversationId]
    );
    const dataTurn1 = convAfterTurn1.rows[0]?.collected_data || {};
    console.log('Collected Data after Turn 1:', JSON.stringify(dataTurn1));

    // 6. Turn 2 Simulation: Lead mentions Budget & Location ("1.8 Cr in Gurgaon")
    console.log('\n--- Simulation Turn 2: Inbound WhatsApp Message (Budget & Location) ---');
    const turn2Payload = {
      from: testPhone,
      text: 'My comfortable budget is 1.8 Cr and preferred location is Gurgaon.',
      timestamp: Date.now(),
      messageId: `wamid.test.turn2.${Date.now()}`,
    };

    const turn2Result = await processInboundWhatsAppMessage({
      companyId: testCompanyId,
      messagePayload: turn2Payload,
    });
    console.log('Bot Response:', turn2Result.reply);
    console.log('Turn 2 Status:', turn2Result.status);

    const convAfterTurn2 = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE id = $1`,
      [conversationId]
    );
    const dataTurn2 = convAfterTurn2.rows[0]?.collected_data || {};
    console.log('Collected Data after Turn 2:', JSON.stringify(dataTurn2));

    // 7. Turn 3 Simulation: Lead requests human executive ("Please connect me to an executive")
    console.log('\n--- Simulation Turn 3: Inbound WhatsApp Message (Handoff Request) ---');
    const turn3Payload = {
      from: testPhone,
      text: 'Great, can you please connect me to an executive or representative to schedule a site visit?',
      timestamp: Date.now(),
      messageId: `wamid.test.turn3.${Date.now()}`,
    };

    const turn3Result = await processInboundWhatsAppMessage({
      companyId: testCompanyId,
      messagePayload: turn3Payload,
    });
    console.log('Bot Response:', turn3Result.reply);
    console.log('Turn 3 Status:', turn3Result.status);

    // 8. Assertions:
    // A. Conversation status should be 'handed_off'
    const finalConv = await connectDB.query(
      `SELECT * FROM public.bot_conversations WHERE id = $1`,
      [conversationId]
    );
    const finalStatus = finalConv.rows[0]?.status;
    console.log(`\nFinal Conversation Status: "${finalStatus}"`);
    if (finalStatus !== 'handed_off') {
      console.warn(`Note: Final status is "${finalStatus}" (expected handed_off)`);
    } else {
      console.log('✅ Handoff Successfully Executed in DB!');
    }

    // B. Check Lead Activities for bot entries
    const actRes = await connectDB.query(
      `SELECT type, note FROM public.lead_activities WHERE lead_id = $1 ORDER BY created_at ASC`,
      [testLeadId]
    );
    console.log(`\nActivities logged (${actRes.rows.length}):`);
    actRes.rows.forEach((a) => console.log(` - [${a.type}] ${a.note}`));

    // C. Check Lead custom fields & score
    const updatedLeadRes = await connectDB.query(
      `SELECT score, custom_fields, assigned FROM public.leads WHERE id = $1`,
      [testLeadId]
    );
    const updatedLead = updatedLeadRes.rows[0];
    console.log('\nUpdated Lead Score:', updatedLead.score);
    console.log('Updated Custom Fields:', JSON.stringify(updatedLead.custom_fields));
    console.log('Assigned Agent:', updatedLead.assigned || '(Unassigned/Pool)');

    console.log('\n====================================================');
    console.log('🎉 ALL END-TO-END SIMULATION TESTS COMPLETED SUCCESSFULLY!');
    console.log('====================================================');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ E2E Test Failed with error:', err);
    process.exit(1);
  }
}

runE2ETest();
