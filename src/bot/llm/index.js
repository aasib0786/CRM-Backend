/**
 * LLM Layer Dispatcher for WhatsApp AI Sales Bot
 * Multi-provider setup supporting Google Gemini (active default) and OpenAI.
 */

import { generateGeminiReply } from './gemini.js';
import { generateOpenAIReply } from './openai.js';

const SAFE_FALLBACK_REPLY = 'Our expert will confirm this detail and connect with you shortly.';

/**
 * Strips markdown styling from WhatsApp replies
 */
export const stripMarkdown = (text) => {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold **text**
    .replace(/\*(.*?)\*/g, '$1')     // Italic *text*
    .replace(/__(.*?)__/g, '$1')     // Underline __text__
    .replace(/_(.*?)_/g, '$1')       // Italic _text_
    .replace(/~~(.*?)~~/g, '$1')     // Strikethrough ~~text~~
    .replace(/^#+\s+/gm, '')         // Headers #
    .replace(/`{1,3}.*?`{1,3}/gs, '') // Code blocks
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Links [text](url)
    .trim();
};

/**
 * Limit text to maximum number of words
 */
export const limitWords = (text, maxWords = 60) => {
  if (!text) return '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '.';
};

/**
 * Validates environment configuration at server start.
 * Never logs the actual API key.
 */
export function validateLlmEnv() {
  const provider = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  const apiKey = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  if (!provider || !apiKey) {
    console.warn(
      '⚠️ [Bot Warning] LLM_PROVIDER or LLM_API_KEY is missing in .env. WhatsApp Bot automated LLM replies will remain in safe fallback mode.'
    );
    return false;
  }

  const model = process.env.LLM_MODEL || (provider === 'gemini' ? 'gemini-2.5-flash-lite' : 'gpt-4o-mini');
  console.log(`🤖 [Bot Engine] LLM Provider active: "${provider}" (model: "${model}")`);
  return true;
}

/**
 * Generates an AI bot reply via the configured provider
 *
 * @param {Object} params
 * @param {string} params.systemPrompt
 * @param {Array} params.history - conversation history [{ role: 'user'|'model'|'assistant', content: string }]
 * @param {string} params.userMessage
 * @returns {Promise<Object>} { reply, extracted, intent, wants_human, sentiment, tokensUsed, provider, model }
 */
export async function generateBotReply({
  systemPrompt,
  history = [],
  userMessage,
}) {
  const provider = (process.env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || (provider === 'gemini' ? 'gemini-2.5-flash-lite' : 'gpt-4o-mini');

  // If missing API key, return safe fallback reply
  if (!apiKey || !apiKey.trim()) {
    console.warn('[LLM Dispatcher] No LLM_API_KEY configured. Returning fallback response.');
    return {
      reply: SAFE_FALLBACK_REPLY,
      extracted: {},
      intent: 'inquiry',
      wants_human: false,
      sentiment: 'neutral',
      tokensUsed: 0,
      provider: provider || 'none',
      model,
      llmError: true,
      errorMessage: 'LLM_API_KEY is not configured in backend/.env',
    };
  }

  let result;
  try {
    if (provider === 'gemini') {
      result = await generateGeminiReply({
        systemPrompt,
        history,
        userMessage,
        apiKey,
        model,
      });
    } else if (provider === 'openai') {
      result = await generateOpenAIReply({
        systemPrompt,
        history,
        userMessage,
        apiKey,
        model,
      });
    } else {
      console.warn(`[LLM Dispatcher] Unknown LLM_PROVIDER "${provider}". Defaulting to Gemini.`);
      result = await generateGeminiReply({
        systemPrompt,
        history,
        userMessage,
        apiKey,
        model: 'gemini-2.5-flash-lite',
      });
    }

    // Apply strict WhatsApp guardrails: no markdown, max 60 words
    result.reply = stripMarkdown(result.reply || SAFE_FALLBACK_REPLY);
    result.reply = limitWords(result.reply, 60);

    return result;
  } catch (err) {
    console.error(`[LLM Dispatcher] All attempts failed for provider "${provider}":`, err.message);

    // Return safe fallback on final failure and let consecutive error rule trigger handoff
    return {
      reply: SAFE_FALLBACK_REPLY,
      extracted: {},
      intent: 'unknown',
      wants_human: false,
      sentiment: 'neutral',
      tokensUsed: 0,
      provider,
      model,
      llmError: true,
      errorMessage: err.message,
    };
  }
}
