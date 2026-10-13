import express from 'express';
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

router.get('/forms', getLeadCaptureForms);
router.get('/forms/:id', getFormById);
router.post('/forms', createLeadCaptureForm);
router.put('/forms/:id', updateLeadCaptureForm);
router.patch('/forms/:id', updateLeadCaptureForm);
router.delete('/forms/:id', deleteLeadCaptureForm);

router.post('/submit', submitLeadForm);
router.get('/forms/:formId/submissions', getSubmissionsByFormId);

export default router;
