import pool from "../../pool.js";


import fs from "fs";
import path from "path";


export const createCompany = async (req, res) => {
  console.log("BODY:", req.body);
  try {
    const company_id = req.user?.company_id || req.user?.id;

    if (!company_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      name = null,
      address = null,
      gstin = null,
      pan = null,
      stateCode = null,
      financialYearStart = null,
      invoice_prefix = "INV",
      phone = null,
      email = null,
      bank_name = null,
      bank_account = null,
      bank_ifsc = null,
      website = null,
      logoPreview = null
    } = req.body;

    // ✅ Required validation
    if (!name || !stateCode || !financialYearStart) {
      return res.status(400).json({
        message: "Name, State and Financial Year Start are required"
      });
    }

    // ✅ Check existing
    const existing = await pool.query(
      `SELECT id FROM companies WHERE id = $1`,
      [company_id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        message: "Company already exists. Use update API."
      });
    }

    // ✅ Logo handling
    let logo_url = logoPreview;

    if (req.file) {
      logo_url = `/uploads/company/${req.file.filename}`;
    }

    const result = await pool.query(
      `INSERT INTO companies (
        id,
        name,
        address,
        gstin,
        pan,
        state_code,
        logo_url,
        financial_year_start,
        invoice_prefix,
        phone,
        email,
        bank_name,
        bank_account,
        bank_ifsc,
        website
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      RETURNING *`,
      [
        company_id,
        name,
        address,
        gstin,
        pan,
        stateCode,
        logo_url,
        financialYearStart,
        invoice_prefix,
        phone,
        email,
        bank_name,
        bank_account,
        bank_ifsc,
        website
      ]
    );

    return res.status(201).json({
      message: "Company profile created successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Create Company Profile Error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// ✅ UPDATE COMPANY PROFILE
export const updateCompany = async (req, res) => {
  try {
    const company_id = req.user?.company_id || req.user?.id;

    if (!company_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      name = null,
      address = null,
      gstin = null,
      pan = null,
      stateCode = null,
      financialYearStart = null,
      invoice_prefix = null,
      phone = null,
      email = null,
      bank_name = null,
      bank_account = null,
      bank_ifsc = null,
      website = null,
      logoPreview = null
    } = req.body;

    // ✅ Check existing company
    const existingRes = await pool.query(
      `SELECT * FROM companies WHERE id = $1`,
      [company_id]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        message: "Company profile not found"
      });
    }

    const existing = existingRes.rows[0];

    // ✅ Handle logo
    let logo_url = existing.logo_url;

    if (req.file) {
      // 🔹 Delete old logo (if exists)
      if (logo_url) {
        const oldPath = path.join(
          process.cwd(),
          logo_url.replace(/^\/+/, "")
        );

        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      // 🔹 Save new file
      logo_url = `/uploads/company/${req.file.filename}`;
    } else if (logoPreview) {
      // 🔹 Use frontend preview if provided
      logo_url = logoPreview;
    }

    // ✅ Update query with COALESCE (partial updates)
    const result = await pool.query(
      `UPDATE companies SET
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        gstin = COALESCE($3, gstin),
        pan = COALESCE($4, pan),
        state_code = COALESCE($5, state_code),
        logo_url = $6,
        financial_year_start = COALESCE($7, financial_year_start),
        invoice_prefix = COALESCE($8, invoice_prefix),
        phone = COALESCE($9, phone),
        email = COALESCE($10, email),
        bank_name = COALESCE($11, bank_name),
        bank_account = COALESCE($12, bank_account),
        bank_ifsc = COALESCE($13, bank_ifsc),
        website = COALESCE($14, website),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *`,
      [
        name,
        address,
        gstin,
        pan,
        stateCode,            // ✅ mapped
        logo_url,             // ✅ always updated
        financialYearStart,
        invoice_prefix,
        phone,
        email,
        bank_name,
        bank_account,
        bank_ifsc,
        website,
        company_id
      ]
    );

    return res.status(200).json({
      message: "Company profile updated successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Update Company Profile Error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};




// ─────────────────────────────────────────────
// GET ALL COMPANIES FOR OWNER
// ─────────────────────────────────────────────
export const getAllCompanies = async (req, res) => {
  try {
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id;
    const isSuperAdmin = req.role === 'superadmin' || req.user?.role === 'superadmin' || req.role === 'SUPER_ADMIN';

    let query = `SELECT * FROM companies`;
    const params = [];

    if (!isSuperAdmin) {
      if (!companyId) {
        return res.json({ success: true, data: [] });
      }
      query += ` WHERE id = $1`;
      params.push(companyId);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error("Get Companies Error:", err);
    res.status(500).json({ success: false });
  }
};



// ─────────────────────────────────────────────
// GET SINGLE COMPANY
// ─────────────────────────────────────────────
export const getCompanyById = async (req, res) => {
  try {
    const id = req.user?.company_id || req.user?.companyId || req.company_id;
    if (!id) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "Company profile not found"
      });
    }

    const result = await pool.query(
      `SELECT * FROM companies WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "Company profile not created yet"
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    console.error("Get Company Error:", err);
    res.status(500).json({ success: false });
  }
};



// ─────────────────────────────────────────────
// DELETE COMPANY
// ─────────────────────────────────────────────
export const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id || req.user?.companyId || req.company_id;
    const isSuperAdmin = req.role === 'superadmin' || req.user?.role === 'superadmin' || req.role === 'SUPER_ADMIN';

    if (!isSuperAdmin && String(id) !== String(companyId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: You cannot delete another company profile' });
    }

    const result = await pool.query(
      `DELETE FROM companies WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company not found"
      });
    }

    res.json({
      success: true,
      message: "Company deleted successfully"
    });

  } catch (err) {
    console.error("Delete Company Error:", err);
    res.status(500).json({ success: false });
  }
};
