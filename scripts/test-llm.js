/**
 * Dev-only test script for WhatsApp AI Bot LLM Layer
 * Usage: node scripts/test-llm.js "Mujhe 2BHK flat chahiye Rohini mein"
 */
import 'dotenv/config';
import { generateBotReply, validateLlmEnv } from '../src/bot/llm/index.js';
import { buildSystemPrompt } from '../src/bot/llm-service.js';

async function main() {
  const userMessage = process.argv.slice(2).join(' ').trim() || 'Mujhe 2BHK flat chahiye Rohini mein';

  console.log('====================================================');
  console.log('🧪 WhatsApp AI Sales Bot — LLM Layer Test');
  console.log('====================================================');
  console.log(`User Input: "${userMessage}"`);

  validateLlmEnv();

  const mockSettings = {
    display_name: 'Aria',
    persona: 'Senior Sales Consultant',
    communication_style: 'friendly',
    primary_language: 'hinglish',
    qualification_questions: [
      { id: 'requirement', question: 'What type of property or service are you looking for?' },
      { id: 'budget', question: 'What is your comfortable budget range?' },
      { id: 'location', question: 'Which location or area do you prefer?' },
      { id: 'timeline', question: 'When are you planning to finalize?' },
    ],
  };

  const systemPrompt = buildSystemPrompt({
    botSettings: mockSettings,
    companyName: 'Digi India CRM',
    lead: { name: 'Test Lead', phone: '+91 98765 43210', source: 'WhatsApp' },
    project: { name: 'Rohini Heights', category: 'Residential', budget: '₹60 Lakh - ₹1.2 Cr' },
    knowledgeArticles: [
      { question: 'What configurations are available in Rohini Heights?', answer: 'We have 2BHK and 3BHK premium apartments ready to move.' },
    ],
    collectedData: {},
  });

  console.log('\nCalling LLM Provider...');
  const startTime = Date.now();

  try {
    const result = await generateBotReply({
      systemPrompt,
      history: [],
      userMessage,
    });

    const elapsed = Date.now() - startTime;

    console.log('\n--- LLM Response Received (' + elapsed + 'ms) ---');
    console.log(`Provider:     ${result.provider}`);
    console.log(`Model:        ${result.model}`);
    console.log(`Tokens Used:  ${result.tokensUsed}`);
    console.log(`Sentiment:    ${result.sentiment}`);
    console.log(`Intent:       ${result.intent}`);
    console.log(`Wants Human:  ${result.wants_human}`);
    console.log('\nExtracted Data:', JSON.stringify(result.extracted, null, 2));
    console.log('\nBot Reply:\n' + result.reply);
    console.log('\n--- Full Parsed Object ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err.message);
    process.exit(1);
  }
}

main();
