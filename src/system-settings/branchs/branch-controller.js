// Adjust this path to match your folder depth.
// Aliased so it works whether your pool exports `connectDB` or `pool`.
import { connectDB as pool } from "../../pool.js";

/* ============================================================================
 *  Helpers
 * ==========================================================================*/

const BASE_SELECT = `
  SELECT
    b.id,
    b.name,
    b.code,
    b.city,
    b.state,
    b.address,
    b.phone,
    b.is_active,
    b.created_at,
    b.updated_at,
    uc.user_count
  FROM branches b
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS user_count
    FROM users u
    WHERE u.branch = b.name
  ) uc ON TRUE
`;

const mapBranch = (row) => ({
  id: row.id,
  name: row.name,
  code: row.code || "",
  city: row.city || "",
  state: row.state || "",
  address: row.address || "",
  phone: row.phone || "",
  isActive: row.is_active,
  userCount: Number(row.user_count || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const ok = (res, data, message) => res.status(200).json({ success: true, message, data });
const fail = (res, status, message) => res.status(status).json({ success: false, message });

const handleDbError = (res, err, label) => {
  console.error(`${label}:`, err);
  if (err.code === "23505") return fail(res, 409, "A branch with this name or code already exists");
  if (err.code === "23503") return fail(res, 400, "Referenced record does not exist");
  if (err.code === "22P02") return fail(res, 400, "Invalid id format");
  return fail(res, 500, "Something went wrong while processing the request");
};

const PHONE_RE = /^[+\d][\d\s\-()]{6,19}$/;

/** Validate + normalise. `partial: true` = absent fields mean "leave as is". */
function parsePayload(body, { partial = false } = {}) {
  const errors = [];
  const values = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) errors.push("Branch name is required");
    else if (name.length > 100) errors.push("Branch name must be 100 characters or fewer");
    else values.name = name;
  } else if (!partial) {
    errors.push("Branch name is required");
  }

  if (body.code !== undefined) {
    const code = String(body.code).trim().toUpperCase();
    if (code.length > 20) errors.push("Branch code must be 20 characters or fewer");
    else values.code = code || null;
  }

  for (const field of ["city", "state"]) {
    if (body[field] !== undefined) {
      const v = String(body[field]).trim();
      if (v.length > 100) errors.push(`${field} must be 100 characters or fewer`);
      else values[field] = v || null;
    }
  }

  if (body.address !== undefined) {
    values.address = String(body.address).trim() || null;
  }

  if (body.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (phone && !PHONE_RE.test(phone)) errors.push("Enter a valid phone number");
    else values.phone = phone || null;
  }

  if (body.isActive !== undefined) values.isActive = body.isActive !== false;

  return { errors, values };
}

/* ============================================================================
 *  POST /branches/create
 * ==========================================================================*/
export const createBranch = async (req, res) => {
  try {
    const { errors, values } = parsePayload(req.body);
    if (errors.length) return fail(res, 400, errors[0]);

    const dupName = await pool.query(
      `SELECT id FROM branches WHERE lower(name) = lower($1)`,
      [values.name]
    );
    if (dupName.rows.length) return fail(res, 409, "A branch with this name already exists");

    if (values.code) {
      const dupCode = await pool.query(
        `SELECT id FROM branches WHERE upper(code) = upper($1)`,
        [values.code]
      );
      if (dupCode.rows.length) return fail(res, 409, "A branch with this code already exists");
    }

    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.body?.company_id || null;
    const inserted = await pool.query(
      `INSERT INTO branches (name, code, city, state, address, phone, is_active, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        values.name,
        values.code || null,
        values.city || null,
        values.state || null,
        values.address || null,
        values.phone || null,
        values.isActive !== false,
        companyId ? String(companyId) : null,
      ]
    );

    const { rows } = await pool.query(`${BASE_SELECT} WHERE b.id = $1`, [inserted.rows[0].id]);

    return res.status(201).json({
      success: true,
      message: "Branch created",
      data: mapBranch(rows[0]),
    });
  } catch (err) {
    return handleDbError(res, err, "Create Branch Error");
  }
};

/* ============================================================================
 *  GET /branches/get-all?search=&isActive=&page=&limit=
 * ==========================================================================*/
export const getBranches = async (req, res) => {
  try {
    const { search = "", isActive = "", page = 1, limit = 100 } = req.query;

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const filters = [];
    const params = [];

    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    if (companyId) {
      params.push(String(companyId));
      filters.push(`b.company_id::text = $${params.length}`);
    } else {
      filters.push(`1=0`);
    }

    if (String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      filters.push(`(b.name ILIKE $${i} OR b.code ILIKE $${i} OR b.city ILIKE $${i})`);
    }
    if (isActive === "true" || isActive === "false") {
      params.push(isActive === "true");
      filters.push(`b.is_active = $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM branches b ${where}`,
      params
    );

    params.push(safeLimit, offset);
    const result = await pool.query(
      `${BASE_SELECT} ${where}
       ORDER BY b.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok(res, {
      items: result.rows.map(mapBranch),
      total: countResult.rows[0].total,
      page: safePage,
      limit: safeLimit,
    });
  } catch (err) {
    return handleDbError(res, err, "Get Branches Error");
  }
};

/* ============================================================================
 *  GET /branches/get-by-id/:id
 * ==========================================================================*/
export const getBranchById = async (req, res) => {
  try {
    const { rows } = await pool.query(`${BASE_SELECT} WHERE b.id = $1`, [req.params.id]);
    if (!rows.length) return fail(res, 404, "Branch not found");
    return ok(res, mapBranch(rows[0]));
  } catch (err) {
    return handleDbError(res, err, "Get Branch By Id Error");
  }
};

/* ============================================================================
 *  PUT / PATCH /branches/update/:id
 * ==========================================================================*/
export const updateBranch = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { errors, values } = parsePayload(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors[0]);

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, name FROM branches WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Branch not found");
    }
    const oldName = existing.rows[0].name;

    if (values.name) {
      const dup = await client.query(
        `SELECT id FROM branches WHERE lower(name) = lower($1) AND id <> $2`,
        [values.name, id]
      );
      if (dup.rows.length) {
        await client.query("ROLLBACK");
        return fail(res, 409, "A branch with this name already exists");
      }
    }

    if (values.code) {
      const dup = await client.query(
        `SELECT id FROM branches WHERE upper(code) = upper($1) AND id <> $2`,
        [values.code, id]
      );
      if (dup.rows.length) {
        await client.query("ROLLBACK");
        return fail(res, 409, "A branch with this code already exists");
      }
    }

    await client.query(
      `UPDATE branches SET
         name      = COALESCE($2::varchar, name),
         code      = CASE WHEN $3::boolean THEN $4::varchar ELSE code    END,
         city      = CASE WHEN $5::boolean THEN $6::varchar ELSE city    END,
         state     = CASE WHEN $7::boolean THEN $8::varchar ELSE state   END,
         address   = CASE WHEN $9::boolean THEN $10::text   ELSE address END,
         phone     = CASE WHEN $11::boolean THEN $12::varchar ELSE phone END,
         is_active = COALESCE($13::boolean, is_active)
       WHERE id = $1`,
      [
        id,
        values.name ?? null,
        "code" in values, values.code ?? null,
        "city" in values, values.city ?? null,
        "state" in values, values.state ?? null,
        "address" in values, values.address ?? null,
        "phone" in values, values.phone ?? null,
        values.isActive ?? null,
      ]
    );

    // users.branch stores the branch NAME — keep it in sync on rename.
    if (values.name && values.name !== oldName) {
      await client.query(`UPDATE users SET branch = $1 WHERE branch = $2`, [values.name, oldName]);
    }

    const { rows } = await client.query(`${BASE_SELECT} WHERE b.id = $1`, [id]);
    await client.query("COMMIT");

    return ok(res, mapBranch(rows[0]), "Branch updated");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return handleDbError(res, err, "Update Branch Error");
  } finally {
    client.release();
  }
};

/* ============================================================================
 *  DELETE /branches/delete/:id?reassignTo=<uuid>
 * ==========================================================================*/
export const deleteBranch = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { reassignTo } = req.query;

    await client.query("BEGIN");

    const existing = await client.query(`SELECT id, name FROM branches WHERE id = $1 FOR UPDATE`, [id]);
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Branch not found");
    }
    const branch = existing.rows[0];

    const userCount = (
      await client.query(`SELECT COUNT(*)::int AS count FROM users WHERE branch = $1`, [branch.name])
    ).rows[0].count;

    if (userCount > 0) {
      if (!reassignTo) {
        await client.query("ROLLBACK");
        return fail(
          res,
          409,
          `${userCount} ${userCount === 1 ? "user is" : "users are"} still assigned to this branch. Move them to another branch first.`
        );
      }
      const target = await client.query(
        `SELECT name FROM branches WHERE id = $1 AND id <> $2`,
        [reassignTo, id]
      );
      if (!target.rows.length) {
        await client.query("ROLLBACK");
        return fail(res, 400, "The branch you want to move users to was not found");
      }
      await client.query(`UPDATE users SET branch = $1 WHERE branch = $2`, [
        target.rows[0].name,
        branch.name,
      ]);
    }

    await client.query(`DELETE FROM branches WHERE id = $1`, [id]);
    await client.query("COMMIT");

    return ok(res, { id }, `${branch.name} deleted`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return handleDbError(res, err, "Delete Branch Error");
  } finally {
    client.release();
  }
};

/* ============================================================================
 *  PATCH /branches/toggle-status/:id
 * ==========================================================================*/
export const toggleBranchStatus = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE branches SET is_active = NOT is_active
       WHERE id = $1
       RETURNING id, name, is_active`,
      [req.params.id]
    );
    if (!rows.length) return fail(res, 404, "Branch not found");

    const row = rows[0];
    return ok(
      res,
      { id: row.id, isActive: row.is_active },
      row.is_active ? `${row.name} activated` : `${row.name} deactivated`
    );
  } catch (err) {
    return handleDbError(res, err, "Toggle Branch Status Error");
  }
};

/* ============================================================================
 *  GET /branches/stats
 * ==========================================================================*/
export const getBranchStats = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int                          AS total_branches,
         COUNT(*) FILTER (WHERE is_active)::int AS active_branches,
         COUNT(DISTINCT city)::int              AS cities,
         (SELECT COUNT(*)::int FROM users u
           WHERE u.branch IS NOT NULL AND u.branch <> '') AS users_assigned
       FROM branches`
    );

    const s = rows[0];
    return ok(res, {
      totalBranches: s.total_branches,
      activeBranches: s.active_branches,
      cities: s.cities,
      usersAssigned: s.users_assigned,
    });
  } catch (err) {
    return handleDbError(res, err, "Branch Stats Error");
  }
};

/* ============================================================================
 *  GET /branches/users/:id
 * ==========================================================================*/
export const getBranchUsers = async (req, res) => {
  try {
    const branch = await pool.query(`SELECT name FROM branches WHERE id = $1`, [req.params.id]);
    if (!branch.rows.length) return fail(res, 404, "Branch not found");

    const { rows } = await pool.query(
      `SELECT id, name, email, phone, role, is_active
       FROM users WHERE branch = $1 ORDER BY name ASC`,
      [branch.rows[0].name]
    );
    return ok(res, { items: rows, total: rows.length });
  } catch (err) {
    return handleDbError(res, err, "Get Branch Users Error");
  }
};



