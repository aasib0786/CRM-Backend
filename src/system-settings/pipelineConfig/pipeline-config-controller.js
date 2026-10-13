// src/pipeline-config/pipeline-config-controller.js
import { connectDB as pool } from "../../pool.js";
import { logActivity } from "../../activities/activityLogger.js";
import { getScoringConfigFromDb, recalculateAllLeadScores } from "../../leads/scoringService.js";
import { getAssignmentConfigFromDb } from "../../leads/assignmentService.js";

// ══════════════════════════════════════════════════════════════
// PIPELINE STAGES
// ══════════════════════════════════════════════════════════════

// GET /pipeline-stages/get-all
export const getPipelineStages = async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT
        ps.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         sef.id,
              'label',      sef.label,
              'type',       sef.type,
              'required',   sef.required,
              'options',    sef.options,
              'sort_order', sef.sort_order,
              'is_active',  sef.is_active
            ) ORDER BY sef.sort_order
          ) FILTER (WHERE sef.id IS NOT NULL),
          '[]'
        ) AS extra_fields
      FROM pipeline_stages ps
      LEFT JOIN stage_extra_fields sef ON sef.stage_id = ps.id AND sef.is_active = true
      WHERE ps.is_active = true
      GROUP BY ps.id
      ORDER BY ps.sort_order ASC, ps.id ASC
    `);

        return res.status(200).json({
            success: true,
            data: result.rows.map((r) => ({
                id: r.id,
                name: r.name,
                color: r.color,
                required: r.required,
                sortOrder: r.sort_order,
                extraFields: r.extra_fields || [],
                createdAt: r.created_at,
                updatedAt: r.updated_at,
            })),
        });
    } catch (error) {
        console.error('getPipelineStages error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch pipeline stages', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// GET /pipeline-stages/get-by-id/:id
export const getPipelineStageById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT ps.*, COALESCE(json_agg(json_build_object('id',sef.id,'label',sef.label,'type',sef.type,'required',sef.required,'options',sef.options,'sort_order',sef.sort_order) ORDER BY sef.sort_order) FILTER (WHERE sef.id IS NOT NULL),'[]') AS extra_fields
       FROM pipeline_stages ps
       LEFT JOIN stage_extra_fields sef ON sef.stage_id = ps.id AND sef.is_active = true
       WHERE ps.id = $1 GROUP BY ps.id`,
            [id]
        );
        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Stage not found' });
        const r = result.rows[0];
        return res.status(200).json({ success: true, data: { id: r.id, name: r.name, color: r.color, required: r.required, sortOrder: r.sort_order, extraFields: r.extra_fields || [] } });
    } catch (error) {
        console.error('getPipelineStageById error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch stage' });
    }
};

// POST /pipeline-stages/create
export const createPipelineStage = async (req, res) => {
    try {
        const { name, color, required, sortOrder } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, message: 'Stage name is required' });

        const existing = await pool.query(`SELECT id FROM pipeline_stages WHERE name ILIKE $1`, [name.trim()]);
        if (existing.rows.length > 0) return res.status(409).json({ success: false, message: `Stage "${name}" already exists` });

        const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM pipeline_stages`);
        const result = await pool.query(
            `INSERT INTO pipeline_stages (name, color, required, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
            [name.trim(), color || '#64748b', required ?? true, sortOrder ?? maxOrder.rows[0].next]
        );

        const createdStage = result.rows[0];
        await logActivity({
            type: 'stage_change',
            title: 'Pipeline stage created',
            description: `Pipeline stage "${createdStage.name}" created`,
            userName: req.user?.name || 'Admin',
            action: 'created pipeline stage',
            leadName: createdStage.name,
            detail: `Color: ${createdStage.color} • Sort Order: ${createdStage.sort_order}`,
        });

        return res.status(201).json({ success: true, message: 'Stage created successfully', data: createdStage });
    } catch (error) {
        console.error('createPipelineStage error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create stage', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// PUT/PATCH /pipeline-stages/update/:id
export const updatePipelineStage = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, color, required, sortOrder, isActive } = req.body;

        const existing = await pool.query(`SELECT id, name FROM pipeline_stages WHERE id = $1`, [id]);
        if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Stage not found' });

        const sets = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) { sets.push(`name = $${idx}`); values.push(name.trim()); idx++; }
        if (color !== undefined) { sets.push(`color = $${idx}`); values.push(color); idx++; }
        if (required !== undefined) { sets.push(`required = $${idx}`); values.push(required); idx++; }
        if (sortOrder !== undefined) { sets.push(`sort_order = $${idx}`); values.push(sortOrder); idx++; }
        if (isActive !== undefined) { sets.push(`is_active = $${idx}`); values.push(isActive); idx++; }
        sets.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(`UPDATE pipeline_stages SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        const updatedStage = result.rows[0];

        await logActivity({
            type: 'stage_change',
            title: 'Pipeline stage updated',
            description: `Pipeline stage "${updatedStage.name}" updated`,
            userName: req.user?.name || 'Admin',
            action: 'updated pipeline stage',
            leadName: updatedStage.name,
            detail: `Color: ${updatedStage.color} • Sort Order: ${updatedStage.sort_order}`,
        });

        return res.status(200).json({ success: true, message: 'Stage updated', data: updatedStage });
    } catch (error) {
        console.error('updatePipelineStage error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update stage', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// DELETE /pipeline-stages/delete/:id
export const deletePipelineStage = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query(`SELECT id, name FROM pipeline_stages WHERE id = $1`, [id]);
        if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Stage not found' });

        const stageName = existing.rows[0].name;

        // Soft delete
        await pool.query(`UPDATE pipeline_stages SET is_active = false, updated_at = NOW() WHERE id = $1`, [id]);

        await logActivity({
            type: 'stage_change',
            title: 'Pipeline stage deleted',
            description: `Pipeline stage "${stageName}" deleted`,
            userName: req.user?.name || 'Admin',
            action: 'deleted pipeline stage',
            leadName: stageName,
            detail: `Stage "${stageName}" removed`,
        });

        return res.status(200).json({ success: true, message: 'Stage deleted', data: { id, name: stageName } });
    } catch (error) {
        console.error('deletePipelineStage error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete stage' });
    }
};

// // POST /pipeline-stages/bulk-save — save all stages at once (from "Save Pipeline Stages" button)
// export const bulkSavePipelineStages = async (req, res) => {
//     try {
//         const { stages } = req.body; // [{ id?, name, color, required, sortOrder }]
//         console.log("AAAAA" ,stages)
//         if (!Array.isArray(stages) || stages.length === 0) {
//             return res.status(400).json({ success: false, message: 'stages array is required' });
//         }

//         const client = await pool.connect();
//         try {
//             await client.query('BEGIN');

//             // Soft-delete all existing
//             await client.query(`UPDATE pipeline_stages SET is_active = false WHERE is_active = true`);

//             const saved = [];
//             for (let i = 0; i < stages.length; i++) {
//                 const s = stages[i];
//                 if (!s.name?.trim()) continue;

//                 // Upsert by name
//                 const result = await client.query(
//                     `INSERT INTO pipeline_stages (name, color, required, sort_order, is_active, created_at, updated_at)
//            VALUES ($1, $2, $3, $4, true, NOW(), NOW())
//            ON CONFLICT (name) DO UPDATE SET
//              color = EXCLUDED.color,
//              required = EXCLUDED.required,
//              sort_order = EXCLUDED.sort_order,
//              is_active = true,
//              updated_at = NOW()
//            RETURNING *`,
//                     [s.name.trim(), s.color || '#64748b', s.required ?? true, i]
//                 );
//                 saved.push(result.rows[0]);
//             }



//             await client.query('COMMIT');
//             return res.status(200).json({ success: true, message: `${saved.length} stage(s) saved`, data: saved });
//         } catch (err) {
//             await client.query('ROLLBACK');
//             throw err;
//         } finally {
//             client.release();
//         }
//     } catch (error) {
//         console.error('bulkSavePipelineStages error:', error.message);
//         return res.status(500).json({ success: false, message: 'Failed to save stages', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
//     }
// };

// POST /pipeline-stages/bulk-save
export const bulkSavePipelineStages = async (req, res) => {
    try {
        const { stages } = req.body;
        if (!Array.isArray(stages) || stages.length === 0) {
            return res.status(400).json({ success: false, message: 'stages array is required' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // ✅ Soft-delete all existing stages
            await client.query(`UPDATE pipeline_stages SET is_active = false WHERE is_active = true`);

            // ✅ Soft-delete all existing extra fields
            await client.query(`UPDATE stage_extra_fields SET is_active = false WHERE is_active = true`);

            const saved = [];

            for (let i = 0; i < stages.length; i++) {
                const s = stages[i];
                if (!s.name?.trim()) continue;

                // ✅ Upsert stage by name
                const stageResult = await client.query(
                    `INSERT INTO pipeline_stages (name, color, required, sort_order, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, NOW(), NOW())
           ON CONFLICT (name) DO UPDATE SET
             color      = EXCLUDED.color,
             required   = EXCLUDED.required,
             sort_order = EXCLUDED.sort_order,
             is_active  = true,
             updated_at = NOW()
           RETURNING *`,
                    [s.name.trim(), s.color || '#64748b', s.required ?? true, i]
                );

                const stageRow = stageResult.rows[0];

                // ✅ Save extraFields for this stage
                const extraFields = Array.isArray(s.extraFields) ? s.extraFields : [];

                for (let j = 0; j < extraFields.length; j++) {
                    const f = extraFields[j];
                    if (!f.label?.trim()) continue;

                    await client.query(
                        `INSERT INTO stage_extra_fields
               (stage_id, label, type, required, options, sort_order, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
             ON CONFLICT (stage_id, label) DO UPDATE SET
               type       = EXCLUDED.type,
               required   = EXCLUDED.required,
               options    = EXCLUDED.options,
               sort_order = EXCLUDED.sort_order,
               is_active  = true,
               updated_at = NOW()`,
                        [
                            stageRow.id,
                            f.label.trim(),
                            f.type || 'Text Input',
                            f.required ?? false,
                            JSON.stringify(f.options || []),
                            j,
                        ]
                    );
                }

                // ✅ Fetch saved extra fields to include in response
                const fieldsResult = await client.query(
                    `SELECT * FROM stage_extra_fields
           WHERE stage_id = $1 AND is_active = true
           ORDER BY sort_order ASC`,
                    [stageRow.id]
                );

                saved.push({
                    id: stageRow.id,
                    name: stageRow.name,
                    color: stageRow.color,
                    required: stageRow.required,
                    sortOrder: stageRow.sort_order,
                    isActive: stageRow.is_active,
                    extraFields: fieldsResult.rows.map((ef) => ({
                        id: ef.id,
                        label: ef.label,
                        type: ef.type,
                        required: ef.required,
                        options: ef.options || [],
                        sortOrder: ef.sort_order,
                    })),
                    createdAt: stageRow.created_at,
                    updatedAt: stageRow.updated_at,
                });
            }

            await client.query('COMMIT');
            return res.status(200).json({
                success: true,
                message: `${saved.length} stage(s) saved`,
                data: saved,
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('bulkSavePipelineStages error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to save stages',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};
// ── Stage Extra Fields ────────────────────────────────────────

// GET /pipeline-stages/stage-fields/:stageId
export const getStageExtraFields = async (req, res) => {
    try {
        const { stageId } = req.params;
        const result = await pool.query(
            `SELECT * FROM stage_extra_fields WHERE stage_id = $1 AND is_active = true ORDER BY sort_order ASC`,
            [stageId]
        );
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('getStageExtraFields error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch stage fields' });
    }
};

// POST /pipeline-stages/stage-fields/:stageId/create
export const createStageExtraField = async (req, res) => {
    try {
        const { stageId } = req.params;
        const { label, type, required, options } = req.body;
        if (!label?.trim()) return res.status(400).json({ success: false, message: 'Field label is required' });

        const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM stage_extra_fields WHERE stage_id = $1`, [stageId]);
        const result = await pool.query(
            `INSERT INTO stage_extra_fields (stage_id, label, type, required, options, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *`,
            [stageId, label.trim(), type || 'Text Input', required ?? false, JSON.stringify(options || []), maxOrder.rows[0].next]
        );
        return res.status(201).json({ success: true, message: 'Field created', data: result.rows[0] });
    } catch (error) {
        console.error('createStageExtraField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create field', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// PATCH /pipeline-stages/stage-fields/update/:fieldId
export const updateStageExtraField = async (req, res) => {
    try {
        const { fieldId } = req.params;
        const { label, type, required, options, isActive } = req.body;
        const sets = []; const values = []; let idx = 1;
        if (label !== undefined) { sets.push(`label = $${idx}`); values.push(label.trim()); idx++; }
        if (type !== undefined) { sets.push(`type = $${idx}`); values.push(type); idx++; }
        if (required !== undefined) { sets.push(`required = $${idx}`); values.push(required); idx++; }
        if (isActive !== undefined) { sets.push(`is_active = $${idx}`); values.push(isActive); idx++; }
        if (options !== undefined) { sets.push(`options = $${idx}`); values.push(JSON.stringify(options)); idx++; }
        sets.push(`updated_at = NOW()`);
        values.push(fieldId);
        const result = await pool.query(`UPDATE stage_extra_fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Field not found' });
        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('updateStageExtraField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update field' });
    }
};

// DELETE /pipeline-stages/stage-fields/delete/:fieldId
export const deleteStageExtraField = async (req, res) => {
    try {
        const { fieldId } = req.params;
        await pool.query(`UPDATE stage_extra_fields SET is_active = false, updated_at = NOW() WHERE id = $1`, [fieldId]);
        return res.status(200).json({ success: true, message: 'Field deleted' });
    } catch (error) {
        console.error('deleteStageExtraField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete field' });
    }
};

// ══════════════════════════════════════════════════════════════
// CUSTOM FIELDS
// ══════════════════════════════════════════════════════════════

const toFieldDTO = (r) => {
    let optionsList = [];
    if (Array.isArray(r.options)) {
        optionsList = r.options;
    } else if (typeof r.options === 'string') {
        try {
            const parsed = JSON.parse(r.options);
            optionsList = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            optionsList = [];
        }
    }

    return {
        id: r.id,
        label: r.label,
        type: r.type,
        required: r.required,
        showInList: r.show_in_list,
        active: r.active,
        options: optionsList,
        category: r.category,
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
};

// GET /custom-fields/get-all?category=lead|company
export const getCustomFields = async (req, res) => {
    try {
        const { category } = req.query;
        const whereClause = category && ['lead', 'company'].includes(category)
            ? `WHERE category = $1 ORDER BY sort_order ASC, id ASC`
            : `ORDER BY category ASC, sort_order ASC, id ASC`;
        const values = category && ['lead', 'company'].includes(category) ? [category] : [];
        const result = await pool.query(`SELECT * FROM custom_fields ${whereClause}`, values);
        return res.status(200).json({ success: true, data: result.rows.map(toFieldDTO) });
    } catch (error) {
        console.error('getCustomFields error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch custom fields' });
    }
};

const syncActiveIndustryTemplateFields = async (clientOrPool) => {
    try {
        const activeRes = await clientOrPool.query(`SELECT selection_key FROM industry_active_selection WHERE id = 1`);
        if (activeRes.rows[0]?.selection_key) {
            const activeKey = activeRes.rows[0].selection_key;
            const leadFieldsRes = await clientOrPool.query(`SELECT * FROM custom_fields WHERE category = 'lead' ORDER BY sort_order ASC, id ASC`);
            const leadFields = leadFieldsRes.rows.map((f, i) => {
                let opts = [];
                if (Array.isArray(f.options)) opts = f.options;
                else if (typeof f.options === 'string') {
                    try { opts = JSON.parse(f.options); } catch (e) { opts = []; }
                }
                return {
                    id: i + 1,
                    label: f.label,
                    type: f.type || 'Text Input',
                    required: f.required ?? false,
                    options: opts,
                };
            });
            await clientOrPool.query(
                `UPDATE industry_templates SET fields = $1, updated_at = NOW() 
                 WHERE id::text = $2 OR LOWER(REPLACE(name, ' ', '-')) = LOWER($2) OR name ILIKE $2`,
                [JSON.stringify(leadFields), String(activeKey)]
            );
        }
    } catch (err) {
        console.error('syncActiveIndustryTemplateFields error:', err.message);
    }
};

// POST /custom-fields/create
export const createCustomField = async (req, res) => {
    try {
        const { label, type, required, showInList, active, options, category } = req.body;
        if (!label?.trim()) return res.status(400).json({ success: false, message: 'Field label is required' });
        if (!['lead', 'company'].includes(category)) return res.status(400).json({ success: false, message: 'category must be lead or company' });

        const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM custom_fields WHERE category = $1`, [category]);
        const result = await pool.query(
            `INSERT INTO custom_fields (label, type, required, show_in_list, active, options, category, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING *`,
            [label.trim(), type || 'Text Input', required ?? false, showInList ?? false, active ?? true, JSON.stringify(options || []), category, maxOrder.rows[0].next]
        );
        await syncActiveIndustryTemplateFields(pool);
        return res.status(201).json({ success: true, message: 'Field created', data: toFieldDTO(result.rows[0]) });
    } catch (error) {
        console.error('createCustomField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create field', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// PUT/PATCH /custom-fields/update/:id
export const updateCustomField = async (req, res) => {
    try {
        const { id } = req.params;
        const { label, type, required, showInList, active, options } = req.body;

        const existing = await pool.query(`SELECT id FROM custom_fields WHERE id = $1`, [id]);
        if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Field not found' });

        const sets = []; const values = []; let idx = 1;
        if (label !== undefined) { sets.push(`label = $${idx}`); values.push(label.trim()); idx++; }
        if (type !== undefined) { sets.push(`type = $${idx}`); values.push(type); idx++; }
        if (required !== undefined) { sets.push(`required = $${idx}`); values.push(required); idx++; }
        if (showInList !== undefined) { sets.push(`show_in_list = $${idx}`); values.push(showInList); idx++; }
        if (active !== undefined) { sets.push(`active = $${idx}`); values.push(active); idx++; }
        if (options !== undefined) { sets.push(`options = $${idx}`); values.push(JSON.stringify(options || [])); idx++; }
        sets.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        await syncActiveIndustryTemplateFields(pool);
        return res.status(200).json({ success: true, message: 'Field updated', data: toFieldDTO(result.rows[0]) });
    } catch (error) {
        console.error('updateCustomField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update field', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// DELETE /custom-fields/delete/:id
export const deleteCustomField = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`DELETE FROM custom_fields WHERE id = $1 RETURNING id, label`, [id]);
        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Field not found' });
        await syncActiveIndustryTemplateFields(pool);
        return res.status(200).json({ success: true, message: 'Field deleted', data: result.rows[0] });
    } catch (error) {
        console.error('deleteCustomField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete field' });
    }
};

// POST /custom-fields/bulk-save — save all lead+company fields at once
export const bulkSaveCustomFields = async (req, res) => {
    try {
        const { leadFields, companyFields } = req.body;
        const allFields = [
            ...(leadFields || []).map((f, i) => ({ ...f, category: 'lead', sortOrder: i })),
            ...(companyFields || []).map((f, i) => ({ ...f, category: 'company', sortOrder: i })),
        ];
        if (allFields.length === 0) return res.status(400).json({ success: false, message: 'No fields provided' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM custom_fields`);
            const saved = [];
            for (const f of allFields) {
                if (!f.label?.trim()) continue;
                const r = await client.query(
                    `INSERT INTO custom_fields (label, type, required, show_in_list, active, options, category, sort_order, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING *`,
                    [f.label.trim(), f.type || 'Text Input', f.required ?? false, f.showInList ?? false, f.active ?? true, JSON.stringify(f.options || []), f.category, f.sortOrder]
                );
                saved.push(r.rows[0]);
            }

            // Sync with active template in industry_templates table
            const activeRes = await client.query(`SELECT selection_key FROM industry_active_selection WHERE id = 1`);
            if (activeRes.rows[0]?.selection_key) {
                const activeKey = activeRes.rows[0].selection_key;
                const leadFields = allFields.filter(f => f.category === 'lead').map((f, i) => ({
                    id: i + 1,
                    label: f.label.trim(),
                    type: f.type || 'Text Input',
                    required: f.required ?? false,
                    options: Array.isArray(f.options) ? f.options : []
                }));
                await client.query(
                    `UPDATE industry_templates SET fields = $1, updated_at = NOW() 
                     WHERE id::text = $2 OR LOWER(REPLACE(name, ' ', '-')) = LOWER($2) OR name ILIKE $2`,
                    [JSON.stringify(leadFields), String(activeKey)]
                );
            }

            await client.query('COMMIT');
            return res.status(200).json({ success: true, message: `${saved.length} field(s) saved`, data: saved.map(toFieldDTO) });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('bulkSaveCustomFields error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to save fields', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// ══════════════════════════════════════════════════════════════
// LEAD SOURCES
// ══════════════════════════════════════════════════════════════

const toSourceDTO = (r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    active: r.active,
    priority: r.priority,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
});

// GET /lead-sources/get-all
export const getLeadSources = async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM lead_sources ORDER BY sort_order ASC, id ASC`);
        return res.status(200).json({ success: true, data: result.rows.map(toSourceDTO) });
    } catch (error) {
        console.error('getLeadSources error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch lead sources' });
    }
};

// POST /lead-sources/create
export const createLeadSource = async (req, res) => {
    try {
        const { name, color, active, priority } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, message: 'Source name is required' });

        const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const existing = await pool.query(`SELECT id FROM lead_sources WHERE id = $1`, [id]);
        if (existing.rows.length > 0) return res.status(409).json({ success: false, message: `Source "${name}" already exists` });

        const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM lead_sources`);
        const result = await pool.query(
            `INSERT INTO lead_sources (id, name, color, active, priority, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
            [id, name.trim(), color || '#64748b', active ?? true, priority || 'Low', maxOrder.rows[0].next]
        );
        return res.status(201).json({ success: true, message: 'Source created', data: toSourceDTO(result.rows[0]) });
    } catch (error) {
        console.error('createLeadSource error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create source', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// PUT/PATCH /lead-sources/update/:id
export const updateLeadSource = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, color, active, priority } = req.body;

        const existing = await pool.query(`SELECT id FROM lead_sources WHERE id = $1`, [id]);
        if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Source not found' });

        const sets = []; const values = []; let idx = 1;
        if (name !== undefined) { sets.push(`name = $${idx}`); values.push(name.trim()); idx++; }
        if (color !== undefined) { sets.push(`color = $${idx}`); values.push(color); idx++; }
        if (active !== undefined) { sets.push(`active = $${idx}`); values.push(active); idx++; }
        if (priority !== undefined) { sets.push(`priority = $${idx}`); values.push(priority); idx++; }
        sets.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(`UPDATE lead_sources SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        return res.status(200).json({ success: true, message: 'Source updated', data: toSourceDTO(result.rows[0]) });
    } catch (error) {
        console.error('updateLeadSource error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update source', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// PATCH /lead-sources/toggle-status/:id
export const toggleLeadSourceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE lead_sources SET active = NOT active, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Source not found' });
        return res.status(200).json({ success: true, message: `Source ${result.rows[0].active ? 'activated' : 'deactivated'}`, data: toSourceDTO(result.rows[0]) });
    } catch (error) {
        console.error('toggleLeadSourceStatus error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to toggle source status' });
    }
};

// DELETE /lead-sources/delete/:id
export const deleteLeadSource = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`DELETE FROM lead_sources WHERE id = $1 RETURNING id, name`, [id]);
        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Source not found' });
        return res.status(200).json({ success: true, message: 'Source deleted', data: result.rows[0] });
    } catch (error) {
        console.error('deleteLeadSource error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete source' });
    }
};

// POST /lead-sources/bulk-save — save all sources at once
export const bulkSaveLeadSources = async (req, res) => {
    try {
        const { sources } = req.body;
        if (!Array.isArray(sources) || sources.length === 0) return res.status(400).json({ success: false, message: 'sources array is required' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM lead_sources`);
            const saved = [];
            for (let i = 0; i < sources.length; i++) {
                const s = sources[i];
                if (!s.name?.trim()) continue;
                const id = s.id || s.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                const r = await client.query(
                    `INSERT INTO lead_sources (id, name, color, active, priority, sort_order, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,active=EXCLUDED.active,priority=EXCLUDED.priority,sort_order=EXCLUDED.sort_order,updated_at=NOW()
           RETURNING *`,
                    [id, s.name.trim(), s.color || '#64748b', s.active ?? true, s.priority || 'Low', i]
                );
                saved.push(r.rows[0]);
            }
            await client.query('COMMIT');
            return res.status(200).json({ success: true, message: `${saved.length} source(s) saved`, data: saved.map(toSourceDTO) });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('bulkSaveLeadSources error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to save sources', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// ══════════════════════════════════════════════════════════════
// LEAD SCORING CONFIG
// ══════════════════════════════════════════════════════════════

export const getScoringConfig = async (req, res) => {
    try {
        const config = await getScoringConfigFromDb();
        return res.status(200).json({
            success: true,
            data: config,
        });
    } catch (error) {
        console.error('getScoringConfig error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch scoring config' });
    }
};

export const saveScoringConfig = async (req, res) => {
    try {
        const { method, factors, thresholds, actions } = req.body;
        const result = await pool.query(
            `INSERT INTO lead_scoring_config (id, method, factors, thresholds, actions, updated_at)
             VALUES (1, $1, $2, $3, $4, NOW())
             ON CONFLICT (id) DO UPDATE SET
               method = EXCLUDED.method,
               factors = EXCLUDED.factors,
               thresholds = EXCLUDED.thresholds,
               actions = EXCLUDED.actions,
               updated_at = NOW()
             RETURNING *`,
            [
                method || 'automatic',
                JSON.stringify(factors || []),
                JSON.stringify(thresholds || []),
                JSON.stringify(actions || []),
            ]
        );
        const row = result.rows[0];

        // If automatic, recalculate existing lead scores in background
        if ((method || 'automatic') === 'automatic') {
            recalculateAllLeadScores().catch((err) => console.error('Background recalculate error:', err));
        }

        await logActivity({
            type: 'score_change',
            title: 'Lead scoring config updated',
            description: `Lead scoring configuration saved (${method || 'automatic'})`,
            userName: req.user?.name || 'Admin',
            action: 'updated lead scoring rules',
            leadName: 'Lead Scoring Settings',
            detail: `Method: ${method || 'automatic'} • ${Array.isArray(factors) ? factors.filter((f) => f.active).length : 0} active factors`,
        });

        return res.status(200).json({
            success: true,
            message: 'Lead scoring configuration saved',
            data: {
                method: row.method,
                factors: typeof row.factors === 'string' ? JSON.parse(row.factors) : row.factors,
                thresholds: typeof row.thresholds === 'string' ? JSON.parse(row.thresholds) : row.thresholds,
                actions: typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions,
            },
        });
    } catch (error) {
        console.error('saveScoringConfig error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to save scoring config' });
    }
};

export const recalculateScoringScores = async (req, res) => {
    try {
        const result = await recalculateAllLeadScores();
        return res.status(200).json({
            success: true,
            message: result.message || 'All lead scores recalculated successfully',
            count: result.count || 0,
        });
    } catch (error) {
        console.error('recalculateScoringScores error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to recalculate lead scores' });
    }
};

// ══════════════════════════════════════════════════════════════
// ASSIGNMENT RULES CONFIG
// ══════════════════════════════════════════════════════════════

export const getAssignmentConfig = async (req, res) => {
    try {
        const config = await getAssignmentConfigFromDb();
        return res.status(200).json({
            success: true,
            data: config,
        });
    } catch (error) {
        console.error('getAssignmentConfig error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch assignment config' });
    }
};

export const saveAssignmentConfig = async (req, res) => {
    try {
        const { method, rules, escalationRules } = req.body;
        const result = await pool.query(
            `INSERT INTO assignment_rules_config (id, method, rules, escalation_rules, updated_at)
             VALUES (1, $1, $2, $3, NOW())
             ON CONFLICT (id) DO UPDATE SET
               method = EXCLUDED.method,
               rules = EXCLUDED.rules,
               escalation_rules = EXCLUDED.escalation_rules,
               updated_at = NOW()
             RETURNING *`,
            [
                method || 'round_robin',
                JSON.stringify(rules || []),
                JSON.stringify(escalationRules || []),
            ]
        );
        const row = result.rows[0];
        return res.status(200).json({
            success: true,
            message: 'Assignment rules configuration saved',
            data: {
                method: row.method,
                rules: typeof row.rules === 'string' ? JSON.parse(row.rules) : row.rules,
                escalationRules: typeof row.escalation_rules === 'string' ? JSON.parse(row.escalation_rules) : row.escalation_rules,
            },
        });
    } catch (error) {
        console.error('saveAssignmentConfig error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to save assignment config' });
    }
};