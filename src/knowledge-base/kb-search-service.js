/**
 * Knowledge Base Ranked Search Service
 * Powers both the bot engine prompt builder and the "Test Search" UI panel.
 * Uses PostgreSQL full-text search (tsvector + ts_rank) with priority and project boosts.
 */

import connectDB from '../pool.js';

/**
 * Executes a multi-tenant ranked search against published knowledge base articles
 *
 * @param {string} companyId - UUID of the company
 * @param {string} query - Lead question or search phrase
 * @param {Object} options
 * @param {string|null} options.projectId - Optional project UUID to boost relevant project articles
 * @param {number} options.limit - Max number of articles to return (default: 5)
 * @param {number} options.minScore - Minimum relevance threshold (default: 0.05)
 * @returns {Promise<Array<Object>>} Ranked list of matching articles
 */
export async function kbSearch(companyId, query, { projectId = null, limit = 5, minScore = 0.05 } = {}) {
  if (!companyId || !query || !String(query).trim()) {
    return [];
  }

  const cleanQuery = String(query).trim();
  const maxLimit = Math.min(20, Math.max(1, Number(limit) || 5));

  try {
    // 1. Primary Full-Text Search with ts_rank and priority/project boosts
    const tsQuerySql = `
      SELECT 
        a.id,
        a.company_id,
        a.category_id,
        c.name AS category_name,
        a.project_id,
        p.name AS project_name,
        a.type,
        a.question,
        a.answer,
        a.keywords,
        a.language,
        a.status,
        a.priority,
        a.usage_count,
        a.last_used_at,
        ROUND(
          (
            ts_rank(a.search_vector, plainto_tsquery('simple', $2)) * 1.5 +
            (COALESCE(a.priority, 0) * 0.03) +
            (CASE WHEN $3::uuid IS NOT NULL AND a.project_id = $3::uuid THEN 0.35 ELSE 0.0 END)
          )::numeric, 4
        ) AS score
      FROM public.kb_articles a
      LEFT JOIN public.kb_categories c ON a.category_id = c.id
      LEFT JOIN public.projects p ON a.project_id = p.id
      WHERE a.company_id = $1::uuid
        AND a.status = 'published'
        AND a.search_vector @@ plainto_tsquery('simple', $2)
      ORDER BY score DESC, a.priority DESC, a.usage_count DESC
      LIMIT $4
    `;

    const tsResult = await connectDB.query(tsQuerySql, [companyId, cleanQuery, projectId, maxLimit]);
    let matchedArticles = tsResult.rows;

    // 2. If Full-Text Search found fewer than requested limit, execute secondary ILIKE keyword fallback
    if (matchedArticles.length < maxLimit) {
      const existingIds = matchedArticles.map((m) => m.id);
      const remainingLimit = maxLimit - matchedArticles.length;

      // Extract meaningful words (> 2 chars) for ILIKE matching
      const words = cleanQuery
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
        .filter((w) => w.length >= 3)
        .slice(0, 5);

      if (words.length > 0) {
        const ilikeConditions = words.map((_, idx) => `
          (a.question ILIKE $${idx + 4} OR a.answer ILIKE $${idx + 4} OR $${idx + 4} = ANY(a.keywords))
        `).join(' OR ');

        const ilikeParams = [
          companyId,
          projectId,
          existingIds,
          ...words.map((w) => `%${w}%`),
        ];

        const fallbackSql = `
          SELECT 
            a.id,
            a.company_id,
            a.category_id,
            c.name AS category_name,
            a.project_id,
            p.name AS project_name,
            a.type,
            a.question,
            a.answer,
            a.keywords,
            a.language,
            a.status,
            a.priority,
            a.usage_count,
            a.last_used_at,
            ROUND(
              (
                0.20 +
                (COALESCE(a.priority, 0) * 0.02) +
                (CASE WHEN $2::uuid IS NOT NULL AND a.project_id = $2::uuid THEN 0.30 ELSE 0.0 END)
              )::numeric, 4
            ) AS score
          FROM public.kb_articles a
          LEFT JOIN public.kb_categories c ON a.category_id = c.id
          LEFT JOIN public.projects p ON a.project_id = p.id
          WHERE a.company_id = $1::uuid
            AND a.status = 'published'
            AND NOT (a.id = ANY($3::uuid[]))
            AND (${ilikeConditions})
          ORDER BY a.priority DESC, a.usage_count DESC
          LIMIT ${remainingLimit}
        `;

        try {
          const fallbackRes = await connectDB.query(fallbackSql, ilikeParams);
          matchedArticles = [...matchedArticles, ...fallbackRes.rows];
        } catch (e) {
          // If secondary query had a syntax edge case, keep primary results
        }
      }
    }

    // Format output and parse numeric score
    return matchedArticles
      .map((item) => ({
        ...item,
        score: parseFloat(item.score || 0),
        usage_count: parseInt(item.usage_count || 0, 10),
        priority: parseInt(item.priority || 0, 10),
      }))
      .filter((item) => item.score >= minScore)
      .slice(0, maxLimit);
  } catch (err) {
    console.error('[KB Search Error]:', err.message);
    return [];
  }
}

/**
 * Increments usage_count and updates last_used_at timestamp when articles are used by the bot
 * @param {Array<string>} articleIds - Array of article UUIDs
 */
export async function recordArticleUsage(articleIds = []) {
  if (!Array.isArray(articleIds) || articleIds.length === 0) return;

  const validIds = articleIds.filter((id) => id && typeof id === 'string' && id.length > 10);
  if (validIds.length === 0) return;

  try {
    await connectDB.query(`
      UPDATE public.kb_articles
      SET 
        usage_count = usage_count + 1,
        last_used_at = NOW(),
        updated_at = NOW()
      WHERE id = ANY($1::uuid[])
    `, [validIds]);
  } catch (err) {
    console.warn('[KB recordArticleUsage Error]:', err.message);
  }
}

/**
 * Logs an unanswered question when the bot could not find a relevant KB article
 */
export async function logUnansweredQuestion({
  companyId,
  leadId = null,
  questionText,
  botConversationId = null,
}) {
  if (!companyId || !questionText || !questionText.trim()) return null;

  try {
    const res = await connectDB.query(`
      INSERT INTO public.kb_unanswered (
        company_id, lead_id, question_text, bot_conversation_id, status, created_at
      ) VALUES ($1, $2, $3, $4, 'open', NOW())
      RETURNING *
    `, [companyId, leadId, questionText.trim(), botConversationId]);

    return res.rows[0];
  } catch (err) {
    console.warn('[KB logUnansweredQuestion Error]:', err.message);
    return null;
  }
}
