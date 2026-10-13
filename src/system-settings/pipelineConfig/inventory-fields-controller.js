// src/pipeline-config/inventory-fields-controller.js
import { randomUUID } from "crypto";
import { connectDB as pool } from "../../pool.js";

const isUUID = (str) => typeof str === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const toFieldDTO = (r) => ({
    id: r.id,
    label: r.label,
    fieldKey: r.field_key,
    type: r.type,
    required: r.required,
    showInList: r.show_in_list,
    showInForm: r.show_in_form,
    active: r.active,
    options: typeof r.options === "string" ? JSON.parse(r.options) : (r.options || []),
    placeholder: r.placeholder || undefined,
    order: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
});

const toFieldKey = (label) =>
    label.trim().toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_{2,}/g, "_").replace(/^_|_$/g, "");

// ══════════════════════════════════════════════════════════════
// INVENTORY FIELDS
// ══════════════════════════════════════════════════════════════

// GET /inventory-fields/get-all
export const getInventoryFields = async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM inventory_fields ORDER BY sort_order ASC, id ASC`);
        return res.status(200).json({ success: true, data: result.rows.map(toFieldDTO) });
    } catch (error) {
        console.error('getInventoryFields error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch inventory fields' });
    }
};

// POST /inventory-fields/create
export const createInventoryField = async (req, res) => {
    try {
        const { label, type, required, showInList, showInForm, options, placeholder, order } = req.body;
        if (!label?.trim()) return res.status(400).json({ success: false, message: 'Field label is required' });

        const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM inventory_fields`);
        const fieldId = randomUUID();
        const result = await pool.query(
            `INSERT INTO inventory_fields (id, label, field_key, type, required, show_in_list, show_in_form, active, options, placeholder, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,NOW(),NOW()) RETURNING *`,
            [
                fieldId,
                label.trim(),
                toFieldKey(label),
                type || 'Text Input',
                required ?? false,
                showInList ?? false,
                showInForm ?? true,
                JSON.stringify(options || []),
                placeholder || null,
                order ?? maxOrder.rows[0].next,
            ]
        );
        return res.status(201).json({ success: true, message: 'Inventory field created', data: toFieldDTO(result.rows[0]) });
    } catch (error) {
        console.error('createInventoryField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create inventory field', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// PUT/PATCH /inventory-fields/update/:id
export const updateInventoryField = async (req, res) => {
    try {
        const { id } = req.params;
        const { label, type, required, showInList, showInForm, active, options, placeholder, order } = req.body;

        const existing = await pool.query(`SELECT id FROM inventory_fields WHERE id = $1`, [id]);
        if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Inventory field not found' });

        const sets = []; const values = []; let idx = 1;
        if (label !== undefined) { sets.push(`label = $${idx}`); values.push(label.trim()); idx++; sets.push(`field_key = $${idx}`); values.push(toFieldKey(label)); idx++; }
        if (type !== undefined) { sets.push(`type = $${idx}`); values.push(type); idx++; }
        if (required !== undefined) { sets.push(`required = $${idx}`); values.push(required); idx++; }
        if (showInList !== undefined) { sets.push(`show_in_list = $${idx}`); values.push(showInList); idx++; }
        if (showInForm !== undefined) { sets.push(`show_in_form = $${idx}`); values.push(showInForm); idx++; }
        if (active !== undefined) { sets.push(`active = $${idx}`); values.push(active); idx++; }
        if (options !== undefined) { sets.push(`options = $${idx}`); values.push(JSON.stringify(options)); idx++; }
        if (placeholder !== undefined) { sets.push(`placeholder = $${idx}`); values.push(placeholder); idx++; }
        if (order !== undefined) { sets.push(`sort_order = $${idx}`); values.push(order); idx++; }
        sets.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(`UPDATE inventory_fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        return res.status(200).json({ success: true, message: 'Inventory field updated', data: toFieldDTO(result.rows[0]) });
    } catch (error) {
        console.error('updateInventoryField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update inventory field', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// DELETE /inventory-fields/delete/:id
export const deleteInventoryField = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || String(id).startsWith('tmp-') || String(id).startsWith('field-')) {
            return res.status(200).json({ success: true, message: 'Inventory field deleted', data: { id } });
        }
        if (isUUID(id)) {
            const result = await pool.query(`DELETE FROM inventory_fields WHERE id = $1 RETURNING id, label`, [id]);
            if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Inventory field not found' });
            return res.status(200).json({ success: true, message: 'Inventory field deleted', data: result.rows[0] });
        } else {
            const result = await pool.query(`DELETE FROM inventory_fields WHERE field_key = $1 RETURNING id, label`, [id]);
            return res.status(200).json({ success: true, message: 'Inventory field deleted', data: result.rows[0] || { id } });
        }
    } catch (error) {
        console.error('deleteInventoryField error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete inventory field' });
    }
};

// POST /inventory-fields/bulk-save — save the whole list at once (from "Save" button)
export const bulkSaveInventoryFields = async (req, res) => {
    try {
        const { fields } = req.body; // [{ id?, label, type, required, showInList, showInForm, options, placeholder, order }]
        if (!Array.isArray(fields) || fields.length === 0) {
            return res.status(400).json({ success: false, message: 'fields array is required' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM inventory_fields`);

            const saved = [];
            const seenKeys = new Set();
            let orderIdx = 1;

            for (let i = 0; i < fields.length; i++) {
                const f = fields[i];
                if (!f || !f.label?.trim()) continue;
                const fieldKey = toFieldKey(f.label.trim());
                if (seenKeys.has(fieldKey)) continue;
                seenKeys.add(fieldKey);

                const rawOrder = Number(f.order);
                const sortOrder = (Number.isFinite(rawOrder) && rawOrder >= 0 && rawOrder < 100000) ? Math.floor(rawOrder) : orderIdx;
                orderIdx++;

                const fieldId = isUUID(f.id) ? f.id : randomUUID();

                const r = await client.query(
                    `INSERT INTO inventory_fields (id, label, field_key, type, required, show_in_list, show_in_form, active, options, placeholder, sort_order, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) RETURNING *`,
                    [
                        fieldId,
                        f.label.trim(),
                        fieldKey,
                        f.type || 'Text Input',
                        f.required ?? false,
                        f.showInList ?? false,
                        f.showInForm ?? true,
                        f.active ?? true,
                        JSON.stringify(f.options || []),
                        f.placeholder || null,
                        sortOrder,
                    ]
                );
                saved.push(r.rows[0]);
            }
            await client.query('COMMIT');
            return res.status(200).json({ success: true, message: `${saved.length} inventory field(s) saved`, data: saved.map(toFieldDTO) });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('bulkSaveInventoryFields error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to save inventory fields', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};