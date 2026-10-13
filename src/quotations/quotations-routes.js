import express from 'express';
import {
  getQuotations,
  getQuotationStats,
  getQuotationById,
  createQuotation,
  updateQuotation,
  updateQuotationStatus,
  deleteQuotation,
  getQuotationTemplates,
  createQuotationTemplate,
  updateQuotationTemplate,
  deleteQuotationTemplate,
  sendQuotationEmail
} from './quotations-controller.js';

const router = express.Router();

// Specific routes before param routes
router.get('/stats', getQuotationStats);
router.post('/send-email', sendQuotationEmail);

// Templates routes
router.get('/templates', getQuotationTemplates);
router.post('/templates', createQuotationTemplate);
router.put('/templates/:id', updateQuotationTemplate);
router.delete('/templates/:id', deleteQuotationTemplate);

// Quotations collection routes
router.get('/', getQuotations);
router.post('/', createQuotation);

// Single quotation routes
router.get('/:id', getQuotationById);
router.put('/:id', updateQuotation);
router.patch('/:id/status', updateQuotationStatus);
router.delete('/:id', deleteQuotation);
router.post('/:id/send-email', sendQuotationEmail);

export default router;
