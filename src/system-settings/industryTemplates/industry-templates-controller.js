// src/pipeline-config/industry-templates-controller.js
import { connectDB as pool } from "../../pool.js";

const toTemplateDTO = (r) => {
    let stageList = [];
    if (Array.isArray(r.stages)) {
        stageList = r.stages;
    } else if (typeof r.stages === 'string') {
        try { stageList = JSON.parse(r.stages); } catch (e) { stageList = []; }
    } else if (r.stage_list) {
        stageList = Array.isArray(r.stage_list) ? r.stage_list : (typeof r.stage_list === 'string' ? JSON.parse(r.stage_list) : []);
    }

    let fieldList = [];
    if (Array.isArray(r.fields)) {
        fieldList = r.fields;
    } else if (typeof r.fields === 'string') {
        try { fieldList = JSON.parse(r.fields); } catch (e) { fieldList = []; }
    } else if (r.field_list) {
        fieldList = Array.isArray(r.field_list) ? r.field_list : (typeof r.field_list === 'string' ? JSON.parse(r.field_list) : []);
    }

    let inventoryFields = [];
    if (Array.isArray(r.inventory_fields)) {
        inventoryFields = r.inventory_fields;
    } else if (typeof r.inventory_fields === 'string') {
        try { inventoryFields = JSON.parse(r.inventory_fields); } catch (e) { inventoryFields = []; }
    }

    return {
        id: String(r.id),
        name: r.name,
        icon: r.icon || 'ri-building-4-line',
        iconBg: r.icon_bg || 'bg-indigo-100',
        iconColor: r.icon_color || 'text-indigo-600',
        pipeline: r.pipeline_summary || stageList.map((s) => s.name || s).join(' → '),
        stages: stageList.length,
        fields: fieldList.length,
        stageList,
        fieldList,
        inventoryFields,
        isCustom: r.is_custom ?? (Number(r.id) > 8 || isNaN(Number(r.id))),
        active: false,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
};

// ══════════════════════════════════════════════════════════════
// INDUSTRY TEMPLATES CRUD & SWITCH
// ══════════════════════════════════════════════════════════════

// GET /industry-templates/get-all
export const getIndustryTemplates = async (req, res) => {
    try {
        const [templatesRes, activeRes] = await Promise.all([
            pool.query(`SELECT * FROM industry_templates ORDER BY id ASC`),
            pool.query(`SELECT selection_type, selection_key FROM industry_active_selection WHERE id = 1`),
        ]);

        const active = activeRes.rows[0] || { selection_type: 'custom', selection_key: '1' };

        const templates = templatesRes.rows.map(toTemplateDTO).map((t) => ({
            ...t,
            active: String(active.selection_key) === String(t.id) || active.selection_key === t.name.toLowerCase().replace(/\s+/g, '-'),
        }));

        return res.status(200).json({
            success: true,
            data: templates,
            active: { type: active.selection_type, key: active.selection_key },
        });
    } catch (error) {
        console.error('getIndustryTemplates error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch industry templates' });
    }
};

// POST /industry-templates/create
export const createIndustryTemplate = async (req, res) => {
    try {
        const { name, icon, iconBg, iconColor, stages, fields, inventoryFields } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, message: 'Industry name is required' });

        const stageList = Array.isArray(stages) ? stages : [];
        const fieldList = Array.isArray(fields) ? fields : [];
        const invList = Array.isArray(inventoryFields) ? inventoryFields : [];
        const pipelineSummary = stageList.map((s) => s.name || s).join(' → ');

        await pool.query(`ALTER TABLE IF EXISTS public.industry_templates ADD COLUMN IF NOT EXISTS inventory_fields JSONB DEFAULT '[]'::jsonb`);
        await pool.query(`ALTER TABLE IF EXISTS public.industry_templates ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT true`);

        const result = await pool.query(
            `INSERT INTO industry_templates (name, icon, icon_bg, icon_color, pipeline_summary, stages, fields, inventory_fields, is_custom, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW()) RETURNING *`,
            [
                name.trim(),
                icon || 'ri-building-4-line',
                iconBg || 'bg-indigo-100',
                iconColor || 'text-indigo-600',
                pipelineSummary,
                JSON.stringify(stageList),
                JSON.stringify(fieldList),
                JSON.stringify(invList),
            ]
        );
        return res.status(201).json({ success: true, message: 'Industry template created', data: toTemplateDTO(result.rows[0]) });
    } catch (error) {
        console.error('createIndustryTemplate error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create industry template: ' + error.message });
    }
};

// PUT/PATCH /industry-templates/update/:id
export const updateIndustryTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, iconBg, iconColor, stages, fields, inventoryFields } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query(
                `SELECT * FROM industry_templates 
                 WHERE id::text = $1 OR LOWER(REPLACE(name, ' ', '-')) = LOWER($1) OR name ILIKE $1`, 
                [String(id)]
            );
            if (!existing.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Industry template not found' });
            }

            const targetId = existing.rows[0].id;

            const sets = []; const values = []; let idx = 1;
            if (name !== undefined) { sets.push(`name = $${idx}`); values.push(name.trim()); idx++; }
            if (icon !== undefined) { sets.push(`icon = $${idx}`); values.push(icon); idx++; }
            if (iconBg !== undefined) { sets.push(`icon_bg = $${idx}`); values.push(iconBg); idx++; }
            if (iconColor !== undefined) { sets.push(`icon_color = $${idx}`); values.push(iconColor); idx++; }
            if (stages !== undefined) {
                sets.push(`stages = $${idx}`); values.push(JSON.stringify(stages)); idx++;
                sets.push(`pipeline_summary = $${idx}`); values.push(stages.map((s) => s.name).join(' → ')); idx++;
            }
            if (fields !== undefined) { sets.push(`fields = $${idx}`); values.push(JSON.stringify(fields)); idx++; }
            if (inventoryFields !== undefined) { sets.push(`inventory_fields = $${idx}`); values.push(JSON.stringify(inventoryFields)); idx++; }
            sets.push(`updated_at = NOW()`);
            values.push(targetId);

            const result = await client.query(`UPDATE industry_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
            const updatedRow = result.rows[0];

            // Check if this custom template is currently the active template
            const activeRes = await client.query(`SELECT selection_type, selection_key FROM industry_active_selection WHERE id = 1`);
            const active = activeRes.rows[0];
            const isCurrentlyActive = active && (
                String(active.selection_key) === String(targetId) || 
                String(active.selection_key) === String(id) || 
                active.selection_key === existing.rows[0].name.toLowerCase().replace(/\s+/g, '-')
            );

            if (isCurrentlyActive) {
                // Synchronize live pipeline stages
                if (Array.isArray(stages) && stages.length > 0) {
                    await client.query(`UPDATE pipeline_stages SET is_active = false WHERE is_active = true`);
                    for (let i = 0; i < stages.length; i++) {
                        const s = stages[i];
                        if (!s.name?.trim()) continue;
                        await client.query(
                            `INSERT INTO pipeline_stages (name, color, required, sort_order, is_active, created_at, updated_at)
                             VALUES ($1, $2, $3, $4, true, NOW(), NOW())
                             ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color, required = EXCLUDED.required, sort_order = EXCLUDED.sort_order, is_active = true, updated_at = NOW()`,
                            [s.name.trim(), s.color || '#64748b', s.required ?? false, i + 1]
                        );
                    }
                }

                // Synchronize live custom fields for leads
                if (Array.isArray(fields) && fields.length > 0) {
                    await client.query(`DELETE FROM custom_fields WHERE category = 'lead'`);
                    for (let i = 0; i < fields.length; i++) {
                        const f = fields[i];
                        if (!f.label?.trim()) continue;
                        await client.query(
                            `INSERT INTO custom_fields (label, type, required, show_in_list, active, options, category, sort_order, created_at, updated_at)
                             VALUES ($1, $2, $3, true, true, $4, 'lead', $5, NOW(), NOW())`,
                            [f.label.trim(), f.type || 'Text Input', f.required ?? false, JSON.stringify(f.options || []), i + 1]
                        );
                    }
                }
            }

            await client.query('COMMIT');
            return res.status(200).json({ success: true, message: 'Industry template updated', data: toTemplateDTO(updatedRow) });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('updateIndustryTemplate error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update industry template: ' + error.message });
    }
};

// DELETE /industry-templates/delete/:id
export const deleteIndustryTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM industry_templates 
             WHERE id::text = $1 OR LOWER(REPLACE(name, ' ', '-')) = LOWER($1) OR name ILIKE $1 
             RETURNING id, name`,
            [String(id)]
        );
        if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Industry template not found' });

        // If the deleted template was active, fall back to first template
        await pool.query(
            `UPDATE industry_active_selection SET selection_type = 'custom', selection_key = '1', updated_at = NOW()
             WHERE id = 1 AND (selection_key = $1 OR selection_key = $2)`,
            [String(id), result.rows[0].name.toLowerCase().replace(/\s+/g, '-')]
        );

        return res.status(200).json({ success: true, message: 'Industry template deleted', data: result.rows[0] });
    } catch (error) {
        console.error('deleteIndustryTemplate error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete industry template' });
    }
};

// POST /industry-templates/duplicate/:id
export const duplicateIndustryTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query(
            `SELECT * FROM industry_templates 
             WHERE id::text = $1 OR LOWER(REPLACE(name, ' ', '-')) = LOWER($1) OR name ILIKE $1`, 
            [String(id)]
        );
        if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Industry template not found' });

        const t = existing.rows[0];
        const result = await pool.query(
            `INSERT INTO industry_templates (name, icon, icon_bg, icon_color, pipeline_summary, stages, fields, inventory_fields, is_custom, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW()) RETURNING *`,
            [`${t.name} (Copy)`, t.icon, t.icon_bg, t.icon_color, t.pipeline_summary, JSON.stringify(t.stages), JSON.stringify(t.fields), JSON.stringify(t.inventory_fields || [])]
        );
        return res.status(201).json({ success: true, message: 'Industry template duplicated', data: toTemplateDTO(result.rows[0]) });
    } catch (error) {
        console.error('duplicateIndustryTemplate error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to duplicate industry template' });
    }
};

// PATCH /industry-templates/switch
export const switchIndustryTemplate = async (req, res) => {
    try {
        const { type, key, stages, fields, inventoryFields } = req.body;
        if (!key) return res.status(400).json({ success: false, message: 'Template key or id is required' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let stageList = Array.isArray(stages) && stages.length > 0 ? stages : null;
            let fieldList = Array.isArray(fields) && fields.length > 0 ? fields : null;
            let invList = Array.isArray(inventoryFields) && inventoryFields.length > 0 ? inventoryFields : null;

            // Load template from industry_templates table if stages/fields were not provided in payload
            const tmplRes = await client.query(
                `SELECT * FROM industry_templates 
                 WHERE id::text = $1 OR LOWER(REPLACE(name, ' ', '-')) = LOWER($1) OR name ILIKE $1`, 
                [String(key)]
            );
            if (tmplRes.rows[0]) {
                const tmpl = tmplRes.rows[0];
                if (!stageList) {
                    stageList = typeof tmpl.stages === 'string' ? JSON.parse(tmpl.stages) : tmpl.stages;
                }
                if (!fieldList) {
                    fieldList = typeof tmpl.fields === 'string' ? JSON.parse(tmpl.fields) : tmpl.fields;
                }
                if (!invList && tmpl.inventory_fields) {
                    invList = typeof tmpl.inventory_fields === 'string' ? JSON.parse(tmpl.inventory_fields) : tmpl.inventory_fields;
                }
            }

            // 1. Synchronize Pipeline Stages
            if (Array.isArray(stageList) && stageList.length > 0) {
                await client.query(`UPDATE pipeline_stages SET is_active = false WHERE is_active = true`);
                for (let i = 0; i < stageList.length; i++) {
                    const s = stageList[i];
                    if (!s.name?.trim()) continue;
                    await client.query(
                        `INSERT INTO pipeline_stages (name, color, required, sort_order, is_active, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, true, NOW(), NOW())
                         ON CONFLICT (name) DO UPDATE SET
                           color = EXCLUDED.color,
                           required = EXCLUDED.required,
                           sort_order = EXCLUDED.sort_order,
                           is_active = true,
                           updated_at = NOW()`,
                        [s.name.trim(), s.color || '#64748b', s.required ?? false, i + 1]
                    );
                }
            }

            // 2. Synchronize Custom Fields (Category = lead)
            if (Array.isArray(fieldList) && fieldList.length > 0) {
                await client.query(`DELETE FROM custom_fields WHERE category = 'lead'`);
                for (let i = 0; i < fieldList.length; i++) {
                    const f = fieldList[i];
                    if (!f.label?.trim()) continue;
                    await client.query(
                        `INSERT INTO custom_fields (label, type, required, show_in_list, active, options, category, sort_order, created_at, updated_at)
                         VALUES ($1, $2, $3, true, true, $4, 'lead', $5, NOW(), NOW())`,
                        [f.label.trim(), f.type || 'Text Input', f.required ?? false, JSON.stringify(f.options || []), i + 1]
                    );
                }
            }

            // 3. Synchronize Inventory Fields
            if (Array.isArray(invList) && invList.length > 0) {
                await client.query(`DELETE FROM inventory_fields`);
                for (let i = 0; i < invList.length; i++) {
                    const inv = invList[i];
                    if (!inv.label?.trim()) continue;
                    await client.query(
                        `INSERT INTO inventory_fields (id, label, field_key, type, required, show_in_list, show_in_form, active, options, sort_order, placeholder, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
                         ON CONFLICT (id) DO UPDATE SET
                           label = EXCLUDED.label,
                           field_key = EXCLUDED.field_key,
                           type = EXCLUDED.type,
                           required = EXCLUDED.required,
                           show_in_list = EXCLUDED.show_in_list,
                           show_in_form = EXCLUDED.show_in_form,
                           active = EXCLUDED.active,
                           options = EXCLUDED.options,
                           sort_order = EXCLUDED.sort_order,
                           placeholder = EXCLUDED.placeholder,
                           updated_at = NOW()`,
                        [
                            inv.id || (i + 1),
                            inv.label.trim(),
                            inv.field_key || inv.fieldKey || `field_${i + 1}`,
                            inv.type || 'Text Input',
                            inv.required ?? false,
                            inv.show_in_list ?? inv.showInList ?? true,
                            inv.show_in_form ?? inv.showInForm ?? true,
                            inv.active ?? true,
                            JSON.stringify(inv.options || []),
                            i + 1,
                            inv.placeholder || ''
                        ]
                    );
                }
            }

            // 4. Update active selection
            await client.query(
                `INSERT INTO industry_active_selection (id, selection_type, selection_key, updated_at)
                 VALUES (1, $1, $2, NOW())
                 ON CONFLICT (id) DO UPDATE SET selection_type = $1, selection_key = $2, updated_at = NOW()`,
                [type || 'custom', String(key)]
            );

            await client.query('COMMIT');
            return res.status(200).json({ success: true, message: 'Industry template switched and synced successfully', data: { type, key } });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('switchIndustryTemplate error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to switch industry template: ' + error.message });
    }
};