/**
 * LLM Service for WhatsApp AI Sales Bot
 * Supports OpenAI, OpenRouter, Groq, Gemini with automatic parsing,
 * strict guardrails, and robust fallback for development/offline modes.
 */

// Strip markdown styling from WhatsApp replies
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

// Word counter
export const countWords = (text) => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};

// Limit text to maximum number of words
export const limitWords = (text, maxWords = 60) => {
  if (!text) return '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(' ') + '.';
};

/**
 * Builds the complete system prompt incorporating bot identity, guardrails,
 * company info, lead details, linked project/inventory, and knowledge base articles.
 */
export const buildSystemPrompt = ({
  botSettings,
  companyName = 'Digi India CRM',
  lead,
  project,
  inventory = [],
  knowledgeArticles = [],
  collectedData = {},
}) => {
  const botName = botSettings.display_name || botSettings.displayName || 'Aria';
  const persona = botSettings.persona || 'Senior Sales Consultant';
  const style = botSettings.communication_style || botSettings.tone || 'professional';
  const primaryLang = botSettings.primary_language || botSettings.language || 'en';

  const toneGuidelines = {
    friendly: 'Warm, empathetic, conversational, approachable, light polite emojis allowed.',
    professional: 'Polished, business-consultative, respectful, objective, articulate.',
    enthusiastic: 'High energy, positive, proactive, exciting, encouraging.',
    concise: 'Brief, to the point, clear, direct questions, minimal small talk.',
  };

  const languageInstructions = {
    en: 'Primary language is English. If the lead writes in Hindi or Hinglish, switch and respond in their language.',
    hi: 'Primary language is Hindi (हिन्दी). If the lead writes in English or Hinglish, switch and respond in their language.',
    hinglish: 'Primary language is Hinglish (friendly mix of Hindi and English written in Latin script). If the lead prefers pure English or Hindi, adapt accordingly.',
  };

  // Format project & inventory context
  let projectContext = 'None specified';
  if (project) {
    projectContext = `Project Name: ${project.name} | Category: ${project.category || 'Real Estate'} | Status: ${project.status || 'Active'}`;
    if (project.description) projectContext += `\nDescription: ${project.description}`;
    if (project.budget) projectContext += `\nBudget/Price range: ${project.budget}`;
    if (inventory && inventory.length > 0) {
      projectContext += `\nAvailable Inventory:\n` + inventory.slice(0, 5).map((inv, idx) => ` - Unit ${idx + 1}: ${JSON.stringify(inv.data || inv)}`).join('\n');
    }
  }

  // Format knowledge base context
  let kbContext = 'None available';
  if (knowledgeArticles && knowledgeArticles.length > 0) {
    kbContext = knowledgeArticles
      .slice(0, 5)
      .map((k, idx) => `[Article ${idx + 1}] Q: ${k.question || k.title}\nA: ${k.answer || k.content}`)
      .join('\n---\n');
  }

  // Qualification questions list
  const qualQuestions = botSettings.qualification_questions || [
    { id: 'requirement', question: 'What kind of property or service are you looking for?' },
    { id: 'budget', question: 'What is your preferred budget range?' },
    { id: 'location', question: 'What is your preferred location?' },
    { id: 'timeline', question: 'When are you planning to make a decision?' },
  ];

  return `You are "${botName}", a ${persona} representing "${companyName}" on WhatsApp.
Your goal is to warmly engage the lead, answer questions using ONLY verified company knowledge, qualify the lead, and prepare them for a human expert.

IDENTITY & TONE:
- Name: ${botName}
- Persona: ${persona}
- Communication Style: ${style} (${toneGuidelines[style] || toneGuidelines.professional})
- Language Guideline: ${languageInstructions[primaryLang] || languageInstructions.en}

CRITICAL GUARDRAILS (NEVER VIOLATE):
1. Never invent or hallucinate prices, discounts, offers, or availability not explicitly present in the Project/Inventory or Knowledge Base data below.
2. Never promise discounts, freebies, or price reductions.
3. If the user asks a question about project details, policies, amenities, prices, documents, or terms that is NOT in the VERIFIED KNOWLEDGE BASE or Project data, DO NOT guess or fabricate answers. Strictly reply: "Our expert will confirm this detail for you."
4. KEEP REPLIES SHORT: Strictly under 60 words. WhatsApp users ignore long paragraphs.
5. NO MARKDOWN: Do not use bold asterisks (* or **), headers (#), underlines, or markdown syntax. Plain conversational text only.
6. ONE QUESTION AT A TIME: Ask only one question per turn to keep the conversation flowing smoothly.
7. If the lead asks to speak with a human or an executive, set wants_human to true.

LEAD DETAILS:
- Name: ${lead?.name || 'Valued Customer'}
- Phone: ${lead?.phone || 'Unknown'}
- Source: ${lead?.source || 'Inquiry'}
- Current Stage: ${lead?.stage || 'New'}
- Currently Collected Data: ${JSON.stringify(collectedData)}

PROJECT & INVENTORY KNOWLEDGE:
${projectContext}

VERIFIED KNOWLEDGE BASE:
${kbContext}

QUALIFICATION GOALS:
Gather the following information naturally, one question at a time:
${qualQuestions.map((q) => `- ${q.id}: ${q.question}`).join('\n')}

OUTPUT FORMAT:
You MUST respond with a strict valid JSON object without backticks or markdown fences:
{
  "reply": "Your WhatsApp message text (under 60 words, no markdown)",
  "extracted": {
    "requirement": "extracted property/service type or null",
    "budget": "extracted budget or null",
    "location": "extracted location or null",
    "timeline": "extracted timeline or null"
  },
  "intent": "inquiry | pricing | visit | human_request | other",
  "wants_human": false,
  "sentiment": "positive | neutral | negative"
}`;
};

/**
 * Resilient JSON extractor: extracts JSON from LLM response even if surrounded
 * by backticks, markdown fences, or conversational preambles.
 */
export const extractJsonFromResponse = (raw) => {
  if (!raw || typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw.trim());
  } catch (e) {}

  // Match JSON object inside text
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      // Clean trailing commas and retry
      try {
        const cleaned = match[0].replace(/,\s*([\]}])/g, '$1');
        return JSON.parse(cleaned);
      } catch (e2) {}
    }
  }

  return null;
};

/**
 * Smart heuristic rule engine: generates high quality, dynamic conversational
 * responses and accurately extracts lead qualifications (requirement, budget, location, timeline)
 * when LLM is offline or encounters an API error.
 */
export const generateFallbackResponse = ({ botSettings = {}, userMessage = '', collectedData = {}, knowledgeArticles = [] }) => {
  const botName = botSettings?.display_name || botSettings?.displayName || 'Aria';
  const lang = botSettings?.primary_language || botSettings?.language || 'en';
  const rawText = userMessage || '';
  const text = rawText.toLowerCase().trim();

  const extracted = { ...collectedData };
  let wants_human = false;
  let sentiment = 'neutral';
  let intent = 'inquiry';

  // 1. Human Request Detection
  const handoffKeywords = botSettings?.handoff_keywords || [
    'human', 'agent', 'executive', 'representative', 'call me', 'talk to human',
    'manager', 'connect', 'real person', 'salesperson', 'consultant', 'customer care',
    'speak to someone', 'call back'
  ];
  if (handoffKeywords.some((k) => text.includes(k.toLowerCase()))) {
    wants_human = true;
    intent = 'human_request';
  }

  // 2. Sentiment Detection
  if (/\b(bad|worst|angry|stop|fake|terrible|horrible|useless|scam|spam|fraud|annoying|hate|fraudulent)\b/i.test(text)) {
    sentiment = 'negative';
  } else if (/\b(good|great|interested|yes|thanks|thank you|awesome|perfect|super|nice|sure|okay|ok|glad)\b/i.test(text)) {
    sentiment = 'positive';
  }

  // 3. Extract Requirement
  if (/\b1\s*bhk\b/i.test(text) || /\b1bhk\b/i.test(text) || /\bone\s*bhk\b/i.test(text)) {
    extracted.requirement = '1 BHK';
  } else if (/\b2\s*bhk\b/i.test(text) || /\b2bhk\b/i.test(text) || /\btwo\s*bhk\b/i.test(text)) {
    extracted.requirement = '2 BHK';
  } else if (/\b3\s*bhk\b/i.test(text) || /\b3bhk\b/i.test(text) || /\bthree\s*bhk\b/i.test(text)) {
    extracted.requirement = '3 BHK';
  } else if (/\b4\s*bhk\b/i.test(text) || /\b4bhk\b/i.test(text) || /\bfour\s*bhk\b/i.test(text)) {
    extracted.requirement = '4 BHK';
  } else if (/\bvilla\b/i.test(text)) {
    extracted.requirement = 'Villa';
  } else if (/\b(plot|land)\b/i.test(text)) {
    extracted.requirement = 'Plot / Land';
  } else if (/\bpenthouse\b/i.test(text)) {
    extracted.requirement = 'Penthouse';
  } else if (/\bstudio\b/i.test(text)) {
    extracted.requirement = 'Studio Apartment';
  } else if (/\b(commercial|office|shop|retail)\b/i.test(text)) {
    extracted.requirement = 'Commercial Space';
  } else if (/\b(apartment|flat)\b/i.test(text) && !extracted.requirement) {
    extracted.requirement = 'Apartment';
  }

  // 4. Extract Budget
  const budgetMatch = rawText.match(/(\d+(?:\.\d+)?\s*(?:cr|crore|crores|lakh|lakhs|lacs|lac|k|thousand|rupees|rs))/i)
    || rawText.match(/(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:cr|crore|lakh|k))?)/i)
    || rawText.match(/\b\d{2,3}\s*(?:l|lac|cr)\b/i);
  if (budgetMatch) {
    extracted.budget = budgetMatch[0].trim();
  }

  // 5. Extract Location
  const knownLocations = [
    'delhi', 'new delhi', 'noida sector 150', 'noida sector 62', 'noida', 'greater noida',
    'gurgaon', 'gurugram', 'golf course road', 'sohna road', 'faridabad', 'ghaziabad', 'indirapuram',
    'mumbai', 'navi mumbai', 'thane', 'bandra', 'andheri', 'pune', 'hinjewadi',
    'bangalore', 'bengaluru', 'whitefield', 'sarjapur', 'electronic city',
    'hyderabad', 'hitech city', 'chennai', 'kolkata', 'chandigarh', 'jaipur', 'ahmedabad',
    'rohini', 'dwarka', 'south delhi', 'saket', 'vasant kunj', 'uttam nagar', 'janakpuri', 'pitampura'
  ];

  for (const loc of knownLocations) {
    if (text.includes(loc)) {
      extracted.location = loc.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      break;
    }
  }

  if (!extracted.location) {
    const locPattern = text.match(/\b(?:in|at|near|around)\s+([a-z\s]{3,20})(?:,|\.|\s+and|\s+with|$)/i);
    if (locPattern && locPattern[1]) {
      const candidate = locPattern[1].trim();
      const skipWords = ['budget', 'months', 'weeks', 'days', 'apartment', 'flat', 'property'];
      if (!skipWords.some((sw) => candidate.includes(sw))) {
        extracted.location = candidate.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }

  // 6. Extract Timeline & Visit Plans (English & Hinglish)
  const isSiteVisit = /\b(site\s*visit|visit|dekhne|aunga|aana|dekhna|aaye|visit\s*karunga)\b/i.test(text);
  const daysMatch = text.match(/\b(\d+)\s*(?:din|days?)\b/i);
  const isWeek = /\b(?:isi|this|next|agle)\s*(?:week|hafte)\b/i.test(text) || /\b(?:1|one)\s*week\b/i.test(text);
  const isBooking = /\b(booking|book|reserve|final|finalize)\b/i.test(text);

  if (isSiteVisit && daysMatch) {
    extracted.timeline = isBooking
      ? `Site visit in ${daysMatch[1]} days, booking soon`
      : `Site visit in ${daysMatch[1]} days`;
  } else if (isWeek) {
    extracted.timeline = isBooking ? 'Booking this/next week' : 'This / Next Week';
  } else if (daysMatch) {
    extracted.timeline = `Within ${daysMatch[1]} Days`;
  } else if (/\b(immediate|immediately|urgent|urgently|ready to move|asap|turant|jaldi|aaj|today|kal|tomorrow|parso|weekend|sunday|saturday)\b/i.test(text)) {
    extracted.timeline = 'Immediate / This Week';
  } else if (isSiteVisit) {
    extracted.timeline = 'Site Visit Planned';
  } else if (isBooking) {
    extracted.timeline = 'Ready for Booking';
  } else if (/\b(?:within|in|next|agle|andar)\s*(\d+)\s*(?:month|months|mahine|mahina)\b/i.test(text)) {
    const m = text.match(/\b(?:within|in|next|agle|andar)\s*(\d+)\s*(?:month|months|mahine|mahina)\b/i);
    extracted.timeline = `Within ${m[1]} Months`;
  } else if (/\b1\s*(?:month|mahina)\b/i.test(text) || /\bone\s*month\b/i.test(text) || /\bisi\s*mahine\b/i.test(text)) {
    extracted.timeline = 'Within 1 Month';
  } else if (/\b2\s*(?:months|mahine)\b/i.test(text) || /\btwo\s*months\b/i.test(text)) {
    extracted.timeline = 'Within 2 Months';
  } else if (/\b3\s*(?:months|mahine)\b/i.test(text) || /\bthree\s*months\b/i.test(text)) {
    extracted.timeline = 'Within 3 Months';
  } else if (/\b(this year|next year|by next year|planning stage|saal|agle saal)\b/i.test(text)) {
    extracted.timeline = 'Within 6-12 Months';
  } else if (extracted.requirement && extracted.location && extracted.budget && !extracted.timeline && text.length >= 3) {
    extracted.timeline = rawText.length > 35 ? rawText.slice(0, 35) + '...' : rawText;
  }

  // 7. Dynamic Conversational Follow-up
  let reply = '';
  const hasReq = Boolean(extracted.requirement);
  const hasLoc = Boolean(extracted.location);
  const hasBudget = Boolean(extracted.budget);
  const hasTimeline = Boolean(extracted.timeline);

  const isHindiInput = /\b(chahiye|karunga|aayi|dunga|mein|hai|batao|kripya|namaste|ji|din|hafte|mahine)\b/i.test(text) || lang === 'hi';
  const isQuestion = /\?|what|when|where|why|how|who|price|cost|rera|possession|booking|document|discount|offer|emi|loan|kya|kaise|kab|kaha|kitna/i.test(text);

  if (wants_human) {
    reply = isHindiInput
      ? `निश्चिंत रहें, हमारे वरिष्ठ सेल्स कंसलटेंट शीघ्र ही आपसे सीधे संपर्क करेंगे।`
      : `Certainly! I have alerted our senior property consultant. They will reach out to you directly on this number shortly.`;
  } else if (knowledgeArticles && knowledgeArticles.length > 0 && isQuestion) {
    // Verified KB article match response
    const topKb = knowledgeArticles[0];
    reply = topKb.answer || topKb.content;
  } else if (isQuestion && (!knowledgeArticles || knowledgeArticles.length === 0) && !hasReq) {
    // Safe fallback message for unmatched factual questions
    reply = isHindiInput
      ? `इस विवरण की पुष्टि हमारे एक्सपर्ट करके आपको शीघ्र बताएंगे। आप किस प्रकार की प्रॉपर्टी तलाश रहे हैं? जैसे 1 BHK, 2 BHK, 3 BHK या विला?`
      : `Our expert will confirm this detail for you shortly. In the meantime, what type of property are you looking for, such as a 2 BHK, 3 BHK, or Villa?`;
  } else if (!hasReq) {
    reply = isHindiInput
      ? `आप किस प्रकार की प्रॉपर्टी तलाश रहे हैं? जैसे 1 BHK, 2 BHK, 3 BHK या विला?`
      : `What type of property or unit are you looking for, such as a 2 BHK, 3 BHK, or Villa?`;
  } else if (!hasLoc) {
    reply = isHindiInput
      ? `बहुत बढ़िया! ${extracted.requirement} के लिए आपका पसंदीदा लोकेशन या शहर कौन सा रहेगा?`
      : `Great choice! For your ${extracted.requirement}, which preferred location or city do you have in mind?`;
  } else if (!hasBudget) {
    const locPhrase = hasLoc ? ` in ${extracted.location}` : '';
    const locPhraseHi = hasLoc ? ` (${extracted.location})` : '';
    reply = isHindiInput
      ? `शानदार! ${extracted.requirement}${locPhraseHi} के लिए आपका बजट दायरा क्या रहेगा?`
      : `Great! For a ${extracted.requirement}${locPhrase}, what is your comfortable budget range?`;
  } else if (!hasTimeline) {
    reply = isHindiInput
      ? `धन्यवाद! आप कब तक प्रॉपर्टी देखने या फाइनल करने की योजना बना रहे हैं?`
      : `Got it! When are you planning to finalize your decision or schedule a site visit?`;
  } else {
    const locText = hasLoc ? ` (${extracted.location})` : '';
    const budText = hasBudget ? `, बजट: ${extracted.budget}` : '';
    const timeText = hasTimeline ? `, प्लान: ${extracted.timeline}` : '';

    reply = isHindiInput
      ? `बहुत बढ़िया! मैंने आपकी आवश्यकता (${extracted.requirement}${locText}${budText}${timeText}) पूरी तरह नोट कर ली है। हमारे सीनियर सेल्स एक्सपर्ट आपके लिए बेस्ट ऑप्शंस लेकर जल्द ही कॉल करेंगे।`
      : `Thank you! I have noted all your details for ${extracted.requirement}${hasLoc ? ' in ' + extracted.location : ''}${hasBudget ? ' within ' + extracted.budget : ''} (${extracted.timeline}). Our senior expert will connect with you shortly with the best matching verified options.`;
  }

  return {
    reply: stripMarkdown(reply),
    extracted,
    intent,
    wants_human,
    sentiment,
  };
};

import { generateBotReply } from './llm/index.js';

/**
 * Main AI reply generation handler.
 * Connects to active LLM provider (Google Gemini or OpenAI) via the llm layer,
 * and seamlessly provides intelligent conversational qualification even if LLM is offline or has invalid key.
 */
export const generateAIReply = async ({
  botSettings = {},
  companyName = 'Digi India CRM',
  lead,
  project,
  inventory = [],
  knowledgeArticles = [],
  history = [],
  conversationHistory = [],
  userMessage,
  systemPrompt: customSystemPrompt,
  collectedData = {},
}) => {
  const mergedCollectedData = Object.keys(collectedData).length > 0
    ? { ...collectedData }
    : { ...(lead?.custom_fields || {}) };

  const systemPrompt = customSystemPrompt || buildSystemPrompt({
    botSettings,
    companyName,
    lead,
    project,
    inventory,
    knowledgeArticles,
    collectedData: mergedCollectedData,
  });

  const rawHistory = history && history.length > 0 ? history : conversationHistory;
  const formattedHistory = (rawHistory || []).slice(-10).map((m) => ({
    role: (m.role === 'assistant' || m.role === 'model' || m.sender === 'bot') ? 'model' : 'user',
    content: m.content || m.text || '',
  }));

  let result = null;
  try {
    result = await generateBotReply({
      systemPrompt,
      history: formattedHistory,
      userMessage,
    });
  } catch (err) {
    console.error('[generateAIReply] generateBotReply error:', err.message);
    result = { llmError: true, errorMessage: err.message };
  }

  // Check if LLM hit an error, returned no reply, or returned the canned static string
  const SAFE_FALLBACK_REPLY = 'Our expert will confirm this detail and connect with you shortly.';
  const isCannedOrEmpty = !result?.reply ||
    result.reply.trim() === SAFE_FALLBACK_REPLY ||
    result.llmError;

  if (isCannedOrEmpty) {
    // Run smart conversational heuristic qualifier
    const heuristic = generateFallbackResponse({
      botSettings,
      userMessage,
      collectedData: mergedCollectedData,
      knowledgeArticles,
    });

    return {
      reply: heuristic.reply,
      extracted: { ...mergedCollectedData, ...(heuristic.extracted || {}) },
      intent: heuristic.intent || 'inquiry',
      wants_human: heuristic.wants_human || false,
      sentiment: heuristic.sentiment || 'neutral',
      tokensUsed: result?.tokensUsed || 0,
      provider: result?.provider || (process.env.LLM_PROVIDER || 'gemini').toLowerCase(),
      model: result?.model || process.env.LLM_MODEL || 'gemini-2.5-flash-lite',
      llmError: result?.llmError ?? true,
      errorMessage: result?.errorMessage || 'LLM API offline/invalid key. Handled by Smart Heuristic Qualifier.',
      isFallback: true,
    };
  }

  // LLM succeeded: also augment any extractions the heuristic found so nothing is missed
  const heuristic = generateFallbackResponse({
    botSettings,
    userMessage,
    collectedData: mergedCollectedData,
    knowledgeArticles,
  });

  const mergedExtracted = {
    ...mergedCollectedData,
    ...(result.extracted || {}),
  };

  if (!mergedExtracted.requirement && heuristic.extracted?.requirement) {
    mergedExtracted.requirement = heuristic.extracted.requirement;
  }
  if (!mergedExtracted.budget && heuristic.extracted?.budget) {
    mergedExtracted.budget = heuristic.extracted.budget;
  }
  if (!mergedExtracted.location && heuristic.extracted?.location) {
    mergedExtracted.location = heuristic.extracted.location;
  }
  if (!mergedExtracted.timeline && heuristic.extracted?.timeline) {
    mergedExtracted.timeline = heuristic.extracted.timeline;
  }

  return {
    ...result,
    extracted: mergedExtracted,
    isFallback: false,
  };
};

// Alias export for turn-based simulation & webhook callers
export const generateBotTurnResponse = generateAIReply;
export { generateBotReply };

