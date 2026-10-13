import connectDB from '../../pool.js';

export const getTeams = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.teams ORDER BY created_at DESC`);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { name, leader_name, member_names, description } = req.body;
    const { rows } = await connectDB.query(
      `INSERT INTO public.teams (name, leader_name, member_names, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, leader_name || null, JSON.stringify(member_names || []), description || null]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;
    await connectDB.query(`DELETE FROM public.teams WHERE id = $1`, [id]);
    return res.status(200).json({ success: true, message: 'Team deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
