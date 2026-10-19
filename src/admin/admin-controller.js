// src/auth/admin-controller.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { connectDB } from '../pool.js';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
} from '../../utils/auth.js';

// ─── SELECT + DTO helpers ─────────────────────────────────────

const userWithRoleSelect = `
  SELECT
    u.id, u.name, u.email, u.phone, u.role,u.manager_id,u.team,
    u.branch, u.company_id, u.is_active,u.branch_id,
    u.created_at, u.updated_at,
    COALESCE(r.permissions,         '[]'::jsonb) AS role_permissions,
    COALESCE(r.additional_controls, '{}'::jsonb) AS role_additional_controls,
    COALESCE(r.description,         '')          AS role_description
`;

const fetchUserPermsMap = async (userIds) => {
  const map = new Map();
  if (!userIds.length) return map;
  try {
    const result = await connectDB.query(
      `SELECT up.user_id,
        COALESCE(
          jsonb_agg(jsonb_build_object('permission', up.permission, 'granted', up.granted))
          FILTER (WHERE up.permission IS NOT NULL), '[]'::jsonb
        ) AS permissions
       FROM user_permissions up
       WHERE up.user_id = ANY($1::uuid[])
       GROUP BY up.user_id`,
      [userIds]
    );
    result.rows.forEach((r) => map.set(String(r.user_id), r.permissions));
  } catch { /* table may not exist yet */ }
  return map;
};

const fetchUserBranchMap = async (branchIds) => {
  const map = new Map();
  const uniqueIds = [...new Set(branchIds.filter(Boolean).map(String))];
  if (uniqueIds.length === 0) return map;

  try {
    const result = await connectDB.query(
      `SELECT id, name, code, city, state, is_active
       FROM branches
       WHERE id = ANY($1::uuid[])`,
      [uniqueIds]
    );
    result.rows.forEach((r) => map.set(String(r.id), {
      id: r.id,
      name: r.name,
      code: r.code,
      city: r.city,
      state: r.state,
      isActive: r.is_active,
    }));
  } catch (error) {
    console.error('fetchUserBranchMap error:', error.message);
  }
  return map;
};


const toUserDTO = (row, perms = null, branchMap = null, leadCount = 0) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone || null,
  role: row.role || 'user',
  branch: branchMap || null,
  companyId: row.company_id || null,
  managerId: row.manager_id || null,   // FIX: was missing — frontend needs this for org-chart hierarchy
  team: row.team || null,               // FIX: was missing — frontend needs this for team auto-assign / display
  isActive: row.is_active ?? true,
  status: (row.is_active ?? true) ? 'Active' : 'Inactive',
  leadCount: Number(leadCount) || 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at || null,
  lastLogin: null,
  roleDetails: {
    permissions: row.role_permissions ?? [],
    additionalControls: row.role_additional_controls ?? {},
    description: row.role_description ?? '',
  },
  permissions: perms ?? null,
});

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email?.trim() || !password?.trim()) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const result = await connectDB.query(
      `SELECT id, name, email, phone, role, branch, company_id,
              is_active, password_hash, created_at
       FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated' });
    }

    const match = await comparePassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // ✅ Sirf ek baar — return ke saath
    return res
      .status(200)
      .cookie('token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: Number(process.env.ACCESS_TOKEN_COOKIE) || 86400000, // 24 hours
      })
      .cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: Number(process.env.REFRESH_TOKEN_COOKIE) || 604800000,
      })
      .json({
        success: true,
        message: 'Login successful',
        data: {
          accessToken,
          user: toUserDTO(user),
        },
      });

    // ❌ YEH LINE HATA DO — duplicate response tha
    // return res.status(200).json({ ... });

  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// POST /auth/sing-up
export const singUp = async (req, res) => {
  try {
    const { name, email, password, role, branch, phone, company_id, companyId } = req.body;
    const finalCompanyId = company_id || companyId || null;

    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!email?.trim()) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!password?.trim()) return res.status(400).json({ success: false, message: 'Password is required' });

    const existing = await connectDB.query(
      `SELECT id FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await hashPassword(password.trim());

    const result = await connectDB.query(
      `INSERT INTO users (name, email, phone, password_hash, role, branch, company_id, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       RETURNING id, name, email, phone, role, branch, company_id, is_active, created_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone?.trim() || null,
        hashedPassword,
        role || 'owner_/_ceo',
        branch?.trim() || null,
        finalCompanyId,
      ]
    );

    const newUser = result.rows[0];
    const accessToken = generateAccessToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: { accessToken, user: toUserDTO(newUser) },
    });
  } catch (error) {
    console.error('SignUp error:', error.message);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// POST /auth/logout
export const logout = async (req, res) => {
  try {
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

// GET /auth/me
export const verifyLoggedIn = async (req, res) => {
  try {
    const result = await connectDB.query(
      `${userWithRoleSelect} FROM users u LEFT JOIN roles r ON r.name = u.role WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const permsMap = await fetchUserPermsMap([String(req.user.id)]);
    return res.status(200).json({
      success: true,
      data: toUserDTO(result.rows[0], permsMap.get(String(req.user.id)) ?? null),
    });
  } catch (error) {
    console.error('verifyLoggedIn error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to get user' });
  }
};

// GET /auth/get-single-user
export const GetSingleUser = async (req, res) => {
  try {
    const result = await connectDB.query(
      `${userWithRoleSelect} FROM users u LEFT JOIN roles r ON r.name = u.role WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const permsMap = await fetchUserPermsMap([String(req.user.id)]);
    return res.status(200).json({
      success: true,
      data: toUserDTO(result.rows[0], permsMap.get(String(req.user.id)) ?? null),
    });
  } catch (error) {
    console.error('GetSingleUser error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to get user' });
  }
};

// POST /auth/forgot-password
export const ForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const result = await connectDB.query(
      `SELECT id, name, email FROM users WHERE email = $1 AND is_active = true`,
      [email.trim().toLowerCase()]
    );

    // Always return 200 — don't reveal if email exists
    if (!result.rows[0]) {
      return res.status(200).json({
        success: true,
        message: 'If that email exists, a reset link has been sent',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await connectDB.query(
      `UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3`,
      [token, expiry, result.rows[0].id]
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    console.log('Reset link:', resetLink); // Replace with nodemailer in production

    return res.status(200).json({
      success: true,
      message: 'If that email exists, a reset link has been sent',
      ...(process.env.NODE_ENV === 'development' && { resetLink }),
    });
  } catch (error) {
    console.error('ForgotPassword error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to send reset email' });
  }
};

// POST /auth/reset-password/:token
export const ResetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const password = req.body.password || req.body.newPassword;

    if (!token?.trim()) {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }
    if (!password?.trim()) {
      return res.status(400).json({ success: false, message: 'New password is required' });
    }
    if (password.length < 5) {
      return res.status(400).json({ success: false, message: 'Password must be at least 5 characters' });
    }

    const result = await connectDB.query(
      `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()`,
      [token]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    await connectDB.query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL, updated_at = NOW()
       WHERE id = $2`,
      [hashedPassword, result.rows[0].id]
    );

    return res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('ResetPassword error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

// ══════════════════════════════════════════════════════════════
// COMPANY USER CRUD
// ══════════════════════════════════════════════════════════════

// POST /auth/company-user/create
export const createUserByAdmin = async (req, res) => {
  try {
    const { name, email, password, role, branch, branchId, status, phone, managerId, team } = req.body;
    console.log("req.body==>", req.body)
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!email?.trim()) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!password?.trim()) return res.status(400).json({ success: false, message: 'Password is required' });

    const existing = await connectDB.query(
      `SELECT id FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);
    const isActive = status !== 'Inactive';
    const company_id = req.user?.company_id || null;


  const result = await connectDB.query(
  `INSERT INTO users
     (name, email, phone, password_hash, role, company_id, manager_id, team, branch, branch_id, is_active, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
   RETURNING id, name, email, phone, role, company_id, manager_id, team, branch, branch_id, is_active, created_at`,
  [
    name.trim(),
    email.trim().toLowerCase(),
    phone?.trim() || null,
    hashedPassword,
    role || 'sales_executive',
    company_id,
    managerId || null,
    team || null,
    branch?.trim() || null,
    branchId || null,
    isActive,
  ]
);
    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: toUserDTO(result.rows[0]),
    });
  } catch (error) {
    console.error('createUserByAdmin error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// GET /auth/company-user/all
export const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const search = (req.query.search || '').toString().trim();
    const role = (req.query.role || '').toString().trim();
    const isActiveRaw = (req.query.isActive || '').toString().trim();
    const offset = (page - 1) * limit;

    const conditions = [];
    const values = [];
    let idx = 1;

    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    if (companyId) {
      conditions.push(`u.company_id = $${idx}`);
      values.push(companyId);
      idx++;
    } else {
      conditions.push(`1=0`);
    }

    if (search) {
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }
    if (role && role !== 'ALL') {
      conditions.push(`u.role = $${idx}`);
      values.push(role);
      idx++;
    }
    if (isActiveRaw === 'true' || isActiveRaw === 'false') {
      conditions.push(`u.is_active = $${idx}`);
      values.push(isActiveRaw === 'true');
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalResult = await connectDB.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
      values
    );
    const total = totalResult.rows[0]?.total || 0;

    const result = await connectDB.query(
      `${userWithRoleSelect}
       FROM users u
       LEFT JOIN roles r ON r.name = u.role
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );


    const userIds = result.rows.map((r) => String(r.id));
    const branchIds = result.rows.map((r) => r.branch_id);

    const [branchMap, userPermsMap, leadCountsResult] = await Promise.all([
      fetchUserBranchMap(branchIds),
      fetchUserPermsMap(userIds),
      connectDB.query(`
        SELECT assigned, COUNT(*)::int AS count
        FROM leads
        WHERE assigned IS NOT NULL AND TRIM(assigned) != ''
        GROUP BY assigned
      `).catch(() => ({ rows: [] })),
    ]);

    const leadCountsMap = new Map();
    leadCountsResult.rows.forEach((r) => {
      if (r.assigned) {
        leadCountsMap.set(r.assigned.toLowerCase().trim(), Number(r.count) || 0);
      }
    });

    const items = result.rows.map((row) => {
      const userLeadCount =
        leadCountsMap.get(row.name?.toLowerCase().trim()) ||
        leadCountsMap.get(String(row.id)) ||
        leadCountsMap.get(row.email?.toLowerCase().trim()) ||
        0;

      return toUserDTO(
        row,
        userPermsMap.get(String(row.id)) ?? null,
        branchMap.get(String(row.branch_id)) ?? null,
        userLeadCount
      );
    });


    return res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: { items, total, page, limit },
    });
  } catch (error) {
    console.error('getAllUsers error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// GET /auth/company-user/:id
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await connectDB.query(
      `${userWithRoleSelect} FROM users u LEFT JOIN roles r ON r.name = u.role WHERE u.id = $1`,
      [id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const permsMap = await fetchUserPermsMap([id]);
    return res.status(200).json({
      success: true,
      data: toUserDTO(result.rows[0], permsMap.get(id) ?? null),
    });
  } catch (error) {
    console.error('getUserById error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to get user' });
  }
};

// PATCH /auth/company-user/update/:id
export const updateUserByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, branch, branchId, managerId, team, phone, is_active } = req.body;

    const existing = await connectDB.query(`SELECT id FROM users WHERE id = $1`, [id]);
    if (!existing.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Email unique check
    if (email) {
      const emailCheck = await connectDB.query(
        `SELECT id FROM users WHERE email = $1 AND id != $2`,
        [email.trim().toLowerCase(), id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Email already in use' });
      }
    }

    const sets = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx}`); values.push(name.trim()); idx++; }
    if (email !== undefined) { sets.push(`email = $${idx}`); values.push(email.trim().toLowerCase()); idx++; }
    if (phone !== undefined) { sets.push(`phone = $${idx}`); values.push(phone?.trim() || null); idx++; }
    if (role !== undefined) { sets.push(`role = $${idx}`); values.push(role); idx++; }
    if (branch !== undefined) { sets.push(`branch = $${idx}`); values.push(branch?.trim() || null); idx++; }
    if (team !== undefined) { sets.push(`team = $${idx}`); values.push(team?.trim() || null); idx++; }
    if (managerId !== undefined) { sets.push(`manager_id = $${idx}`); values.push(managerId?.trim() || null); idx++; }
    if (branchId !== undefined) { sets.push(`branch_id = $${idx}`); values.push(branchId?.trim() || null); idx++; }
    if (is_active !== undefined) { sets.push(`is_active = $${idx}`); values.push(Boolean(is_active)); idx++; }
    if (password?.trim()) {
      const hashed = await bcrypt.hash(password.trim(), 10);
      sets.push(`password_hash = $${idx}`);
      values.push(hashed);
      idx++;
    }

    if (!sets.length) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await connectDB.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: toUserDTO(result.rows[0]),
    });
  } catch (error) {
    console.error('updateUserByAdmin error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// DELETE /auth/company-user/delete/:id
export const deleteUserByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const permanent = req.query.permanent === 'true';

    const userCheck = await connectDB.query(
      `SELECT id, role, name, email FROM users WHERE id = $1`,
      [id]
    );
    if (!userCheck.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (String(userCheck.rows[0].role).toUpperCase() === 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Cannot delete Super Admin' });
    }

    // FIX: check for direct reports before permanently deleting —
    // otherwise the FK constraint on manager_id rejects the delete.
    if (permanent) {
      const reports = await connectDB.query(
        `SELECT id, name FROM users WHERE manager_id = $1 AND is_active = true`,
        [id]
      );
      if (reports.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot permanently delete this user — ${reports.rows.length} team member(s) still report to them. Reassign their manager first.`,
          data: { directReports: reports.rows },
        });
      }
    }

    if (permanent) {
      await connectDB.query(`DELETE FROM users WHERE id = $1`, [id]);
    } else {
      await connectDB.query(
        `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [id]
      );
    }

    return res.status(200).json({
      success: true,
      message: permanent ? 'User permanently deleted' : 'User deactivated successfully',
      data: {
        id: userCheck.rows[0].id,
        name: userCheck.rows[0].name,
        email: userCheck.rows[0].email,
      },
    });
  } catch (error) {
    console.error('deleteUserByAdmin error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// PATCH /auth/company-user/:id/permissions
export const updateUserPermissionsByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body; // [{ permission, granted }]

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'permissions must be an array' });
    }

    // Delete existing and re-insert
    await connectDB.query(`DELETE FROM user_permissions WHERE user_id = $1`, [id]);

    if (permissions.length > 0) {
      const vals = permissions.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const params = [id, ...permissions.flatMap((p) => [p.permission, p.granted ?? true])];
      await connectDB.query(
        `INSERT INTO user_permissions (user_id, permission, granted) VALUES ${vals}`,
        params
      );
    }

    return res.status(200).json({ success: true, message: 'Permissions updated successfully' });
  } catch (error) {
    console.error('updateUserPermissions error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update permissions' });
  }
};

// PATCH /auth/company-user/:id/active
export const toggleUserActiveByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const result = await connectDB.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, is_active`,
      [Boolean(is_active), id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('toggleUserActive error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to toggle user status' });
  }
};

// POST /auth/company-user/search-filter
export const searchAndFilterUsers = async (req, res) => {
  try {
    const { search, role, branch, is_active, page = 1, limit = 50 } = req.body;
    const offset = (page - 1) * limit;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (search) {
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }
    if (role) { conditions.push(`u.role = $${idx}`); values.push(role); idx++; }
    if (branch) { conditions.push(`u.branch = $${idx}`); values.push(branch); idx++; }
    if (is_active !== undefined) {
      conditions.push(`u.is_active = $${idx}`);
      values.push(Boolean(is_active));
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [totalResult, result] = await Promise.all([
      connectDB.query(`SELECT COUNT(*)::int AS total FROM users u ${whereClause}`, values),
      connectDB.query(
        `${userWithRoleSelect} FROM users u LEFT JOIN roles r ON r.name = u.role
         ${whereClause} ORDER BY u.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ]);

    const userIds = result.rows.map((r) => String(r.id));
    const userPermsMap = await fetchUserPermsMap(userIds);

    return res.status(200).json({
      success: true,
      data: {
        items: result.rows.map((row) => toUserDTO(row, userPermsMap.get(String(row.id)) ?? null)),
        total: totalResult.rows[0]?.total || 0,
        page,
        limit,
      },
    });
  } catch (error) {
    console.error('searchAndFilterUsers error:', error.message);
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
};

// GET /auth/company-users/all  (super admin)
export const getAllUsersForSuperAdmin = async (req, res) => {
  try {
    const result = await connectDB.query(
      `${userWithRoleSelect} FROM users u LEFT JOIN roles r ON r.name = u.role ORDER BY u.created_at DESC`
    );
    const userIds = result.rows.map((r) => String(r.id));
    const userPermsMap = await fetchUserPermsMap(userIds);
    return res.status(200).json({
      success: true,
      data: result.rows.map((row) => toUserDTO(row, userPermsMap.get(String(row.id)) ?? null)),
    });
  } catch (error) {
    console.error('getAllUsersForSuperAdmin error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to get users' });
  }
};