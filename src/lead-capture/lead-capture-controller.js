import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';

// Auto-seed sample forms if database table is empty
const ensureSeedLeadForms = async () => {
  try {
    await connectDB.query(`
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN company DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN company SET DEFAULT '';
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN phone DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN phone SET DEFAULT '';
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN email SET DEFAULT '';
    `);
  } catch (e) {
    // ignore
  }
  const { rows } = await connectDB.query(`SELECT COUNT(*) as count FROM public.lead_capture_forms`);
  if (Number(rows[0]?.count || 0) === 0) {
    const seedForms = [
      {
        title: "Real Estate Site Visit Form",
        description: "Capture interested buyers for luxury apartments and site visits.",
        status: "Active",
        submissions_count: 34,
        redirect_url: "https://example.com/thank-you",
        fields: [
          { id: "1", label: "Full Name", type: "text", required: true, placeholder: "John Doe" },
          { id: "2", label: "Phone Number", type: "tel", required: true, placeholder: "+91 98765 43210" },
          { id: "3", label: "Email Address", type: "email", required: false, placeholder: "john@example.com" },
          { id: "4", label: "Preferred Site Visit Date", type: "date", required: true },
        ],
      },
      {
        title: "General Contact Us Form",
        description: "Embedded on website contact page for inbound inquiries.",
        status: "Active",
        submissions_count: 82,
        redirect_url: "https://example.com/contact-thanks",
        fields: [
          { id: "1", label: "Full Name", type: "text", required: true },
          { id: "2", label: "Email", type: "email", required: true },
          { id: "3", label: "Phone", type: "tel", required: true },
          { id: "4", label: "Message / Requirements", type: "textarea", required: false },
        ],
      },
      {
        title: "Quote Request Form",
        description: "Custom project quotation request form for commercial leads.",
        status: "Active",
        submissions_count: 19,
        redirect_url: "https://example.com/quote-sent",
        fields: [
          { id: "1", label: "Contact Name", type: "text", required: true },
          { id: "2", label: "Company Name", type: "text", required: true },
          { id: "3", label: "Mobile", type: "tel", required: true },
          { id: "4", label: "Budget Range", type: "select", options: ["Below ₹10 Lakhs", "₹10L - ₹50L", "Above ₹50L"] },
        ],
      },
      {
        title: "WhatsApp Quick Inquiry Form",
        description: "Mobile landing page form for instant WhatsApp lead capture.",
        status: "Inactive",
        submissions_count: 7,
        fields: [
          { id: "1", label: "Name", type: "text", required: true },
          { id: "2", label: "WhatsApp Phone", type: "tel", required: true },
        ],
      },
    ];

    for (const f of seedForms) {
      await connectDB.query(
        `INSERT INTO public.lead_capture_forms (title, description, status, submissions_count, fields, redirect_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [f.title, f.description, f.status, f.submissions_count, JSON.stringify(f.fields), f.redirect_url || null]
      );
    }
  }
};

export const getLeadCaptureForms = async (req, res) => {
  try {
    await ensureSeedLeadForms();
    const { rows } = await connectDB.query(`SELECT * FROM public.lead_capture_forms ORDER BY created_at DESC`);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getFormById = async (req, res) => {
  try {
    await ensureSeedLeadForms();
    const { id } = req.params;
    const { rows } = await connectDB.query(`SELECT * FROM public.lead_capture_forms WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Form not found' });
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createLeadCaptureForm = async (req, res) => {
  try {
    const {
      title,
      description,
      fields,
      redirect_url,
      status,
      submit_button_text,
      success_message,
      privacy_policy_checkbox,
      project_id
    } = req.body;
    const { rows } = await connectDB.query(
      `INSERT INTO public.lead_capture_forms (
        title, description, fields, redirect_url, status,
        submit_button_text, success_message, privacy_policy_checkbox, project_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        title || 'New Web Form',
        description || null,
        JSON.stringify(fields || []),
        redirect_url || null,
        status || 'Active',
        submit_button_text || 'Submit Inquiry',
        success_message || "Thank you! We'll contact you shortly.",
        privacy_policy_checkbox !== false,
        project_id || null
      ]
    );

    const created = rows[0];

    await logActivity({
      type: 'lead_form',
      title: 'Lead Form created',
      description: `Created new capture form "${created.title}"`,
      userName: req.user?.name || 'Admin',
      action: 'created web form',
      leadName: created.title,
      detail: `Status: ${created.status} • Fields: ${Array.isArray(fields) ? fields.length : 0}`,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateLeadCaptureForm = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      fields,
      status,
      redirect_url,
      submit_button_text,
      success_message,
      privacy_policy_checkbox,
      project_id
    } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.lead_capture_forms SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        fields = COALESCE($3, fields),
        status = COALESCE($4, status),
        redirect_url = COALESCE($5, redirect_url),
        submit_button_text = COALESCE($6, submit_button_text),
        success_message = COALESCE($7, success_message),
        privacy_policy_checkbox = COALESCE($8, privacy_policy_checkbox),
        project_id = COALESCE($9, project_id)
       WHERE id = $10 RETURNING *`,
      [
        title !== undefined ? title : null,
        description !== undefined ? description : null,
        fields ? JSON.stringify(fields) : null,
        status !== undefined ? status : null,
        redirect_url !== undefined ? redirect_url : null,
        submit_button_text !== undefined ? submit_button_text : null,
        success_message !== undefined ? success_message : null,
        privacy_policy_checkbox !== undefined ? privacy_policy_checkbox : null,
        project_id !== undefined ? project_id : null,
        id
      ]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Form not found' });
    const updated = rows[0];

    await logActivity({
      type: 'lead_form',
      title: 'Lead Form updated',
      description: `Updated capture form "${updated.title}"`,
      userName: req.user?.name || 'Admin',
      action: 'updated web form',
      leadName: updated.title,
      detail: `Status: ${updated.status}`,
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteLeadCaptureForm = async (req, res) => {
  try {
    const { id } = req.params;
    const fRes = await connectDB.query(`SELECT title FROM public.lead_capture_forms WHERE id = $1`, [id]);
    const formTitle = fRes.rows[0]?.title || 'Form';

    await connectDB.query(`DELETE FROM public.lead_capture_forms WHERE id = $1`, [id]);

    await logActivity({
      type: 'lead_form_deleted',
      title: 'Lead Form deleted',
      description: `Deleted capture form "${formTitle}"`,
      userName: req.user?.name || 'Admin',
      action: 'deleted web form',
      leadName: formTitle,
      detail: `Form "${formTitle}" removed`,
    });

    return res.status(200).json({ success: true, message: 'Form deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const submitLeadForm = async (req, res) => {
  try {
    const { form_id, data } = req.body;
    if (!form_id) {
      return res.status(400).json({ success: false, message: 'form_id is required' });
    }

    const formRes = await connectDB.query(`SELECT * FROM public.lead_capture_forms WHERE id = $1`, [form_id]);
    const formRow = formRes.rows.length ? formRes.rows[0] : null;
    const formTitle = formRow ? formRow.title : 'Web Form';

    const submissionData = data || {};

    const { rows } = await connectDB.query(
      `INSERT INTO public.lead_capture_submissions (form_id, form_title, data)
       VALUES ($1, $2, $3) RETURNING *`,
      [form_id, formTitle, JSON.stringify(submissionData)]
    );

    // Smartly extract field values for lead creation
    const findValue = (...keys) => {
      for (const k of keys) {
        if (submissionData[k] !== undefined && submissionData[k] !== null && String(submissionData[k]).trim() !== '') {
          return String(submissionData[k]).trim();
        }
      }
      const flatMap = {};
      for (const [key, val] of Object.entries(submissionData)) {
        const cleaned = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          flatMap[cleaned] = String(val).trim();
        }
      }
      for (const k of keys) {
        const cleaned = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (flatMap[cleaned]) return flatMap[cleaned];
      }
      return null;
    };

    const leadName = findValue('name', 'fullName', 'full_name', 'contactName', 'Full Name', 'Name', 'Contact Name') || 'Web Inquiry Lead';
    const leadEmail = findValue('email', 'email_address', 'Email', 'Email Address') || '';
    const leadPhone = findValue('phone', 'phoneNumber', 'phone_number', 'mobile', 'Phone', 'Phone Number', 'Mobile', 'WhatsApp Phone') || '';
    const leadCompany = findValue('company', 'company_name', 'Company', 'Company Name', 'business', 'organization') || 'Individual';
    const leadNotes = findValue('message', 'requirements', 'notes', 'comments', 'inquiry', 'Message', 'Notes', 'Requirements') || '';

    // Safety check: ensure company column is not blocking
    await connectDB.query(`
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN company DROP NOT NULL;
      ALTER TABLE IF EXISTS public.leads ALTER COLUMN company SET DEFAULT '';
    `).catch(() => {});

    // Try rich lead insert with full details
    try {
      await connectDB.query(
        `INSERT INTO public.leads (
          name, email, phone, company, source, stage, priority, notes, custom_fields, extra_fields, project_id, score, last_activity, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), NOW())`,
        [
          leadName,
          leadEmail,
          leadPhone,
          leadCompany,
          `Web Form: ${formTitle}`,
          'New Inquiry',
          'High',
          leadNotes || null,
          JSON.stringify(submissionData),
          JSON.stringify(submissionData),
          formRow?.project_id ? String(formRow.project_id) : null,
          leadEmail && leadPhone ? 80 : 65
        ]
      );
    } catch (insertErr) {
      console.warn('Rich lead insert fallback:', insertErr.message);
      // Fallback standard insert ensuring company is always a non-null string
      await connectDB.query(
        `INSERT INTO public.leads (name, email, phone, company, source, stage)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leadName, leadEmail, leadPhone, leadCompany, `Web Form: ${formTitle}`, 'New Inquiry']
      );
    }

    // Increment submissions_count
    await connectDB.query(
      `UPDATE public.lead_capture_forms SET submissions_count = submissions_count + 1 WHERE id = $1`,
      [form_id]
    );

    await logActivity({
      type: 'lead_captured',
      title: 'New Lead Captured via Web Form',
      description: `New lead "${leadName}" submitted via ${formTitle}`,
      userName: 'Web Visitor',
      action: 'submitted web form',
      leadName: leadName,
      detail: `Form: ${formTitle} • Phone: ${leadPhone || 'N/A'} • Email: ${leadEmail || 'N/A'}${leadCompany && leadCompany !== 'Individual' ? ` • Company: ${leadCompany}` : ''}`,
    });

    return res.status(201).json({
      success: true,
      data: rows[0],
      message: formRow?.success_message || "Thank you! We'll contact you shortly.",
      redirect_url: formRow?.redirect_url || null,
    });
  } catch (err) {
    console.error('submitLeadForm error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getSubmissionsByFormId = async (req, res) => {
  try {
    const { formId } = req.params;
    const { rows } = await connectDB.query(
      `SELECT * FROM public.lead_capture_submissions WHERE form_id = $1 ORDER BY created_at DESC`,
      [formId]
    );
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
