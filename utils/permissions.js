export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

export const SUPER_ADMIN_PERMISSIONS = {
  // ─── MASTERS ───
  items: { create: true, view: true, edit: true, delete: true },
  users: { create: true, view: true, edit: true, delete: true },
  parties: { create: true, view: true, edit: true, delete: true },
  warehouses: { create: true, view: true, edit: true, delete: true },
  categories: { create: true, view: true, edit: true, delete: true },

  // ─── SALES ───
  sales_invoice: { create: true, view: true, edit: true, delete: true },
  sale_return: { create: true, view: true, edit: true, delete: true },
  challan: { create: true, view: true, edit: true, delete: true },
  sales_payment: { create: true, view: true },

  // ─── PURCHASE ───
  purchase_order: { create: true, view: true, edit: true, delete: true },
  purchase_invoice: { create: true, view: true, edit: true, delete: true },
  purchase_return: { create: true, view: true, edit: true, delete: true },
  purchase_payment: { create: true, view: true },

  // ─── INVENTORY ───
  stock_entries: { create: true, view: true },
  stock_transfer: { create: true, view: true, edit: true, delete: true },
  stock_adjustment: { create: true, view: true },
  stock_receiving: { create: true, view: true },
  grn_history: { view: true },
  gate_pass_outward: { create: true, view: true, edit: true },
  gate_pass_inward: { create: true, view: true, edit: true },

  // ─── REPORTS (granular) ───
  report_stock_summary: { view: true },
  report_stock_ledger: { view: true },
  report_low_stock: { view: true },
  report_purchase_reg: { view: true },
  report_gst_purchase: { view: true },
  report_sales_reg: { view: true },
  report_gst_sales: { view: true },
  report_outstanding: { view: true },
  report_day_book: { view: true },
  report_party_ledger: { view: true },

  // ─── SYSTEM ───
  settings: { view: true, edit: true },
};


export const SUPER_ADMIN_ADDITIONAL_CONTROLS = {
  exportData: true,
  convertChallan: true,
  editLockedRecords: true,
  viewAllWarehouses: true,
  approveStockTransfer: true,
  viewFinancialReports: true,
  manageUserPermissions: true,
  approveStockAdjustment: true,
};


