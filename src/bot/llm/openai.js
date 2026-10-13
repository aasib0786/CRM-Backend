/**
 * OpenAI Provider for WhatsApp AI Sales Bot
 * Implements chat completions API with exponential backoff retry,
 * 15s timeout, JSON object response format, and safety fallback.
 */

const FALLBACK_REPLY = 'Our expert will confirm this detail and connect with you shortly.';

/**
 * Sleep helper for exponential backoff
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds OpenAI messages array
 */
export const formatOpenAIMessages = (systemPrompt, history = [], userMessage = '') => {
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  (history || []).forEach((msg) => {
    const role = (msg.role === 'assistant' || msg.sender === 'bot')
      ? 'assistant'
      : 'user';
    const content = typeof msg.content === 'string' ? msg.content : (msg.text || '');
    if (content.trim()) {
      messages.push({ role, content: content.trim() });
    }
  });

  if (userMessage && userMessage.trim()) {
    messages.push({ role: 'user', content: userMessage.trim() });
  }

  return messages;
};

/**
 * Primary generation function for OpenAI
 */
export async function generateOpenAIReply({
  systemPrompt,
  history = [],
  userMessage,
  apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
  model = process.env.LLM_MODEL || 'gpt-4o-mini',
}) {
  if (!apiKey) {
    throw new Error('LLM_API_KEY / OPENAI_API_KEY is missing for OpenAI provider');
  }

  const messages = formatOpenAIMessages(systemPrompt, history, userMessage);
  const maxRetries = 3;
  const backoffDelays = [1000, 2000, 4000];

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.4,
            max_tokens: 400,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const status = res.status;
          const errBody = await res.text().catch(() => '');
          const err = new Error(`OpenAI API error (${status}): ${errBody}`);
          err.status = status;
          throw err;
        }

        const data = await res.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        const tokensUsed = data.usage?.total_tokens || 0;

        if (!rawContent || !rawContent.trim()) {
          console.warn('[OpenAI] Response was empty. Using safe fallback.');
          return {
            reply: FALLBACK_REPLY,
            extracted: {},
            intent: 'inquiry',
            wants_human: false,
            sentiment: 'neutral',
            tokensUsed,
            provider: 'openai',
            model,
          };
        }

        let cleanText = rawContent.trim();
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        let parsed;
        try {
          parsed = JSON.parse(cleanText);
        } catch (parseErr) {
          console.warn('[OpenAI] JSON parsing error:', parseErr.message);
          return {
            reply: cleanText.slice(0, 300) || FALLBACK_REPLY,
            extracted: {},
            intent: 'unknown',
            wants_human: false,
            sentiment: 'neutral',
            tokensUsed,
            provider: 'openai',
            model,
          };
        }

        return {
          reply: parsed.reply || FALLBACK_REPLY,
          extracted: parsed.extracted || {},
          intent: parsed.intent || 'inquiry',
          wants_human: Boolean(parsed.wants_human),
          sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment)
            ? parsed.sentiment
            : 'neutral',
          tokensUsed,
          provider: 'openai',
          model,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;
      const status = err.status || err.statusCode || (err.message?.match(/\b(429|500|503)\b/) ? Number(err.message.match(/\b(429|500|503)\b/)[0]) : null);
      const isRetryable = status === 429 || status === 500 || status === 503 || err.name === 'AbortError' || err.code === 'ETIMEDOUT';

      if (attempt < maxRetries - 1 && isRetryable) {
        const delay = backoffDelays[attempt] || 2000;
        console.warn(`[OpenAI] Request failed (${err.message}). Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  console.error('[OpenAI] Final attempt failed:', lastError?.message);
  throw lastError || new Error('OpenAI API call failed after retries');
}
