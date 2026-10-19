import connectDB from '../../pool.js';

export const getTeams = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    let query = `SELECT * FROM public.teams`;
    const params = [];
    if (companyId) {
      query += ` WHERE company_id::text = $1`;
      params.push(String(companyId));
    } else {
      query += ` WHERE 1=0`;
    }
    query += ` ORDER BY created_at DESC`;
    const { rows } = await connectDB.query(query, params);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { name, leader_name, member_names, description } = req.body;
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.body?.company_id || null;
    const { rows } = await connectDB.query(
      `INSERT INTO public.teams (name, leader_name, member_names, description, company_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, leader_name || null, JSON.stringify(member_names || []), description || null, companyId ? String(companyId) : null]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    let delQuery = `DELETE FROM public.teams WHERE id = $1`;
    const params = [id];
    if (companyId) {
      delQuery += ` AND company_id::text = $2`;
      params.push(String(companyId));
    }
    await connectDB.query(delQuery, params);
    return res.status(200).json({ success: true, message: 'Team deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
