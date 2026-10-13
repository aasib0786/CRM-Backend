/**
 * Google Gemini Provider for WhatsApp AI Sales Bot
 * Implements @google/genai SDK with exponential backoff retry,
 * 15s timeout, JSON schema enforcement, and fallback model resolution.
 */

const FALLBACK_REPLY = 'Our expert will confirm this detail and connect with you shortly.';

/**
 * Sleep helper for exponential backoff
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds Gemini contents structure:
 * role: "user" for lead messages, role: "model" for bot messages
 */
export const formatGeminiContents = (history = [], userMessage = '') => {
  const contents = [];

  // Filter and format previous turns
  (history || []).forEach((msg) => {
    const role = (msg.role === 'assistant' || msg.role === 'model' || msg.sender === 'bot')
      ? 'model'
      : 'user';
    const text = typeof msg.content === 'string' ? msg.content : (msg.text || '');
    if (text && text.trim()) {
      contents.push({
        role,
        parts: [{ text: text.trim() }],
      });
    }
  });

  // Append current user message
  if (userMessage && userMessage.trim()) {
    contents.push({
      role: 'user',
      parts: [{ text: userMessage.trim() }],
    });
  }

  return contents;
};

/**
 * Structured qualification response schema with uppercase types for Google API compatibility
 */
export const geminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    extracted: {
      type: 'OBJECT',
      properties: {
        budget: { type: 'STRING' },
        requirement: { type: 'STRING' },
        location: { type: 'STRING' },
        timeline: { type: 'STRING' },
      },
    },
    intent: { type: 'STRING' },
    wants_human: { type: 'BOOLEAN' },
    sentiment: { type: 'STRING', enum: ['positive', 'neutral', 'negative'] },
  },
  required: ['reply', 'extracted', 'intent', 'wants_human', 'sentiment'],
};

/**
 * Helper to call Gemini REST endpoint directly
 */
async function callGeminiRest({ model, apiKey, systemPrompt, contents, signal }) {
  const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const restBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 400,
      responseMimeType: 'application/json',
      responseSchema: geminiResponseSchema,
    },
  };

  const restRes = await fetch(restUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(restBody),
    signal,
  });

  if (!restRes.ok) {
    const status = restRes.status;
    const errBody = await restRes.text().catch(() => '');
    let parsedMessage = errBody;
    try {
      const j = JSON.parse(errBody);
      parsedMessage = j.error?.message || errBody;
    } catch {}

    const err = new Error(`Gemini REST error (${status}): ${parsedMessage}`);
    err.status = status;
    err.rawBody = errBody;
    throw err;
  }

  return await restRes.json();
}

/**
 * Primary generation function using @google/genai with REST API fallback
 */
export async function generateGeminiReply({
  systemPrompt,
  history = [],
  userMessage,
  apiKey = process.env.LLM_API_KEY,
  model = process.env.LLM_MODEL || 'gemini-2.5-flash-lite',
}) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('LLM_API_KEY is missing for Gemini provider');
  }

  // Google Gemini API keys from Google AI Studio always start with 'AIzaSy'
  if (!apiKey.startsWith('AIzaSy')) {
    console.warn(`[Gemini] Key "${apiKey.slice(0, 6)}..." is not a valid Google AI Studio key (must start with "AIzaSy"). Using Heuristic Qualification.`);
    throw new Error(`Invalid Gemini API Key format. Google AI Studio keys start with "AIzaSy...".`);
  }

  const contents = formatGeminiContents(history, userMessage);
  const maxRetries = 2;
  const backoffDelays = [1500, 3000];

  let currentModel = model;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      let rawText = '';
      let tokensUsed = 0;

      // 1. Try using @google/genai SDK with strict timeout
      let sdkSucceeded = false;
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const sdkTimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini SDK request timed out (8s)')), 8000)
        );

        const generatePromise = ai.models.generateContent({
          model: currentModel,
          contents,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.4,
            maxOutputTokens: 400,
            responseMimeType: 'application/json',
            responseSchema: geminiResponseSchema,
          },
        });

        const response = await Promise.race([generatePromise, sdkTimeoutPromise]);

        rawText = response.text || '';
        tokensUsed = response.usageMetadata?.totalTokenCount ||
          (Number(response.usageMetadata?.promptTokenCount || 0) + Number(response.usageMetadata?.candidatesTokenCount || 0)) ||
          0;
        sdkSucceeded = true;
      } catch (sdkErr) {
        // If SDK fails because of auth/key, propagate immediately
        const isAuthErr = sdkErr.status === 400 || sdkErr.status === 401 || sdkErr.status === 403 ||
          (sdkErr.message && (sdkErr.message.includes('API_KEY_INVALID') || sdkErr.message.includes('API key not valid') || sdkErr.message.includes('AIzaSy')));

        if (isAuthErr) {
          throw new Error(`Google Gemini API Key is invalid (${sdkErr.message}). Obtain a valid AIzaSy... key from https://aistudio.google.com`);
        }

        // 2. Direct REST Fallback
        const restData = await callGeminiRest({
          model: currentModel,
          apiKey,
          systemPrompt,
          contents,
          signal: controller.signal,
        });

        const candidate = restData.candidates?.[0];
        rawText = candidate?.content?.parts?.[0]?.text || '';
        tokensUsed = restData.usageMetadata?.totalTokenCount || 0;
      }

      clearTimeout(timeoutId);

      // Check safety filters or empty responses
      if (!rawText || !rawText.trim()) {
        console.warn('[Gemini] Response was empty or blocked by safety filters. Using safe fallback.');
        return {
          reply: FALLBACK_REPLY,
          extracted: {},
          intent: 'inquiry',
          wants_human: false,
          sentiment: 'neutral',
          tokensUsed,
          provider: 'gemini',
          model: currentModel,
        };
      }

      // Clean ```json code fences if present
      let cleanText = rawText.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      let parsed;
      try {
        parsed = JSON.parse(cleanText);
      } catch (parseErr) {
        console.warn('[Gemini] JSON parsing error, returning stripped text:', parseErr.message);
        return {
          reply: cleanText.slice(0, 300) || FALLBACK_REPLY,
          extracted: {},
          intent: 'inquiry',
          wants_human: false,
          sentiment: 'neutral',
          tokensUsed,
          provider: 'gemini',
          model: currentModel,
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
        provider: 'gemini',
        model: currentModel,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      const status = err.status || (err.message?.match(/\b(400|401|403|404|429|500|503)\b/) ? Number(err.message.match(/\b(400|401|403|404|429|500|503)\b/)[0]) : null);

      // If invalid API key (400 / 401 / 403), do not retry — fail immediately so heuristic fallback handles it instantly!
      if (status === 400 || status === 401 || status === 403 || err.message?.includes('API_KEY_INVALID') || err.message?.includes('API key not valid')) {
        console.warn(`[Gemini] Non-retryable key error (${err.message}). Switching to heuristic mode.`);
        throw new Error(`Google Gemini API Key invalid: ${err.message}`);
      }

      // If model not found (404), switch to gemini-1.5-flash and retry once
      if (status === 404 && currentModel !== 'gemini-1.5-flash') {
        console.warn(`[Gemini] Model "${currentModel}" not found (404). Falling back to "gemini-1.5-flash"...`);
        currentModel = 'gemini-1.5-flash';
        continue;
      }

      const isRetryable = status === 429 || status === 500 || status === 503 || err.name === 'AbortError' || err.code === 'ETIMEDOUT';
      if (attempt < maxRetries - 1 && isRetryable) {
        const delay = backoffDelays[attempt] || 1500;
        console.warn(`[Gemini] Transient error (${err.message}). Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  console.error('[Gemini] Request ended with error:', lastError?.message);
  throw lastError || new Error('Gemini API call failed');
}

