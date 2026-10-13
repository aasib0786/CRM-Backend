import { toRoleSlug } from '../../../utils/auth.js';
import pool from '../../pool.js';

// ─── GET /settings/positions ────────────────────────────────
// userCount is computed live from users.role, not stored, since role is
// derived from the position name rather than a foreign key.
// Single-tenant: no company_id scoping.
export const getAllPositions = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.id, p.name, p.level, p.reports_to, p.color, p.data_access, p.permissions, p.created_at,
                    COUNT(u.id) AS user_count
             FROM positions p
             LEFT JOIN users u
               ON u.is_active = true
              AND lower(regexp_replace(p.name, '\\s+', '_', 'g')) = u.role
             GROUP BY p.id
             ORDER BY p.level ASC`
        );

        const items = result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            level: row.level,
            reportsTo: row.reports_to,
            color: row.color,
            dataAccess: row.data_access,
            permissions: row.permissions,
            userCount: Number(row.user_count),
            createdAt: row.created_at,
        }));

        return res.json({ success: true, data: { items } });
    } catch (error) {
        console.error('Error fetching positions:', error);
        return res.status(500).json({ success: false, message: 'Failed to load positions' });
    }
};

// ─── POST /settings/positions ───────────────────────────────
export const createPosition = async (req, res) => {
    try {
        const { name, level, reportsTo, color, dataAccess, permissions } = req.body;

        // ---- validation -------------------------------------------------------
        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: 'Position name is required' });
        }

        const cleanName = String(name).trim();
        const cleanLevel = Number(level) || 1;

        if (cleanLevel < 1 || cleanLevel > 10) {
            return res.status(400).json({ success: false, message: 'Level must be between 1 and 10' });
        }

        // ---- duplicate check ----------------------------------------------------
        const existing = await pool.query(
            `SELECT id FROM positions WHERE lower(name) = lower($1)`,
            [cleanName]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'A position with this name already exists',
            });
        }

        // ---- insert ---------------------------------------------------------------
        const result = await pool.query(
            `INSERT INTO positions (name, level, reports_to, color, data_access, permissions)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             RETURNING id, name, level, reports_to, color, data_access, permissions, created_at`,
            [
                cleanName,
                cleanLevel,
                reportsTo?.trim() || null,
                color || '#4f46e5',
                dataAccess?.trim() || 'own',
                JSON.stringify(permissions || {}),
            ]
        );

        return res.status(201).json({
            success: true,
            message: 'Position created',
            data: { ...result.rows[0], userCount: 0 },
        });
    } catch (err) {
        console.error('Create Position Error:', err);

        // race condition safety net — two requests slipping past the check above
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'A position with this name already exists',
            });
        }
        if (err.code === '23503') {
            return res.status(400).json({ success: false, message: 'Referenced record does not exist' });
        }
        if (err.code === '23514') {
            return res.status(400).json({ success: false, message: 'A value is outside the allowed range' });
        }

        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── PATCH /settings/positions/:id ───────────────────────────
// Renaming a position keeps users.role and any child positions' reports_to
// in sync, since both reference the position by name rather than id.
// Single-tenant: no company_id scoping.
export const updatePosition = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, level, reportsTo, color, dataAccess, permissions } = req.body;

        const existingResult = await pool.query(
            'SELECT * FROM positions WHERE id = $1',
            [id]
        );
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Position not found' });
        }
        const existing = existingResult.rows[0];

        const cleanLevel = level !== undefined ? Number(level) : existing.level;
        if (level !== undefined && (Number.isNaN(cleanLevel) || cleanLevel < 1 || cleanLevel > 10)) {
            return res.status(400).json({ success: false, message: 'Level must be between 1 and 10' });
        }

        const merged = {
            name: name !== undefined ? String(name).trim() : existing.name,
            level: cleanLevel,
            reportsTo: reportsTo !== undefined ? (reportsTo?.trim() || null) : existing.reports_to,
            color: color !== undefined ? color : existing.color,
            dataAccess: dataAccess !== undefined ? dataAccess : existing.data_access,
            permissions: permissions !== undefined ? permissions : existing.permissions,
        };

        if (merged.name !== existing.name) {
            const nameTaken = await pool.query(
                'SELECT id FROM positions WHERE lower(name) = lower($1) AND id != $2',
                [merged.name, id]
            );
            if (nameTaken.rows.length > 0) {
                return res.status(409).json({ success: false, message: 'Another position already uses this name' });
            }

            const oldSlug = toRoleSlug(existing.name);
            const newSlug = toRoleSlug(merged.name);
            await pool.query('UPDATE users SET role = $1 WHERE role = $2', [newSlug, oldSlug]);
            await pool.query('UPDATE positions SET reports_to = $1 WHERE reports_to = $2', [merged.name, existing.name]);
        }

        const result = await pool.query(
            `UPDATE positions
             SET name = $1, level = $2, reports_to = $3, color = $4, data_access = $5, permissions = $6::jsonb
             WHERE id = $7
             RETURNING id, name, level, reports_to, color, data_access, permissions, created_at`,
            [merged.name, merged.level, merged.reportsTo, merged.color, merged.dataAccess, JSON.stringify(merged.permissions), id]
        );

        const row = result.rows[0];
        return res.json({
            success: true,
            message: 'Position updated successfully',
            data: {
                id: row.id,
                name: row.name,
                level: row.level,
                reportsTo: row.reports_to,
                color: row.color,
                dataAccess: row.data_access,
                permissions: row.permissions,
                createdAt: row.created_at,
            },
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: 'Another position already uses this name' });
        }
        console.error('Error updating position:', error);
        return res.status(500).json({ success: false, message: 'Failed to update position' });
    }
};

// ─── DELETE /settings/positions/:id ──────────────────────────
// Single-tenant: no company_id scoping.
export const deletePosition = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query('SELECT name FROM positions WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Position not found' });
        }

        const slug = toRoleSlug(existing.rows[0].name);
        const userCount = await pool.query(
            'SELECT COUNT(*)::int AS count FROM users WHERE role = $1',
            [slug]
        );
        if (userCount.rows[0].count > 0) {
            return res.status(409).json({ success: false, message: 'Cannot delete a position that has users assigned to it' });
        }

        await pool.query('DELETE FROM positions WHERE id = $1', [id]);
        return res.json({ success: true, message: 'Position deleted successfully' });
    } catch (error) {
        console.error('Error deleting position:', error);
        return res.status(500).json({ success: false, message: 'Failed to delete position' });
    }
};