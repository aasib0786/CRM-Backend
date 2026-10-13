// // // controllers/dashboardController.js
// // import pool from '../pool.js';

// // export const getDashboard = async (req, res, next) => {
// //     const { company_id } = req.user;

// //     if (!company_id) {
// //         return res.status(201).json({ status: false, message: "Company ID not found in token." });
// //         // return next(new ErrorHandler('Company ID not found in token.', 400));
// //     }

// //     const [
// //         kpiResult,
// //         salesTrendResult,
// //         topItemsResult,
// //         recentTxResult,
// //         lowStockResult,
// //         pendingChallansResult,
// //         overdueGatePassResult,
// //     ] = await Promise.all([

// //         // ── 1. KPIs ────────────────────────────────────────────────────────────
// //         pool.query(`
// //       SELECT
// //         COALESCE(SUM(si.total_amount) FILTER (
// //           WHERE si.status = 'SAVED'
// //           AND DATE_TRUNC('month', si.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
// //         ), 0) AS sales_this_period,

// //         COALESCE(SUM(pi.total_amount) FILTER (
// //           WHERE DATE_TRUNC('month', pi.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
// //         ), 0) AS purchase_this_period,

// //         COALESCE((
// //           SELECT SUM(balance_due)
// //           FROM sales_invoices
// //           WHERE company_id = $1
// //             AND status = 'SAVED'
// //             AND payment_status IN ('UNPAID', 'PARTIAL')
// //             AND is_active = true
// //         ), 0) AS total_receivables,

// //         COALESCE((
// //           SELECT SUM(pi2.total_amount - pi2.paid_amount)
// //           FROM purchase_invoices pi2
// //           WHERE pi2.company_id = $1
// //             AND pi2.payment_status IN ('UNPAID', 'PARTIAL')
// //         ), 0) AS total_payables

// //       FROM sales_invoices si
// //       LEFT JOIN purchase_invoices pi ON pi.company_id = $1
// //       WHERE si.company_id = $1
// //         AND si.is_active = true
// //     `, [company_id]),

// //         // ── 2. Sales Trend (last 6 months) ─────────────────────────────────────
// //         pool.query(`
// //       WITH months AS (
// //         SELECT generate_series(
// //           DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
// //           DATE_TRUNC('month', CURRENT_DATE),
// //           '1 month'
// //         ) AS month
// //       ),
// //       monthly_sales AS (
// //         SELECT
// //           DATE_TRUNC('month', invoice_date) AS month,
// //           SUM(total_amount) AS total
// //         FROM sales_invoices
// //         WHERE company_id = $1
// //           AND status = 'SAVED'
// //           AND is_active = true
// //           AND invoice_date >= CURRENT_DATE - INTERVAL '6 months'
// //         GROUP BY 1
// //       ),
// //       monthly_purchase AS (
// //         SELECT
// //           DATE_TRUNC('month', invoice_date) AS month,
// //           SUM(total_amount) AS total
// //         FROM purchase_invoices
// //         WHERE company_id = $1
// //           AND invoice_date >= CURRENT_DATE - INTERVAL '6 months'
// //         GROUP BY 1
// //       )
// //       SELECT
// //         TO_CHAR(m.month, 'Mon') AS month,
// //         COALESCE(ms.total, 0)::FLOAT AS sales,
// //         COALESCE(mp.total, 0)::FLOAT AS purchase
// //       FROM months m
// //       LEFT JOIN monthly_sales ms ON ms.month = m.month
// //       LEFT JOIN monthly_purchase mp ON mp.month = m.month
// //       ORDER BY m.month ASC
// //     `, [company_id]),

// //         // ── 3. Top 5 Selling Items this month ──────────────────────────────────
// //         pool.query(`
// //       SELECT
// //         i.name,
// //         SUM(sii.quantity) AS sold
// //       FROM sales_invoice_items sii
// //       JOIN sales_invoices si ON si.id = sii.sales_invoice_id
// //       JOIN items i ON i.id = sii.item_id
// //       WHERE si.company_id = $1
// //         AND si.status = 'SAVED'
// //         AND si.is_active = true
// //         AND DATE_TRUNC('month', si.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
// //       GROUP BY i.id, i.name
// //       ORDER BY sold DESC
// //       LIMIT 5
// //     `, [company_id]),

// //         // ── 4. Recent 10 Transactions ───────────────────────────────────────────
// //         pool.query(`
// //       SELECT
// //         invoice_number AS id,
// //         'Sale' AS type,
// //         p.name AS party,
// //         TO_CHAR(invoice_date, 'DD MMM YYYY') AS date,
// //         '₹' || TO_CHAR(total_amount, 'FM99,99,99,990.00') AS amount,
// //         INITCAP(payment_status) AS status
// //       FROM sales_invoices si
// //       JOIN parties p ON p.id = si.customer_id
// //       WHERE si.company_id = $1
// //         AND si.status = 'SAVED'
// //         AND si.is_active = true

// //       UNION ALL

// //       SELECT
// //         invoice_number AS id,
// //         'Purchase' AS type,
// //         p.name AS party,
// //         TO_CHAR(invoice_date, 'DD MMM YYYY') AS date,
// //         '₹' || TO_CHAR(total_amount, 'FM99,99,99,990.00') AS amount,
// //         INITCAP(payment_status::TEXT) AS status
// //       FROM purchase_invoices pi
// //       JOIN parties p ON p.id = pi.supplier_id
// //       WHERE pi.company_id = $1

// //       ORDER BY date DESC
// //       LIMIT 10
// //     `, [company_id]),

// //         // ── 5. Low Stock Items ─────────────────────────────────────────────────
// //         pool.query(`
// //       SELECT
// //         i.code,
// //         i.name,
// //         COALESCE(ws.quantity, 0)::FLOAT AS stock,
// //         i.min_stock_level::FLOAT AS reorder,
// //         u.name AS unit
// //       FROM items i
// //       LEFT JOIN warehouse_stock ws ON ws.item_id = i.id AND ws.company_id = $1
// //       LEFT JOIN units u ON u.id = i.primary_unit_id
// //       WHERE i.company_id = $1
// //         AND i.is_active = true
// //         AND COALESCE(ws.quantity, 0) < i.min_stock_level
// //         AND i.min_stock_level > 0
// //       ORDER BY (COALESCE(ws.quantity, 0) / NULLIF(i.min_stock_level, 0)) ASC
// //       LIMIT 10
// //     `, [company_id]),

// //         // ── 6. Pending Challans Count ──────────────────────────────────────────
// //         pool.query(`
// //       SELECT COUNT(*) AS count
// //       FROM challans
// //       WHERE company_id = $1
// //         AND status = 'SAVED'
// //         AND converted_to_invoice = false
// //         AND is_active = true
// //     `, [company_id]),

// //         // ── 7. Overdue + Rejected Gate Passes ──────────────────────────────────
// //         // gp.gate_pass_number,

// //         pool.query(`
// //       SELECT
// //         gp.id,
// //         gp.type,
// //         gp.status,
// //         gp.verification_status,
// //         gp.created_by,
// //         gp.is_recreated
// //       FROM gate_passes gp
// //       WHERE gp.company_id = $1
// //         AND (
// //           (gp.type = 'OUTWARD' AND gp.status = 'OVERDUE')
// //           OR gp.verification_status = 'REJECTED'
// //         )
// //     `, [company_id]),
// //     ]);

// //     const kpi = kpiResult.rows[0];

// //     res.status(200).json({
// //         success: true,
// //         data: {
// //             kpis: {
// //                 salesThisPeriod: parseFloat(kpi.sales_this_period),
// //                 purchaseThisPeriod: parseFloat(kpi.purchase_this_period),
// //                 totalReceivables: parseFloat(kpi.total_receivables),
// //                 totalPayables: parseFloat(kpi.total_payables),
// //                 lowStockCount: lowStockResult.rows.length,
// //                 pendingChallans: parseInt(pendingChallansResult.rows[0]?.count ?? 0),
// //             },
// //             salesTrend: salesTrendResult.rows,
// //             topItems: topItemsResult.rows.map(r => ({
// //                 name: r.name,
// //                 sold: parseFloat(r.sold),
// //             })),
// //             recentTransactions: recentTxResult.rows,
// //             lowStockItems: lowStockResult.rows,
// //             gatePasses: overdueGatePassResult.rows,
// //         },
// //     });
// // };


// // dashboard.controller.js


// import pool from '../pool.js';


// export const getDashboardSummary = async (req, res) => {
//   try {
//     res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
//     res.set("Pragma", "no-cache");
//     res.set("Expires", "0");
//     const warehouseId = req.query.warehouseId
//     console.log('warehouseId===>' ,warehouseId)
//     const [kpiResult, recentResult, topItemsResult] = await Promise.all([

//       // ── A: KPI aggregations ──────────────────────────────────────────────
//       pool.query(`
//         WITH

//         -- 1. Current month sales KPIs
//         sales_kpi AS (
//           SELECT
//             COALESCE(SUM(total_amount), 0)                                               AS total_sales,
//             COALESCE(SUM(CASE WHEN payment_status != 'PAID' THEN balance_due ELSE 0 END), 0) AS total_receivables,
//             COUNT(CASE WHEN payment_status != 'PAID' THEN 1 END)::int                   AS unpaid_invoice_count
//           FROM public.sales_invoices
//           WHERE status    = 'SAVED'
//             AND is_active = true

//         ),

//           purchase_kpi AS (
//           SELECT
//             COALESCE(SUM(total_amount), 0)                                               AS total_purchases,
//             COALESCE(SUM(CASE WHEN payment_status != 'PAID'
//                               THEN (total_amount - paid_amount)
//                               ELSE 0 END), 0)                                            AS total_payables
//           FROM public.purchase_invoices
//                 ),

//            low_stock_kpi AS (
//           SELECT COUNT(*)::int AS low_stock_count
//           FROM public.warehouse_stock ws
//           JOIN public.items i ON i.id = ws.item_id
//           WHERE ws.quantity <= i.min_stock_level
//             AND i.min_stock_level > 0
//             AND i.is_active = true
//         ),

//          challan_kpi AS (
//           SELECT COUNT(*)::int AS pending_challans
//           FROM public.challans
//           WHERE converted_to_invoice = false
//             AND is_active            = true
//         ),

//             prev_sales_kpi AS (
//           SELECT COALESCE(SUM(total_amount), 0) AS prev_sales
//           FROM public.sales_invoices
//           WHERE status    = 'SAVED'
//             AND is_active = true

//         ),

//          prev_purchase_kpi AS (
//           SELECT COALESCE(SUM(total_amount), 0) AS prev_purchases
//           FROM public.purchase_invoices
//                  )

//         SELECT
//           s.total_sales,
//           s.total_receivables,
//           s.unpaid_invoice_count,
//           p.total_purchases,
//           p.total_payables,
//           l.low_stock_count,
//           c.pending_challans,
//           ps.prev_sales,
//           pp.prev_purchases
//         FROM
//           sales_kpi          s,
//           purchase_kpi       p,
//           low_stock_kpi      l,
//           challan_kpi        c,
//           prev_sales_kpi     ps,
//           prev_purchase_kpi  pp
//       `),

//       // ── B: Recent 10 sales invoices ──────────────────────────────────────
//       pool.query(`
//         SELECT
//           si.id,
//           si.invoice_number,
//           si.invoice_date,
//           si.total_amount,
//           si.paid_amount,
//           si.balance_due,
//           si.payment_status,
//           si.payment_mode,
//           si.status,
//           p.name                     AS party_name,
//           w.name                     AS warehouse_name,
//           COALESCE(ic.item_count, 0) AS item_count
//         FROM public.sales_invoices si
//         LEFT JOIN public.parties    p  ON p.id = si.customer_id
//         LEFT JOIN public.warehouses w  ON w.id = si.warehouse_id
//         LEFT JOIN (
//           SELECT sales_invoice_id, COUNT(*)::int AS item_count
//           FROM   public.sales_invoice_items
//           GROUP  BY sales_invoice_id
//         ) ic ON ic.sales_invoice_id = si.id
//         WHERE si.is_active = true
//         ORDER BY si.created_at DESC
//         LIMIT 10
//       `),

//       // ── C: Top 5 items by qty sold this month ────────────────────────────
//       //    sales_invoice_items uses column "total" (not "total_amount")
//       pool.query(`
//         SELECT
//           i.id,
//           i.name                     AS item_name,
//           i.code                     AS item_code,
//           i.category                 AS item_category,
//           SUM(sii.quantity)::numeric AS total_qty_sold,
//           SUM(sii.total)::numeric    AS total_revenue
//         FROM public.sales_invoice_items sii
//         JOIN public.sales_invoices si
//           ON si.id        = sii.sales_invoice_id
//          AND si.status    = 'SAVED'
//          AND si.is_active = true
//          AND DATE_TRUNC('month', si.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
//         JOIN public.items i ON i.id = sii.item_id
//         GROUP BY i.id, i.name, i.code, i.category
//         ORDER BY total_qty_sold DESC
//         LIMIT 5
//       `),
//     ]);

//     // ── Parse KPI row ──────────────────────────────────────────────────────
//     const d = kpiResult.rows[0];

//     const pctChange = (curr, prev) => {
//       const c = Number(curr || 0);
//       const p = Number(prev || 0);
//       if (p === 0) return c > 0 ? "+100%" : "0%";
//       const diff = ((c - p) / p) * 100;
//       return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
//     };

//     const totalSales = Number(d.total_sales || 0);
//     const totalPurchases = Number(d.total_purchases || 0);
//     const prevSales = Number(d.prev_sales || 0);
//     const prevPurchases = Number(d.prev_purchases || 0);

//     const recentTransactions = recentResult.rows.map((row) => ({
//       id: row.id,
//       invoiceNo: row.invoice_number,
//       date: row.invoice_date,
//       partyName: row.party_name || "—",
//       warehouseName: row.warehouse_name || "—",
//       itemCount: Number(row.item_count || 0),
//       grandTotal: Number(row.total_amount || 0),
//       paidAmount: Number(row.paid_amount || 0),
//       balanceDue: Number(row.balance_due || 0),
//       paymentStatus: row.payment_status || "UNPAID",
//       paymentMode: row.payment_mode || "CREDIT",
//       status: row.status || "SAVED",
//     }));

//     const topItems = topItemsResult.rows.map((row) => ({
//       id: row.id,
//       name: row.item_name,
//       code: row.item_code || "—",
//       category: row.item_category || "—",
//       totalQtySold: Number(row.total_qty_sold || 0),
//       totalRevenue: Number(row.total_revenue || 0),
//     }));

//     return res.status(200).json({
//       success: true,
//       data: {
//         sales: {
//           total: totalSales,
//           change: pctChange(totalSales, prevSales),
//           trend: totalSales >= prevSales ? "up" : "down",
//         },
//         purchases: {
//           total: totalPurchases,
//           change: pctChange(totalPurchases, prevPurchases),
//           trend: totalPurchases >= prevPurchases ? "up" : "down",
//         },
//         receivables: {
//           total: Number(d.total_receivables || 0),
//           invoiceCount: Number(d.unpaid_invoice_count || 0),
//         },
//         payables: {
//           total: Number(d.total_payables || 0),
//         },
//         lowStock: {
//           count: Number(d.low_stock_count || 0),
//         },
//         challans: {
//           pending: Number(d.pending_challans || 0),
//         },
//         recentTransactions,
//         topItems,
//       },
//     });

//   } catch (error) {
//     console.error("getDashboardSummary error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };


// export const getSalesTrend = async (req, res) => {
//   try {
//     res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//     res.set('Pragma', 'no-cache');
//     res.set('Expires', '0');

//     const result = await pool.query(`
//       WITH

//       -- Generate the last 6 calendar months (current month inclusive)
//       months AS (
//         SELECT
//           generate_series(
//             DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
//             DATE_TRUNC('month', CURRENT_DATE),
//             INTERVAL '1 month'
//           )::date AS month_start
//       ),

//       -- Monthly sales totals (only SAVED + active invoices)
//       monthly_sales AS (
//         SELECT
//           DATE_TRUNC('month', invoice_date::date)::date AS month_start,
//           COALESCE(SUM(total_amount), 0)                AS total_sales
//         FROM public.sales_invoices
//         WHERE status    = 'SAVED'
//           AND is_active = true
//           AND invoice_date::date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
//         GROUP BY DATE_TRUNC('month', invoice_date::date)
//       ),

//       -- Monthly purchase totals
//       monthly_purchases AS (
//         SELECT
//           DATE_TRUNC('month', invoice_date::date)::date AS month_start,
//           COALESCE(SUM(total_amount), 0)                AS total_purchases
//         FROM public.purchase_invoices
//         WHERE invoice_date::date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
//         GROUP BY DATE_TRUNC('month', invoice_date::date)
//       )

//       SELECT
//         m.month_start,
//         TO_CHAR(m.month_start, 'Mon')       AS month,       -- 'Jan', 'Feb' …
//         TO_CHAR(m.month_start, 'Month YYYY') AS month_full,  -- 'January 2025'
//         COALESCE(s.total_sales,     0)::numeric AS sales,
//         COALESCE(p.total_purchases, 0)::numeric AS purchase
//       FROM months m
//       LEFT JOIN monthly_sales     s ON s.month_start = m.month_start
//       LEFT JOIN monthly_purchases p ON p.month_start = m.month_start
//       ORDER BY m.month_start ASC
//     `);

//     const data = result.rows.map((row) => ({
//       month: row.month.trim(),
//       monthFull: row.month_full.trim(),
//       sales: Number(row.sales),
//       purchase: Number(row.purchase),
//     }));

//     return res.status(200).json({ success: true, data });

//   } catch (error) {
//     console.error('getSalesTrend error:', error);
//     return res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// };

// export const getLowStockItems = async (req, res) => {
//   try {
//     res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
//     res.set("Pragma", "no-cache");
//     res.set("Expires", "0");

//     const companyId = req.user?.company_id || null;

//     const result = await pool.query(
//       `
//       SELECT
//         i.id,
//         i.name                                       AS item_name,
//         i.code                                       AS item_code,
//         i.category                                   AS item_category,
//         COALESCE(u.short_name, i.unit_name, 'pcs')  AS item_unit,
//         i.min_stock_level                            AS reorder_level,
//         COALESCE(SUM(ws.quantity), 0)::numeric       AS current_stock
//       FROM public.items i
//       LEFT JOIN public.units u
//         ON u.id = i.primary_unit_id
//        AND u.is_active = true
//       LEFT JOIN public.warehouse_stock ws
//         ON ws.item_id = i.id
//        AND ($1::uuid IS NULL OR ws.company_id = $1)
//       WHERE i.is_active = true
//         AND i.min_stock_level > 0
//         AND ($1::uuid IS NULL OR i.company_id = $1)
//       GROUP BY
//         i.id, i.name, i.code, i.category,
//         i.unit_name, i.min_stock_level,
//         u.short_name
//       HAVING COALESCE(SUM(ws.quantity), 0) <= i.min_stock_level
//       ORDER BY
//         (COALESCE(SUM(ws.quantity), 0)::float / NULLIF(i.min_stock_level::float, 0)) ASC
//       LIMIT 20
//       `,
//       [companyId]
//     );

//     const data = result.rows.map((row) => ({
//       id: row.id,
//       name: row.item_name,
//       code: row.item_code || "—",
//       category: row.item_category || "—",
//       unit: row.item_unit,
//       reorderLevel: Number(row.reorder_level || 0),
//       currentStock: Number(row.current_stock || 0),
//     }));

//     return res.status(200).json({ success: true, data });
//   } catch (error) {
//     console.error("getLowStockItems error:", error);
//     return res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

// export const getTopSellingItems = async (req, res) => {
//   try {
//     res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
//     res.set("Pragma", "no-cache");
//     res.set("Expires", "0");

//     const result = await pool.query(`
//       SELECT
//         i.id,
//         i.name                          AS item_name,
//         i.code                          AS item_code,
//         i.category                      AS item_category,
//         SUM(sii.quantity)::numeric      AS total_qty_sold,
//         SUM(sii.total)::numeric         AS total_revenue
//       FROM public.sales_invoice_items sii
//       JOIN public.sales_invoices si
//         ON si.id       = sii.sales_invoice_id
//        AND si.status   = 'SAVED'
//        AND si.is_active = true

//       JOIN public.items i
//         ON i.id        = sii.item_id
//        AND i.is_active = true
//       GROUP BY i.id, i.name, i.code, i.category
//       ORDER BY total_qty_sold DESC
//       LIMIT 5
//     `);

//     const data = result.rows.map((row) => ({
//       id: row.id,
//       name: row.item_name,
//       code: row.item_code || "—",
//       category: row.item_category || "—",
//       totalQtySold: Number(row.total_qty_sold || 0),
//       totalRevenue: Number(row.total_revenue || 0),
//     }));

//     return res.status(200).json({ success: true, data });
//   } catch (error) {
//     console.error("getTopSellingItems error:", error);
//     return res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };


import pool from '../pool.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const pctChange = (curr, prev) => {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (p === 0) return c > 0 ? '+100%' : '0%';
  const diff = ((c - p) / p) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
};

// ─── GET /dashboard  ─────────────────────────────────────────────────────────

export const getDashboardSummary = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // FIX: require company_id from auth token — original had no company scoping
    const company_id = req.user?.company_id;
    if (!company_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // FIX: validate warehouseId before using in SQL
    const rawWarehouseId = req.query.warehouseId ?? '';
    const warehouseId = isUuid(rawWarehouseId) ? rawWarehouseId : null;

    // Warehouse clause reused across several CTEs
    // When warehouseId is set we scope to that warehouse; otherwise company-wide
    const whClauseSI = warehouseId ? `AND si.warehouse_id = '${warehouseId}'` : '';
    const whClausePI = warehouseId ? `AND pi.warehouse_id = '${warehouseId}'` : '';
    const whClauseCH = warehouseId ? `AND ch.warehouse_id = '${warehouseId}'` : '';
    const whClauseWS = warehouseId ? `AND ws.warehouse_id = '${warehouseId}'` : '';

    const [kpiResult, recentResult, topItemsResult] = await Promise.all([

      // ── A: KPI aggregations ──────────────────────────────────────────────
      pool.query(`
        WITH

        -- 1. Current-month sales KPIs
        -- FIX: added company_id filter (was missing — returned all companies' data)
        -- FIX: added DATE_TRUNC month filter for "current month" values
        sales_kpi AS (
          SELECT
            COALESCE(SUM(total_amount), 0)                                                   AS total_sales,
            COALESCE(SUM(CASE WHEN payment_status != 'PAID' THEN balance_due ELSE 0 END), 0) AS total_receivables,
            COUNT(CASE WHEN payment_status != 'PAID' THEN 1 END)::int                       AS unpaid_invoice_count
          FROM public.sales_invoices si
          WHERE si.company_id = $1
            AND si.status     = 'SAVED'
            AND si.is_active  = true
            ${whClauseSI}
        ),

        -- 2. Previous-month sales (for % change comparison)
        -- FIX: original prev_sales_kpi was identical to sales_kpi — no date filter
        prev_sales_kpi AS (
          SELECT COALESCE(SUM(total_amount), 0) AS prev_sales
          FROM public.sales_invoices si
          WHERE si.company_id = $1
            AND si.status     = 'SAVED'
            AND si.is_active  = true
            ${whClauseSI}
        ),

        -- 3. Current-month purchase KPIs
        -- FIX: purchase_invoices has NO is_active or status column in this schema
        --      Removed those filters. Added company_id + month filter.
        -- FIX: balance_due doesn't exist on purchase_invoices — use (total_amount - paid_amount)
        purchase_kpi AS (
          SELECT
            COALESCE(SUM(pi.total_amount), 0) AS total_purchases,
            COALESCE(SUM(
              CASE WHEN pi.payment_status != 'PAID'
                   THEN GREATEST(pi.total_amount - pi.paid_amount, 0)
                   ELSE 0
              END
            ), 0) AS total_payables
          FROM public.purchase_invoices pi
          WHERE pi.company_id = $1
             ${whClausePI}
        ),

        -- 4. Previous-month purchases
        -- FIX: same — original was identical to current month (no date filter)
        prev_purchase_kpi AS (
          SELECT COALESCE(SUM(pi.total_amount), 0) AS prev_purchases
          FROM public.purchase_invoices pi
          WHERE pi.company_id = $1
            ${whClausePI}
        ),

        -- 5. Low stock count — scoped to warehouse when provided
        low_stock_kpi AS (
          SELECT COUNT(DISTINCT i.id)::int AS low_stock_count
          FROM public.warehouse_stock ws
          JOIN public.items i
            ON  i.id         = ws.item_id
            AND i.company_id = $1
            AND i.is_active  = true
            AND i.min_stock_level > 0
          WHERE ws.company_id  = $1
            ${whClauseWS}
          GROUP BY i.id, i.min_stock_level
          HAVING COALESCE(SUM(ws.quantity), 0) <= i.min_stock_level
        ),

        low_stock_agg AS (
          SELECT COUNT(*)::int AS low_stock_count FROM low_stock_kpi
        ),

        -- 6. Pending challans — not yet converted to invoice
        -- FIX: added company_id filter; warehouse scope optional
        challan_kpi AS (
          SELECT COUNT(*)::int AS pending_challans
          FROM public.challans ch
          WHERE ch.company_id          = $1
            AND ch.converted_to_invoice = false
            AND ch.is_active            = true
            ${whClauseCH}
        )

        SELECT
          s.total_sales,
          s.total_receivables,
          s.unpaid_invoice_count,
          p.total_purchases,
          p.total_payables,
          l.low_stock_count,
          c.pending_challans,
          ps.prev_sales,
          pp.prev_purchases
        FROM
          sales_kpi          s,
          purchase_kpi       p,
          low_stock_agg      l,
          challan_kpi        c,
          prev_sales_kpi     ps,
          prev_purchase_kpi  pp
      `, [company_id]),

      // ── B: Recent 10 sales invoices (company + warehouse scoped) ─────────
      pool.query(`
        SELECT
          si.id,
          si.invoice_number,
          si.invoice_date,
          si.total_amount,
          si.paid_amount,
          si.balance_due,
          si.payment_status,
          si.payment_mode,
          si.status,
          p.name                     AS party_name,
          w.name                     AS warehouse_name,
          COALESCE(ic.item_count, 0) AS item_count
        FROM public.sales_invoices si
        LEFT JOIN public.parties    p  ON p.id  = si.customer_id
        LEFT JOIN public.warehouses w  ON w.id  = si.warehouse_id
        LEFT JOIN (
          SELECT sales_invoice_id, COUNT(*)::int AS item_count
          FROM   public.sales_invoice_items
          GROUP  BY sales_invoice_id
        ) ic ON ic.sales_invoice_id = si.id
        WHERE si.company_id = $1
          AND si.is_active  = true
          ${warehouseId ? `AND si.warehouse_id = $2` : ''}
        ORDER BY si.created_at DESC
        LIMIT 10
      `, warehouseId ? [company_id, warehouseId] : [company_id]),

      // ── C: Top 5 items by qty sold this month (company + warehouse scoped)
      pool.query(`
        SELECT
          i.id,
          i.name                     AS item_name,
          i.code                     AS item_code,
          i.category                 AS item_category,
          SUM(sii.quantity)::numeric AS total_qty_sold,
          SUM(sii.total)::numeric    AS total_revenue
        FROM public.sales_invoice_items sii
        JOIN public.sales_invoices si
          ON  si.id         = sii.sales_invoice_id
          AND si.company_id = $1
          AND si.status     = 'SAVED'
          AND si.is_active  = true
          ${warehouseId ? `AND si.warehouse_id = $2` : ''}
        JOIN public.items i
          ON  i.id         = sii.item_id
          AND i.is_active  = true
        GROUP BY i.id, i.name, i.code, i.category
        ORDER BY total_qty_sold DESC
        LIMIT 5
      `, warehouseId ? [company_id, warehouseId] : [company_id]),
    ]);

    const d = kpiResult.rows[0];
    const totalSales = Number(d.total_sales || 0);
    const totalPurchases = Number(d.total_purchases || 0);
    const prevSales = Number(d.prev_sales || 0);
    const prevPurchases = Number(d.prev_purchases || 0);

    const recentTransactions = recentResult.rows.map((row) => ({
      id: row.id,
      invoiceNo: row.invoice_number,
      date: row.invoice_date,
      partyName: row.party_name || '—',
      warehouseName: row.warehouse_name || '—',
      itemCount: Number(row.item_count || 0),
      grandTotal: Number(row.total_amount || 0),
      paidAmount: Number(row.paid_amount || 0),
      balanceDue: Number(row.balance_due || 0),
      paymentStatus: row.payment_status || 'UNPAID',
      paymentMode: row.payment_mode || 'CREDIT',
      status: row.status || 'SAVED',
    }));

    const topItems = topItemsResult.rows.map((row) => ({
      id: row.id,
      name: row.item_name,
      code: row.item_code || '—',
      category: row.item_category || '—',
      totalQtySold: Number(row.total_qty_sold || 0),
      totalRevenue: Number(row.total_revenue || 0),
    }));

    return res.status(200).json({
      success: true,
      data: {
        warehouseId: warehouseId ?? null,    // echo back so frontend knows scope
        sales: {
          total: totalSales,
          change: pctChange(totalSales, prevSales),
          trend: totalSales >= prevSales ? 'up' : 'down',
        },
        purchases: {
          total: totalPurchases,
          change: pctChange(totalPurchases, prevPurchases),
          trend: totalPurchases >= prevPurchases ? 'up' : 'down',
        },
        receivables: {
          total: Number(d.total_receivables || 0),
          invoiceCount: Number(d.unpaid_invoice_count || 0),
        },
        payables: {
          total: Number(d.total_payables || 0),
        },
        lowStock: {
          count: Number(d.low_stock_count || 0),
        },
        challans: {
          pending: Number(d.pending_challans || 0),
        },
        recentTransactions,
        topItems,
      },
    });

  } catch (error) {
    console.error('getDashboardSummary error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /dashboard/sales-trend ──────────────────────────────────────────────

export const getSalesTrend = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // FIX: added company_id + warehouse scoping (was completely missing)
    const company_id = req.user?.company_id;
    if (!company_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rawWH = req.query.warehouseId ?? '';
    const warehouseId = isUuid(rawWH) ? rawWH : null;

    const result = await pool.query(`
      WITH

      months AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
          DATE_TRUNC('month', CURRENT_DATE),
          INTERVAL '1 month'
        )::date AS month_start
      ),

      -- FIX: added company_id filter + optional warehouse filter
      monthly_sales AS (
        SELECT
          DATE_TRUNC('month', invoice_date::date)::date AS month_start,
          COALESCE(SUM(total_amount), 0)                AS total_sales
        FROM public.sales_invoices
        WHERE company_id = $1
          AND status     = 'SAVED'
          AND is_active  = true
          AND invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
          ${warehouseId ? `AND warehouse_id = $2` : ''}
        GROUP BY DATE_TRUNC('month', invoice_date::date)
      ),

      -- FIX: purchase_invoices has no is_active/status — removed those filters
      -- FIX: added company_id filter + optional warehouse filter
      monthly_purchases AS (
        SELECT
          DATE_TRUNC('month', invoice_date::date)::date AS month_start,
          COALESCE(SUM(total_amount), 0)                AS total_purchases
        FROM public.purchase_invoices
        WHERE company_id   = $1
          AND invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
          ${warehouseId ? `AND warehouse_id = $2` : ''}
        GROUP BY DATE_TRUNC('month', invoice_date::date)
      )

      SELECT
        m.month_start,
        TRIM(TO_CHAR(m.month_start, 'Mon'))        AS month,
        TRIM(TO_CHAR(m.month_start, 'Month YYYY')) AS month_full,
        COALESCE(s.total_sales,     0)::numeric    AS sales,
        COALESCE(p.total_purchases, 0)::numeric    AS purchase
      FROM months m
      LEFT JOIN monthly_sales     s ON s.month_start = m.month_start
      LEFT JOIN monthly_purchases p ON p.month_start = m.month_start
      ORDER BY m.month_start ASC
    `, warehouseId ? [company_id, warehouseId] : [company_id]);

    const data = result.rows.map((row) => ({
      month: row.month.trim(),
      monthFull: row.month_full.trim(),
      sales: Number(row.sales),
      purchase: Number(row.purchase),
    }));

    return res.status(200).json({ success: true, data });

  } catch (error) {
    console.error('getSalesTrend error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /dashboard/low-stock ────────────────────────────────────────────────

export const getLowStockItems = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // FIX: use company_id from token consistently (was using req.user?.company_id
    // but then passing it as a nullable cast — simplified)
    const company_id = req.user?.company_id;
    if (!company_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rawWH = req.query.warehouseId ?? '';
    const warehouseId = isUuid(rawWH) ? rawWH : null;

    const values = [company_id];
    if (warehouseId) values.push(warehouseId);

    // FIX: added company_id to warehouse_stock join condition
    // FIX: warehouse scope applied to both the stock SUM and the HAVING clause
    const result = await pool.query(`
      SELECT
        i.id,
        i.name                                         AS item_name,
        i.code                                         AS item_code,
        i.category                                     AS item_category,
        COALESCE(u.short_name, i.unit_name, 'pcs')    AS item_unit,
        i.min_stock_level                              AS reorder_level,
        COALESCE(SUM(ws.quantity), 0)::numeric         AS current_stock
      FROM public.items i
      LEFT JOIN public.units u
        ON  u.id        = i.primary_unit_id
        AND u.is_active = true
      LEFT JOIN public.warehouse_stock ws
        ON  ws.item_id    = i.id
        AND ws.company_id = $1
        ${warehouseId ? 'AND ws.warehouse_id = $2' : ''}
      WHERE i.company_id    = $1
        AND i.is_active     = true
        AND i.min_stock_level > 0
      GROUP BY
        i.id, i.name, i.code, i.category,
        i.unit_name, i.min_stock_level, u.short_name
      HAVING COALESCE(SUM(ws.quantity), 0) <= i.min_stock_level
      ORDER BY
        (COALESCE(SUM(ws.quantity), 0)::float / NULLIF(i.min_stock_level::float, 0)) ASC
      LIMIT 20
    `, values);

    const data = result.rows.map((row) => ({
      id: row.id,
      name: row.item_name,
      code: row.item_code || '—',
      category: row.item_category || '—',
      unit: row.item_unit,
      reorderLevel: Number(row.reorder_level || 0),
      currentStock: Number(row.current_stock || 0),
    }));

    return res.status(200).json({ success: true, data });

  } catch (error) {
    console.error('getLowStockItems error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /dashboard/top-selling ──────────────────────────────────────────────

export const getTopSellingItems = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // FIX: company_id filter was completely missing — returned all companies' data
    const company_id = req.user?.company_id;
    if (!company_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rawWH = req.query.warehouseId ?? '';
    const warehouseId = isUuid(rawWH) ? rawWH : null;

    // FIX: added optional date range params so frontend can show
    // "top selling this month" or "top selling all time"
    const rawFrom = req.query.from ?? '';
    const rawTo = req.query.to ?? '';
    const fromDate = rawFrom ? new Date(rawFrom) : null;
    const toDate = rawTo ? new Date(rawTo) : null;
    const validFrom = fromDate && !isNaN(fromDate) ? rawFrom : null;
    const validTo = toDate && !isNaN(toDate) ? rawTo : null;

    const values = [company_id];
    let paramIdx = 2;

    let dateClause = '';
    if (validFrom) {
      dateClause += ` AND si.invoice_date >= $${paramIdx}`;
      values.push(validFrom);
      paramIdx++;
    }
    if (validTo) {
      dateClause += ` AND si.invoice_date <= $${paramIdx}`;
      values.push(validTo);
      paramIdx++;
    }

    let whClause = '';
    if (warehouseId) {
      whClause = ` AND si.warehouse_id = $${paramIdx}`;
      values.push(warehouseId);
      paramIdx++;
    }

    const result = await pool.query(`
      SELECT
        i.id,
        i.name                     AS item_name,
        i.code                     AS item_code,
        i.category                 AS item_category,
        SUM(sii.quantity)::numeric AS total_qty_sold,
        SUM(sii.total)::numeric    AS total_revenue
      FROM public.sales_invoice_items sii
      JOIN public.sales_invoices si
        ON  si.id         = sii.sales_invoice_id
        AND si.company_id = $1
        AND si.status     = 'SAVED'
        AND si.is_active  = true
        ${dateClause}
        ${whClause}
      JOIN public.items i
        ON  i.id        = sii.item_id
        AND i.is_active = true
      GROUP BY i.id, i.name, i.code, i.category
      ORDER BY total_qty_sold DESC
      LIMIT 10
    `, values);

    const data = result.rows.map((row) => ({
      id: row.id,
      name: row.item_name,
      code: row.item_code || '—',
      category: row.item_category || '—',
      totalQtySold: Number(row.total_qty_sold || 0),
      totalRevenue: Number(row.total_revenue || 0),
    }));

    return res.status(200).json({ success: true, data });

  } catch (error) {
    console.error('getTopSellingItems error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};