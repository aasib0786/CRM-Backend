import crypto from 'crypto';
import connectDB from '../pool.js';

export const getIntegrations = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.integrations ORDER BY name ASC`);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateIntegration = async (req, res) => {
  try {
    const { key } = req.params;
    const { status, config } = req.body;
    const { rows } = await connectDB.query(
      `INSERT INTO public.integrations (key, name, status, config, connected_at)
       VALUES ($1, $1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
        status = EXCLUDED.status,
        config = EXCLUDED.config,
        connected_at = NOW()
       RETURNING *`,
      [key, status || 'Connected', JSON.stringify(config || {})]
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const buildEmbedCode = (webhookUrl) => {
  return `<form id="nf-form">
  <input name="name" placeholder="Name" required>
  <input name="phone" placeholder="Phone" required>
  <input name="email" placeholder="Email">
  <textarea name="message" placeholder="Message"></textarea>
  <!-- Anti-spam honeypot (keep hidden from users) -->
  <input type="text" name="website" style="display:none !important;" tabindex="-1" autocomplete="off">
  <button type="submit">Submit</button>
</form>
<script>
document.getElementById('nf-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const res = await fetch('${webhookUrl}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) {
      e.target.reset();
      alert('Thank you! We will contact you soon.');
    } else {
      alert('Failed to submit. Please try again.');
    }
  } catch (err) {
    alert('Network error. Please try again.');
  }
});
</script>`;
};

// ─── Website Forms Accounts ─────────────────────────────────────

export const createFormAccount = async (req, res) => {
  try {
    const { account_name } = req.body;
    if (!account_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Account name required' });
    }

    const companyId = req.user?.company_id || req.user?.id || 'default';
    const userId = req.user?.id || null;
    const webhookKey = 'wf_' + crypto.randomBytes(20).toString('hex');

    const { rows } = await connectDB.query(
      `INSERT INTO public.integration_accounts (company_id, provider, account_name, webhook_key, created_by, status)
       VALUES ($1, 'website_forms', $2, $3, $4, 'active')
       RETURNING *`,
      [String(companyId), account_name.trim(), webhookKey, userId ? String(userId) : null]
    );

    const baseUrl = process.env.API_PUBLIC_URL || process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${baseUrl}/api/v1/webhooks/forms/${webhookKey}`;
    const embedCode = buildEmbedCode(webhookUrl);

    return res.status(201).json({
      success: true,
      message: 'Website Forms account created successfully',
      data: {
        ...rows[0],
        webhook_url: webhookUrl,
        embed_code: embedCode,
      },
    });
  } catch (err) {
    console.error('createFormAccount error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create account' });
  }
};

export const getFormAccounts = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.id;
    let query = `
      SELECT a.*,
        COALESCE(
          a.last_received_at,
          (SELECT MAX(created_at) FROM public.leads WHERE source = 'Website Form')
        ) AS last_received_at,
        COALESCE((
          SELECT COUNT(*)::int FROM public.leads l 
          WHERE (l.meta->>'integration_account_id' = a.id::text OR l.source = 'Website Form')
            AND (l.created_at::date = CURRENT_DATE OR l.created_at >= NOW() - INTERVAL '24 hours')
        ), 0) AS leads_today
      FROM public.integration_accounts a
      WHERE a.provider = 'website_forms'
    `;
    const values = [];

    if (companyId) {
      query += ` AND (a.company_id = $1 OR a.company_id = 'default' OR a.company_id IS NULL)`;
      values.push(String(companyId));
    }

    query += ` ORDER BY a.created_at DESC`;

    const { rows } = await connectDB.query(query, values);
    const baseUrl = process.env.API_PUBLIC_URL || process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;

    const items = rows.map((acc) => {
      const webhookUrl = `${baseUrl}/api/v1/webhooks/forms/${acc.webhook_key}`;
      return {
        ...acc,
        leadsToday: acc.leads_today || 0,
        webhook_url: webhookUrl,
        embed_code: buildEmbedCode(webhookUrl),
      };
    });

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
      items,
    });
  } catch (err) {
    console.error('getFormAccounts error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch accounts' });
  }
};

export const deleteFormAccount = async (req, res) => {
  try {
    const { id } = req.params;
    await connectDB.query(`DELETE FROM public.integration_accounts WHERE id = $1`, [id]);
    return res.status(200).json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    console.error('deleteFormAccount error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
};
