/**
 * Knowledge Base Controller (Phase 2)
 * Full CRUD for Categories & Articles, Ranked Search, CSV Import/Export,
 * Automatic Project Inventory Sync, and Unanswered Questions workflow.
 */

import connectDB from '../pool.js';
import { resolveCompanyId } from '../bot/bot-settings-controller.js';
import { parseCsv, toCsv, getSampleCsvTemplate } from './kb-csv-helper.js';
import { kbSearch, recordArticleUsage } from './kb-search-service.js';

// ============================================================================
// 1. CATEGORIES CRUD
// ============================================================================

/**
 * List all categories for company with article counts
 */
export async function getCategories(req, res) {
  try {
    const companyId = await resolveCompanyId(req);

    const query = `
      SELECT 
        c.id,
        c.company_id,
        c.name,
        c.description,
        c.sort_order,
        c.created_at,
        c.updated_at,
        COUNT(a.id)::int AS article_count
      FROM public.kb_categories c
      LEFT JOIN public.kb_articles a ON c.id = a.category_id
      WHERE c.company_id = $1::uuid
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.created_at ASC
    `;

    const { rows } = await connectDB.query(query, [companyId]);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('[getCategories Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Create a new category
 */
export async function createCategory(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { name, description = '', sort_order } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    // Determine default sort order if not provided
    let order = Number(sort_order);
    if (isNaN(order)) {
      const maxRes = await connectDB.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM public.kb_categories WHERE company_id = $1::uuid`,
        [companyId]
      );
      order = maxRes.rows[0]?.next_order || 1;
    }

    const insertSql = `
      INSERT INTO public.kb_categories (company_id, name, description, sort_order, created_at, updated_at)
      VALUES ($1::uuid, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (company_id, name) 
      DO UPDATE SET description = EXCLUDED.description, updated_at = NOW()
      RETURNING *
    `;

    const { rows } = await connectDB.query(insertSql, [companyId, name.trim(), description.trim(), order]);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[createCategory Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Update an existing category
 */
export async function updateCategory(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;
    const { name, description, sort_order } = req.body;

    const sets = [];
    const vals = [companyId, id];
    let idx = 3;

    if (name !== undefined) {
      sets.push(`name = $${idx++}`);
      vals.push(name.trim());
    }
    if (description !== undefined) {
      sets.push(`description = $${idx++}`);
      vals.push(description.trim());
    }
    if (sort_order !== undefined) {
      sets.push(`sort_order = $${idx++}`);
      vals.push(Number(sort_order) || 0);
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields provided to update' });
    }

    sets.push(`updated_at = NOW()`);

    const updateSql = `
      UPDATE public.kb_categories
      SET ${sets.join(', ')}
      WHERE company_id = $1::uuid AND id = $2::uuid
      RETURNING *
    `;

    const { rows } = await connectDB.query(updateSql, vals);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[updateCategory Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Delete category (sets category_id of articles to NULL)
 */
export async function deleteCategory(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;

    // Check if category exists
    const catCheck = await connectDB.query(
      `SELECT id FROM public.kb_categories WHERE company_id = $1::uuid AND id = $2::uuid`,
      [companyId, id]
    );
    if (catCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Delete category (articles have ON DELETE SET NULL)
    await connectDB.query(
      `DELETE FROM public.kb_categories WHERE company_id = $1::uuid AND id = $2::uuid`,
      [companyId, id]
    );

    return res.status(200).json({ success: true, message: 'Category deleted successfully' });
  } catch (err) {
    console.error('[deleteCategory Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Reorder categories (drag-and-drop support)
 */
export async function reorderCategories(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds array is required' });
    }

    // Execute bulk update in a transaction
    await connectDB.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      const catId = orderedIds[i];
      await connectDB.query(
        `UPDATE public.kb_categories 
         SET sort_order = $1, updated_at = NOW() 
         WHERE company_id = $2::uuid AND id = $3::uuid`,
        [i + 1, companyId, catId]
      );
    }
    await connectDB.query('COMMIT');

    return res.status(200).json({ success: true, message: 'Categories reordered successfully' });
  } catch (err) {
    await connectDB.query('ROLLBACK').catch(() => {});
    console.error('[reorderCategories Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ============================================================================
// 2. ARTICLES CRUD
// ============================================================================

/**
 * List articles with pagination, filters, and search
 */
export async function getArticles(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const {
      page = 1,
      limit = 20,
      category_id,
      type,
      project_id,
      status,
      language,
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * pageSize;

    const whereClauses = [`a.company_id = $1::uuid`];
    const queryParams = [companyId];
    let paramIdx = 2;

    if (category_id && category_id !== 'all') {
      whereClauses.push(`a.category_id = $${paramIdx++}::uuid`);
      queryParams.push(category_id);
    }
    if (type && type !== 'all') {
      whereClauses.push(`a.type = $${paramIdx++}`);
      queryParams.push(type);
    }
    if (project_id && project_id !== 'all') {
      whereClauses.push(`a.project_id = $${paramIdx++}::uuid`);
      queryParams.push(project_id);
    }
    if (status && status !== 'all') {
      whereClauses.push(`a.status = $${paramIdx++}`);
      queryParams.push(status);
    }
    if (language && language !== 'all') {
      whereClauses.push(`a.language = $${paramIdx++}`);
      queryParams.push(language);
    }

    if (search && search.trim()) {
      whereClauses.push(`(
        a.question ILIKE $${paramIdx} OR 
        a.answer ILIKE $${paramIdx} OR 
        $${paramIdx + 1} = ANY(a.keywords) OR
        a.search_vector @@ plainto_tsquery('simple', $${paramIdx + 2})
      )`);
      queryParams.push(`%${search.trim()}%`);
      queryParams.push(search.trim().toLowerCase());
      queryParams.push(search.trim());
      paramIdx += 3;
    }

    const whereStr = whereClauses.join(' AND ');

    // 1. Total count query
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM public.kb_articles a
      WHERE ${whereStr}
    `;
    const countRes = await connectDB.query(countSql, queryParams);
    const total = countRes.rows[0]?.total || 0;

    // 2. Data query
    const dataSql = `
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
        a.is_auto_generated,
        a.created_at,
        a.updated_at
      FROM public.kb_articles a
      LEFT JOIN public.kb_categories c ON a.category_id = c.id
      LEFT JOIN public.projects p ON a.project_id = p.id
      WHERE ${whereStr}
      ORDER BY a.priority DESC, a.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const dataRes = await connectDB.query(dataSql, [...queryParams, pageSize, offset]);

    return res.status(200).json({
      success: true,
      data: {
        articles: dataRes.rows,
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    });
  } catch (err) {
    console.error('[getArticles Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Get article by ID
 */
export async function getArticleById(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;

    const query = `
      SELECT 
        a.*,
        c.name AS category_name,
        p.name AS project_name
      FROM public.kb_articles a
      LEFT JOIN public.kb_categories c ON a.category_id = c.id
      LEFT JOIN public.projects p ON a.project_id = p.id
      WHERE a.company_id = $1::uuid AND a.id = $2::uuid
    `;

    const { rows } = await connectDB.query(query, [companyId, id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[getArticleById Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Create a new article
 */
export async function createArticle(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const {
      category_id,
      project_id,
      type = 'faq',
      question,
      answer,
      keywords = [],
      language = 'en',
      status = 'published',
      priority = 0,
    } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ success: false, message: 'Answer is required' });
    }

    // Parse keywords into array
    let parsedKeywords = [];
    if (Array.isArray(keywords)) {
      parsedKeywords = keywords.map((k) => String(k).trim()).filter(Boolean);
    } else if (typeof keywords === 'string') {
      parsedKeywords = keywords.split(',').map((k) => k.trim()).filter(Boolean);
    }

    const userId = req.user?.id || null;

    const insertSql = `
      INSERT INTO public.kb_articles (
        company_id, category_id, project_id, type, question, answer,
        keywords, language, status, priority, created_by, is_auto_generated,
        created_at, updated_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, NOW(), NOW()
      )
      RETURNING *
    `;

    const { rows } = await connectDB.query(insertSql, [
      companyId,
      category_id || null,
      project_id || null,
      type,
      question.trim(),
      answer.trim(),
      parsedKeywords,
      language,
      status,
      Number(priority) || 0,
      userId,
    ]);

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[createArticle Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Update article
 */
export async function updateArticle(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;
    const {
      category_id,
      project_id,
      type,
      question,
      answer,
      keywords,
      language,
      status,
      priority,
      is_auto_generated,
    } = req.body;

    const sets = [];
    const vals = [companyId, id];
    let idx = 3;

    if (category_id !== undefined) {
      sets.push(`category_id = $${idx++}`);
      vals.push(category_id || null);
    }
    if (project_id !== undefined) {
      sets.push(`project_id = $${idx++}`);
      vals.push(project_id || null);
    }
    if (type !== undefined) {
      sets.push(`type = $${idx++}`);
      vals.push(type);
    }
    if (question !== undefined) {
      sets.push(`question = $${idx++}`);
      vals.push(question.trim());
    }
    if (answer !== undefined) {
      sets.push(`answer = $${idx++}`);
      vals.push(answer.trim());
    }
    if (keywords !== undefined) {
      let parsed = [];
      if (Array.isArray(keywords)) {
        parsed = keywords.map((k) => String(k).trim()).filter(Boolean);
      } else if (typeof keywords === 'string') {
        parsed = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      }
      sets.push(`keywords = $${idx++}`);
      vals.push(parsed);
    }
    if (language !== undefined) {
      sets.push(`language = $${idx++}`);
      vals.push(language);
    }
    if (status !== undefined) {
      sets.push(`status = $${idx++}`);
      vals.push(status);
    }
    if (priority !== undefined) {
      sets.push(`priority = $${idx++}`);
      vals.push(Number(priority) || 0);
    }
    if (is_auto_generated !== undefined) {
      sets.push(`is_auto_generated = $${idx++}`);
      vals.push(Boolean(is_auto_generated));
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields provided to update' });
    }

    sets.push(`updated_at = NOW()`);

    const updateSql = `
      UPDATE public.kb_articles
      SET ${sets.join(', ')}
      WHERE company_id = $1::uuid AND id = $2::uuid
      RETURNING *
    `;

    const { rows } = await connectDB.query(updateSql, vals);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[updateArticle Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Delete an article
 */
export async function deleteArticle(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;

    const delRes = await connectDB.query(
      `DELETE FROM public.kb_articles WHERE company_id = $1::uuid AND id = $2::uuid RETURNING id`,
      [companyId, id]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    return res.status(200).json({ success: true, message: 'Article deleted successfully' });
  } catch (err) {
    console.error('[deleteArticle Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ============================================================================
// 3. BULK IMPORT & EXPORT
// ============================================================================

/**
 * Bulk import articles from CSV file or JSON array
 */
export async function bulkImportArticles(req, res) {
  try {
    const companyId = await resolveCompanyId(req);

    let rows = [];
    if (req.file) {
      const csvString = req.file.buffer.toString('utf-8');
      rows = parseCsv(csvString);
    } else if (req.body?.csv) {
      rows = parseCsv(req.body.csv);
    } else if (Array.isArray(req.body?.rows)) {
      rows = req.body.rows;
    } else {
      return res.status(400).json({ success: false, message: 'Please upload a CSV file or provide rows array' });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid data rows found in CSV' });
    }

    // Pre-fetch categories and projects for fast lookup
    const { rows: categories } = await connectDB.query(
      `SELECT id, name FROM public.kb_categories WHERE company_id = $1::uuid`,
      [companyId]
    );
    const categoryMap = new Map();
    categories.forEach((c) => categoryMap.set(c.name.toLowerCase().trim(), c.id));

    const { rows: projects } = await connectDB.query(
      `SELECT id, name FROM public.projects WHERE company_id = $1::uuid`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    const projectMap = new Map();
    projects.forEach((p) => projectMap.set(p.name.toLowerCase().trim(), p.id));

    const errors = [];
    const validRowsToInsert = [];

    const allowedTypes = ['faq', 'product_info', 'policy', 'pricing', 'objection_handling'];
    const allowedLangs = ['en', 'hi', 'hinglish'];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // header is row 1

      const question = (r.question || '').trim();
      const answer = (r.answer || '').trim();
      const rawCategory = (r.category || r.category_name || '').trim();
      const rawType = (r.type || 'faq').toLowerCase().trim();
      const rawLang = (r.language || 'en').toLowerCase().trim();
      const rawProject = (r.project_name || r.project || '').trim();
      const rawKeywords = r.keywords || '';
      const priority = parseInt(r.priority || 0, 10) || 0;
      const status = (r.status || 'published').toLowerCase().trim() === 'draft' ? 'draft' : 'published';

      if (!question) {
        errors.push({ row: rowNum, question: 'Empty', error: 'Question column is required' });
        continue;
      }
      if (!answer) {
        errors.push({ row: rowNum, question, error: 'Answer column is required' });
        continue;
      }

      const type = allowedTypes.includes(rawType) ? rawType : 'faq';
      const language = allowedLangs.includes(rawLang) ? rawLang : 'en';

      // Parse keywords
      const keywords = Array.isArray(rawKeywords)
        ? rawKeywords
        : String(rawKeywords).split(/[,;]/).map((k) => k.trim()).filter(Boolean);

      // Resolve category (or will auto-create below)
      let categoryId = categoryMap.get(rawCategory.toLowerCase()) || null;

      // Resolve project
      let projectId = projectMap.get(rawProject.toLowerCase()) || null;

      validRowsToInsert.push({
        rowNum,
        question,
        answer,
        rawCategory,
        categoryId,
        projectId,
        type,
        keywords,
        language,
        status,
        priority,
      });
    }

    // Execute insertion in a database transaction
    let importedCount = 0;
    await connectDB.query('BEGIN');

    try {
      for (const item of validRowsToInsert) {
        // Auto-create category if specified and doesn't exist
        if (!item.categoryId && item.rawCategory) {
          const newCatRes = await connectDB.query(
            `INSERT INTO public.kb_categories (company_id, name, sort_order)
             VALUES ($1::uuid, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.kb_categories WHERE company_id = $1::uuid))
             ON CONFLICT (company_id, name) DO UPDATE SET updated_at = NOW()
             RETURNING id`,
            [companyId, item.rawCategory]
          );
          item.categoryId = newCatRes.rows[0]?.id;
          categoryMap.set(item.rawCategory.toLowerCase(), item.categoryId);
        }

        await connectDB.query(
          `INSERT INTO public.kb_articles (
            company_id, category_id, project_id, type, question, answer,
            keywords, language, status, priority, usage_count, is_auto_generated,
            created_at, updated_at
          ) VALUES (
            $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, false, NOW(), NOW()
          )`,
          [
            companyId,
            item.categoryId,
            item.projectId,
            item.type,
            item.question,
            item.answer,
            item.keywords,
            item.language,
            item.status,
            item.priority,
          ]
        );
        importedCount++;
      }
      await connectDB.query('COMMIT');
    } catch (insertErr) {
      await connectDB.query('ROLLBACK');
      throw insertErr;
    }

    return res.status(200).json({
      success: true,
      data: {
        totalRows: rows.length,
        importedCount,
        errorCount: errors.length,
        errors,
      },
    });
  } catch (err) {
    console.error('[bulkImportArticles Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Export articles to downloadable CSV
 */
export async function exportArticles(req, res) {
  try {
    const companyId = await resolveCompanyId(req);

    const query = `
      SELECT 
        c.name AS category,
        a.type,
        a.question,
        a.answer,
        array_to_string(a.keywords, ', ') AS keywords,
        p.name AS project_name,
        a.language,
        a.status,
        a.priority,
        a.usage_count,
        to_char(a.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
      FROM public.kb_articles a
      LEFT JOIN public.kb_categories c ON a.category_id = c.id
      LEFT JOIN public.projects p ON a.project_id = p.id
      WHERE a.company_id = $1::uuid
      ORDER BY c.sort_order ASC NULLS LAST, a.priority DESC, a.created_at DESC
    `;

    const { rows } = await connectDB.query(query, [companyId]);

    const columns = [
      { key: 'category', label: 'Category' },
      { key: 'type', label: 'Type' },
      { key: 'question', label: 'Question' },
      { key: 'answer', label: 'Answer' },
      { key: 'keywords', label: 'Keywords' },
      { key: 'project_name', label: 'Project' },
      { key: 'language', label: 'Language' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'usage_count', label: 'Usage Count' },
      { key: 'updated_at', label: 'Updated At' },
    ];

    const csvContent = toCsv(rows, columns);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="knowledge-base-export-${Date.now()}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('[exportArticles Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Get sample downloadable CSV template
 */
export function getSampleCsv(req, res) {
  const sample = getSampleCsvTemplate();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="knowledge-base-sample-template.csv"');
  return res.status(200).send(sample);
}

// ============================================================================
// 4. PROJECT INVENTORY SYNC
// ============================================================================

/**
 * Automatically creates/updates product_info articles from active projects & inventory
 */
export async function syncProjectsToArticles(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { force = false } = req.body;

    // 1. Fetch or create a "Projects & Inventory" category
    let categoryId;
    const catRes = await connectDB.query(
      `SELECT id FROM public.kb_categories WHERE company_id = $1::uuid AND name ILIKE '%project%' LIMIT 1`,
      [companyId]
    );
    if (catRes.rows.length > 0) {
      categoryId = catRes.rows[0].id;
    } else {
      const newCat = await connectDB.query(
        `INSERT INTO public.kb_categories (company_id, name, description, sort_order)
         VALUES ($1::uuid, 'Projects & Inventory', 'Automated verified project specifications and available units', 2)
         RETURNING id`,
        [companyId]
      );
      categoryId = newCat.rows[0]?.id;
    }

    // 2. Fetch projects
    const { rows: projects } = await connectDB.query(
      `SELECT * FROM public.projects WHERE company_id = $1::uuid ORDER BY created_at DESC`,
      [companyId]
    ).catch(() => ({ rows: [] }));

    if (projects.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No projects found to sync',
        data: { syncedProjects: 0, createdCount: 0, updatedCount: 0 },
      });
    }

    // 3. Fetch project inventories
    const { rows: inventories } = await connectDB.query(
      `SELECT id, project_id, data FROM public.project_inventory`
    ).catch(() => ({ rows: [] }));

    const invByProject = {};
    inventories.forEach((inv) => {
      const pid = String(inv.project_id);
      if (!invByProject[pid]) invByProject[pid] = [];
      const d = typeof inv.data === 'string' ? JSON.parse(inv.data || '{}') : (inv.data || {});
      invByProject[pid].push({ id: inv.id, ...d });
    });

    let createdCount = 0;
    let updatedCount = 0;

    for (const proj of projects) {
      const pid = String(proj.id);
      const projUnits = invByProject[pid] || [];

      // Calculate unit types and inventory summary
      const totalUnits = projUnits.length;
      const availableUnits = projUnits.filter((u) => {
        const s = String(u.status || '').toLowerCase();
        return !s.includes('sold') && !s.includes('booked') && !s.includes('closed');
      }).length;

      // Extract unique types/configurations from inventory
      const configurations = [...new Set(projUnits.map((u) => u.type || u.unit_type || u.bhk).filter(Boolean))];
      const configStr = configurations.length > 0 ? configurations.join(', ') : '2 BHK, 3 BHK luxury residences';

      // Build structured Q&A
      const question = `What are the details, pricing, and available units for ${proj.name}?`;

      let answer = `${proj.name} is a verified ${proj.category || 'Residential'} project. `;
      if (proj.description) answer += `${proj.description} `;
      if (proj.budget) answer += `Price range is approximately ${proj.budget}. `;
      if (proj.location) answer += `Location: ${proj.location}. `;
      answer += `Configurations offered: ${configStr}. Total units: ${totalUnits}, with ${availableUnits} units currently open for booking.`;

      const keywords = [
        proj.name.toLowerCase(),
        (proj.category || 'real estate').toLowerCase(),
        'price',
        'budget',
        'units',
        'inventory',
        'availability',
        'details',
      ];
      if (proj.location) keywords.push(proj.location.toLowerCase());

      // Check existing article for this project
      const existingRes = await connectDB.query(
        `SELECT id, is_auto_generated FROM public.kb_articles 
         WHERE company_id = $1::uuid AND project_id = $2::uuid LIMIT 1`,
        [companyId, proj.id]
      );

      if (existingRes.rows.length === 0) {
        // Insert new auto-generated article
        await connectDB.query(
          `INSERT INTO public.kb_articles (
            company_id, category_id, project_id, type, question, answer,
            keywords, language, status, priority, usage_count, is_auto_generated,
            created_at, updated_at
          ) VALUES (
            $1::uuid, $2, $3, 'product_info', $4, $5, $6, 'en', 'published', 10, 0, true, NOW(), NOW()
          )`,
          [companyId, categoryId, proj.id, question, answer, keywords]
        );
        createdCount++;
      } else {
        const existing = existingRes.rows[0];
        // Only overwrite if it was auto-generated or force flag is on
        if (existing.is_auto_generated || force) {
          await connectDB.query(
            `UPDATE public.kb_articles 
             SET question = $1, answer = $2, keywords = $3, updated_at = NOW(), is_auto_generated = true
             WHERE id = $4::uuid`,
            [question, answer, keywords, existing.id]
          );
          updatedCount++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Projects synced successfully: ${createdCount} created, ${updatedCount} updated`,
      data: {
        syncedProjects: projects.length,
        createdCount,
        updatedCount,
      },
    });
  } catch (err) {
    console.error('[syncProjectsToArticles Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ============================================================================
// 5. RANKED SEARCH ENDPOINT
// ============================================================================

/**
 * Executes ranked search (used by bot testing & UI search preview)
 */
export async function searchArticlesEndpoint(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { q, project_id, limit = 5 } = req.query;

    if (!q || !q.trim()) {
      return res.status(200).json({ success: true, data: [] });
    }

    const results = await kbSearch(companyId, q, {
      projectId: project_id || null,
      limit: parseInt(limit, 10) || 5,
    });

    return res.status(200).json({
      success: true,
      query: q.trim(),
      totalMatches: results.length,
      data: results,
    });
  } catch (err) {
    console.error('[searchArticlesEndpoint Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ============================================================================
// 6. UNANSWERED QUESTIONS WORKFLOW
// ============================================================================

/**
 * List unanswered questions with filters and pagination
 */
export async function getUnansweredQuestions(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { status = 'open', page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * pageSize;

    const whereClauses = [`u.company_id = $1::uuid`];
    const vals = [companyId];
    let idx = 2;

    if (status && status !== 'all') {
      whereClauses.push(`u.status = $${idx++}`);
      vals.push(status);
    }

    const whereStr = whereClauses.join(' AND ');

    const countRes = await connectDB.query(
      `SELECT COUNT(*)::int AS total FROM public.kb_unanswered u WHERE ${whereStr}`,
      vals
    );
    const total = countRes.rows[0]?.total || 0;

    const query = `
      SELECT 
        u.id,
        u.company_id,
        u.lead_id,
        l.name AS lead_name,
        l.phone AS lead_phone,
        u.question_text,
        u.bot_conversation_id,
        u.status,
        u.resolved_article_id,
        a.question AS resolved_article_question,
        u.created_at
      FROM public.kb_unanswered u
      LEFT JOIN public.leads l ON u.lead_id = l.id
      LEFT JOIN public.kb_articles a ON u.resolved_article_id = a.id
      WHERE ${whereStr}
      ORDER BY u.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const { rows } = await connectDB.query(query, [...vals, pageSize, offset]);

    return res.status(200).json({
      success: true,
      data: {
        unanswered: rows,
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    });
  } catch (err) {
    console.error('[getUnansweredQuestions Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Update unanswered question status or link to article
 */
export async function updateUnansweredStatus(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;
    const { status, resolved_article_id } = req.body;

    if (!['open', 'resolved', 'ignored'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be open, resolved, or ignored' });
    }

    const updateSql = `
      UPDATE public.kb_unanswered
      SET status = $1, resolved_article_id = $2
      WHERE company_id = $3::uuid AND id = $4::uuid
      RETURNING *
    `;

    const { rows } = await connectDB.query(updateSql, [
      status,
      resolved_article_id || null,
      companyId,
      id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Unanswered question not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[updateUnansweredStatus Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * One-click create an article from an unanswered question and mark it resolved
 */
export async function createArticleFromUnanswered(req, res) {
  try {
    const companyId = await resolveCompanyId(req);
    const { id } = req.params;
    const {
      answer,
      category_id,
      type = 'faq',
      question: customQuestion,
      keywords = [],
      language = 'en',
      priority = 5,
    } = req.body;

    if (!answer || !answer.trim()) {
      return res.status(400).json({ success: false, message: 'Answer is required' });
    }

    // Fetch unanswered row
    const unRes = await connectDB.query(
      `SELECT * FROM public.kb_unanswered WHERE company_id = $1::uuid AND id = $2::uuid`,
      [companyId, id]
    );
    if (unRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Unanswered question not found' });
    }

    const unItem = unRes.rows[0];
    const finalQuestion = (customQuestion || unItem.question_text).trim();

    // Parse keywords
    let parsedKeywords = [];
    if (Array.isArray(keywords)) {
      parsedKeywords = keywords.map((k) => String(k).trim()).filter(Boolean);
    } else if (typeof keywords === 'string') {
      parsedKeywords = keywords.split(',').map((k) => k.trim()).filter(Boolean);
    }

    // Transaction: Insert article and resolve question
    await connectDB.query('BEGIN');

    const insertSql = `
      INSERT INTO public.kb_articles (
        company_id, category_id, type, question, answer, keywords,
        language, status, priority, usage_count, is_auto_generated, created_at, updated_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7, 'published', $8, 0, false, NOW(), NOW()
      )
      RETURNING *
    `;

    const artRes = await connectDB.query(insertSql, [
      companyId,
      category_id || null,
      type,
      finalQuestion,
      answer.trim(),
      parsedKeywords,
      language,
      Number(priority) || 5,
    ]);

    const createdArticle = artRes.rows[0];

    // Mark unanswered question as resolved
    await connectDB.query(
      `UPDATE public.kb_unanswered 
       SET status = 'resolved', resolved_article_id = $1::uuid 
       WHERE id = $2::uuid`,
      [createdArticle.id, id]
    );

    await connectDB.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Article created and question marked as resolved',
      data: createdArticle,
    });
  } catch (err) {
    await connectDB.query('ROLLBACK').catch(() => {});
    console.error('[createArticleFromUnanswered Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ============================================================================
// 7. USAGE TRACKING ENDPOINT
// ============================================================================

/**
 * Increment usage count for articles
 */
export async function recordUsageEndpoint(req, res) {
  try {
    const { articleIds } = req.body;
    await recordArticleUsage(articleIds);
    return res.status(200).json({ success: true, message: 'Usage counts updated' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
