import connectDB from '../pool.js';

export const getReportsSummary = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
    if (!companyId) {
      return res.status(200).json({
        success: true,
        data: {
          totalLeads: 0,
          wonLeads: 0,
          totalQuotations: 0,
          totalRevenue: 0,
          totalCampaigns: 0,
          totalCalls: 0
        }
      });
    }

    const cid = String(companyId);

    const [leadsRes, quotationsRes, campaignsRes, callsRes] = await Promise.all([
      connectDB.query(
        `SELECT COUNT(*) as total_leads, COUNT(*) FILTER (WHERE stage = 'Won') as won_leads 
         FROM public.leads WHERE company_id::text = $1`,
        [cid]
      ),
      connectDB.query(
        `SELECT COUNT(*) as total_quotes, COALESCE(SUM(total_amount), 0) as revenue 
         FROM public.quotations WHERE company_id::text = $1`,
        [cid]
      ),
      connectDB.query(
        `SELECT COUNT(*) as total_campaigns 
         FROM public.campaigns WHERE company_id::text = $1`,
        [cid]
      ),
      connectDB.query(
        `SELECT COUNT(*) as total_calls 
         FROM public.calls WHERE company_id::text = $1`,
        [cid]
      )
    ]);

    const summary = {
      totalLeads: Number(leadsRes.rows[0]?.total_leads || 0),
      wonLeads: Number(leadsRes.rows[0]?.won_leads || 0),
      totalQuotations: Number(quotationsRes.rows[0]?.total_quotes || 0),
      totalRevenue: Number(quotationsRes.rows[0]?.revenue || 0),
      totalCampaigns: Number(campaignsRes.rows[0]?.total_campaigns || 0),
      totalCalls: Number(callsRes.rows[0]?.total_calls || 0)
    };

    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
