import { connectDB } from "../../pool.js";
// import { upsertUserPermissionsJsonb , mergePermissions, mergeControls} from "../../admin/admin-controller.js";

export const createRole = async (req, res) => {
  try {
    const userId     = req.user.id;
    const company_id = req.user.company_id;
    const { name, description, isActive, permissions, additionalControls } = req.body;

    if (!name) return res.status(400).json({ message: "Role name is required" });

    const existingRole = await connectDB.query(
      `SELECT * FROM roles WHERE company_id = $1 AND name = $2`,
      [company_id, name]
    );
    if (existingRole.rows.length > 0) {
      return res.status(400).json({ message: "Role already exists in this company" });
    }

    const result = await connectDB.query(
      `INSERT INTO roles (company_id, name, description, is_active, permissions, additional_controls, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [company_id, name, description, isActive, permissions, additionalControls, userId]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRoles = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const { search = "" } = req.query;

    const result = await connectDB.query(
      `SELECT
         r.*,
         COALESCE(creator.name, 'Unknown User') AS created_by_name,
         COUNT(u.id) AS users_assigned
       FROM roles r
       LEFT JOIN users creator ON creator.id = r.created_by
       LEFT JOIN users u ON u.role = r.name AND u.company_id = r.company_id
       WHERE r.company_id = $1
         AND ($2 = '' OR r.name ILIKE '%' || $2 || '%' OR r.description ILIKE '%' || $2 || '%')
       GROUP BY r.id, creator.name
       ORDER BY r.created_at DESC`,
      [company_id, search]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Get Roles Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Update a role AND sync user_permissions for all users assigned to this role.
 *
 * Sync rules:
 *  - A permission turned OFF in the role → set to false for ALL users of the role
 *    (regardless of individual overrides — role removal is authoritative)
 *  - A permission turned ON in the role → add it to users who DON'T already have it set to true
 *    (respects existing user overrides that are already true — no downgrade)
 *
 * The same logic applies to additional_controls.
 */
export const updateRoles = async (req, res) => {
  const company_id = req.user.company_id;
  const { id }     = req.params;
  const { name, description, isActive, permissions, additionalControls } = req.body;

  try {
    // 1. Verify role exists in same company
    const roleCheck = await connectDB.query(
      `SELECT * FROM roles WHERE id = $1 AND company_id = $2`,
      [id, company_id]
    );
    if (roleCheck.rows.length === 0) return res.status(404).json({ message: "Role not found" });

    const oldRole = roleCheck.rows[0];

    // 2. Check no duplicate name
    const duplicate = await connectDB.query(
      `SELECT id FROM roles WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND id != $3`,
      [company_id, name, id]
    );
    if (duplicate.rows.length > 0) return res.status(400).json({ message: "Role name already exists" });

    // 3. Save updated role
    const updatedRole = await connectDB.query(
      `UPDATE roles
       SET name = $1, description = $2, is_active = $3,
           permissions = $4, additional_controls = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, description, isActive, permissions || {}, additionalControls || {}, id]
    );
    const newRolePerms     = updatedRole.rows[0].permissions;
    const newRoleControls  = updatedRole.rows[0].additional_controls;
    const roleName         = updatedRole.rows[0].name;

    // 4. Fetch all users assigned to this role in this company
    const usersResult = await connectDB.query(
      `SELECT u.id::text AS id
       FROM users u
       WHERE u.company_id = $1 AND u.role = $2`,
      [company_id, roleName]
    );
    const userIds = usersResult.rows.map((r) => r.id);

    if (userIds.length > 0) {
      // Fetch existing user_permissions rows
      const existingPermsResult = await connectDB.query(
        `SELECT user_id::text AS user_id, permissions, additional_controls
         FROM user_permissions
         WHERE user_id::text = ANY($1::text[])`,
        [userIds]
      );
      const existingPermsMap = new Map();
      for (const row of existingPermsResult.rows) {
        existingPermsMap.set(row.user_id, {
          permissions:        row.permissions,
          additional_controls: row.additional_controls,
        });
      }

      // Sync each user
      for (const userId of userIds) {
        const existing = existingPermsMap.get(userId) ?? {
          permissions: {}, additional_controls: {},
        };

        const syncedPerms    = syncPermissions(existing.permissions,        newRolePerms,    oldRole.permissions);
        const syncedControls = syncControls(
            existing.additional_controls,
            newRoleControls,
            oldRole.additional_controls
          );

        await upsertUserPermissionsJsonb(userId, syncedPerms, syncedControls);
      }
    }

    res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: updatedRole.rows[0],
    });
  } catch (error) {
    console.error("Update Role Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Sync a user's existing permissions against old and new role permission blobs.
 *
 * For each key/action in the new role:
 *   - If new role has it TRUE  → add to user if user doesn't already have it TRUE
 *   - If new role has it FALSE → force FALSE on user (authoritative removal)
 *
 * For each key/action that existed in old role but is GONE from new role:
 *   - Remove from user (set to false) — role no longer grants it
 *
 * @param {object} userPerms     Current user permissions blob
 * @param {object} newRolePerms  New role permissions blob
 * @param {object} oldRolePerms  Old role permissions blob (before update)
 * @returns {object} Synced user permissions blob
 */
function syncPermissions(userPerms = {}, newRolePerms = {}, oldRolePerms = {}) {
  // Deep clone user's current permissions
  const synced = JSON.parse(JSON.stringify(userPerms));

  // Gather all module keys across old + new role
  const allModuleKeys = new Set([
    ...Object.keys(newRolePerms),
    ...Object.keys(oldRolePerms),
  ]);

  for (const moduleKey of allModuleKeys) {
    const newModule = newRolePerms[moduleKey] ?? {};
    const oldModule = oldRolePerms[moduleKey] ?? {};

    // All action keys across old + new for this module
    const allActionKeys = new Set([
      ...Object.keys(newModule),
      ...Object.keys(oldModule),
    ]);

    for (const action of allActionKeys) {
      const newVal = newModule[action];
      const oldVal = oldModule[action];

      if (newVal === true) {
        // Role grants this — add to user if not already explicitly true
        if (!synced[moduleKey]) synced[moduleKey] = {};
        if (synced[moduleKey][action] !== true) {
          synced[moduleKey][action] = true;
        }
      } else if (newVal === false || newVal === undefined) {
        // Role removes/disables this — force OFF for user (no exceptions)
        if (synced[moduleKey]) {
          synced[moduleKey][action] = false;
        }
      }
    }

    // Clean up empty module objects
    if (synced[moduleKey] && Object.keys(synced[moduleKey]).length === 0) {
      delete synced[moduleKey];
    }
  }

  return synced;
}

function syncControls(userControls = {}, newRoleControls = {}, oldRoleControls = {}) {
  const synced = { ...userControls };
  const allKeys = new Set([
    ...Object.keys(newRoleControls),
    ...Object.keys(oldRoleControls),
  ]);

  for (const key of allKeys) {
    const newVal = newRoleControls[key];
    if (newVal === true) {
      // Role grants it — only add if user doesn't already have it true
      if (synced[key] !== true) synced[key] = true;
    } else {
      // Role removes/disables — force off
      synced[key] = false;
    }
  }
  return synced;
}

export const deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    const role = await connectDB.query(
      `SELECT * FROM roles WHERE id = $1 AND company_id = $2`,
      [id, req.user.company_id]
    );
    if (role.rows.length === 0) return res.status(404).json({ message: "Role not found" });

    await connectDB.query("DELETE FROM roles WHERE id = $1", [id]);
    res.status(200).json({ message: "Role deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getRoleByName = async (req, res) => {
  const { name }   = req.body;
  const company_id = req.user.company_id;
  try {
    const role = await connectDB.query(
      `SELECT * FROM roles WHERE name = $1 AND company_id = $2`,
      [name, company_id]
    );
    if (role.rows.length === 0) return res.status(404).json({ message: "Role not found" });
    res.status(200).json({ role: role.rows[0] });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getRoleById = async (req, res) => {
  const { id }     = req.params;
  const company_id = req.user.company_id;
  try {
    const role = await connectDB.query(
      `SELECT * FROM roles WHERE id = $1 AND company_id = $2`,
      [id, company_id]
    );
    if (role.rows.length === 0) return res.status(404).json({ message: "Role not found" });
    res.status(200).json({ role: role.rows[0] });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const cloneRole = async (req, res) => {
  const { id }     = req.params;
  const company_id = req.user.company_id;
  try {
    const role = await connectDB.query(
      `SELECT * FROM roles WHERE id = $1 AND company_id = $2`,
      [id, company_id]
    );
    if (role.rows.length === 0) return res.status(404).json({ message: "Role not found" });

    const r = role.rows[0];
    const newRole = await connectDB.query(
      `INSERT INTO roles (company_id, name, description, is_active, permissions, additional_controls, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [r.company_id, `${r.name} (Copy)`, r.description, r.is_active, r.permissions, r.additional_controls, req.user.id]
    );
    res.json({ success: true, data: newRole.rows[0] });
  } catch (err) {
    console.error("Clone Role Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getRoleStats = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const result = await connectDB.query(
      `SELECT
         COUNT(*) AS total_roles,
         COUNT(*) FILTER (WHERE is_active = true) AS active_roles,
         (SELECT COUNT(*) FROM users u WHERE u.company_id = $1) AS users_assigned
       FROM roles WHERE company_id = $1`,
      [company_id]
    );
    const stats = result.rows[0];
    res.json({
      success: true,
      data: {
        totalRoles:    Number(stats.total_roles),
        activeRoles:   Number(stats.active_roles),
        usersAssigned: Number(stats.users_assigned),
      },
    });
  } catch (err) {
    console.error("Role Stats Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};