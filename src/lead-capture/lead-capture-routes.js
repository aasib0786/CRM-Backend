import express from 'express';
import jwt from 'jsonwebtoken';
import connectDB from '../pool.js';
import {
  getLeadCaptureForms,
  getFormById,
  createLeadCaptureForm,
  updateLeadCaptureForm,
  deleteLeadCaptureForm,
  submitLeadForm,
  getSubmissionsByFormId
} from './lead-capture-controller.js';

const router = express.Router();

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    } else if (req.cookies?.token) {
      token = req.cookies.token?.trim();
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken?.trim();
    }

    if (token) {
      if (token.startsWith('"') && token.endsWith('"')) {
        token = token.slice(1, -1);
      }
      const secret = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || 'abcd1234sjkynqoinkerhkaw';
      const decoded = jwt.verify(token, secret);
      req.user = decoded;
      req.role = decoded.role;
      req.company_id = decoded.company_id || decoded.companyId;

      if (!req.company_id && (decoded.id || decoded.email)) {
        const uRes = await connectDB.query(
          "SELECT company_id, role FROM public.users WHERE id::text = $1 OR LOWER(email) = LOWER($2) LIMIT 1",
          [String(decoded.id || ''), String(decoded.email || '').trim()]
        );
        if (uRes.rows.length > 0 && uRes.rows[0].company_id) {
          req.company_id = uRes.rows[0].company_id;
          req.user.company_id = uRes.rows[0].company_id;
          req.user.companyId = uRes.rows[0].company_id;
        }
      }
    }
  } catch (err) {
    // Continue for public embed forms
  }
  next();
};

router.use(optionalAuth);

router.get('/forms', getLeadCaptureForms);
router.get('/forms/:id', getFormById);
router.post('/forms', createLeadCaptureForm);
router.put('/forms/:id', updateLeadCaptureForm);
router.patch('/forms/:id', updateLeadCaptureForm);
router.delete('/forms/:id', deleteLeadCaptureForm);

router.post('/submit', submitLeadForm);
router.get('/forms/:formId/submissions', getSubmissionsByFormId);

export default router;
