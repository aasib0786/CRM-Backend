import connectDB from '../pool.js';

export const getReportsSummary = async (req, res) => {
  try {
    const leadsRes = await connectDB.query(`SELECT COUNT(*) as total_leads, COUNT(*) FILTER (WHERE stage = 'Won') as won_leads FROM public.leads`);
    const quotationsRes = await connectDB.query(`SELECT COUNT(*) as total_quotes, SUM(total_amount) as revenue FROM public.quotations`);
    const campaignsRes = await connectDB.query(`SELECT COUNT(*) as total_campaigns FROM public.campaigns`);
    const callsRes = await connectDB.query(`SELECT COUNT(*) as total_calls FROM public.calls`);

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
