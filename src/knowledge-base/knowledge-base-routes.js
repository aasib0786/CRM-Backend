/**
 * Knowledge Base Express Router (Phase 2)
 * Supports /api/v1/kb and backward-compatible /api/v1/knowledge-base
 */

import express from 'express';
import multer from 'multer';
import {
  // Categories
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,

  // Articles
  getArticles,
  getArticleById,
  createArticle,
  updateArticle,
  deleteArticle,

  // Import / Export
  bulkImportArticles,
  exportArticles,
  getSampleCsv,

  // Project Sync
  syncProjectsToArticles,

  // Search
  searchArticlesEndpoint,

  // Unanswered
  getUnansweredQuestions,
  updateUnansweredStatus,
  createArticleFromUnanswered,

  // Usage
  recordUsageEndpoint,
} from './knowledge-base-controller.js';
import { verifyToken } from '../../middlewares/verifyToken.middleware.js';

const router = express.Router();

router.use(verifyToken);

// Memory storage for CSV file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
});

// ============================================================================
// Categories Routes
// ============================================================================
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/reorder', reorderCategories);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// ============================================================================
// Import, Export & Search
// ============================================================================
router.get('/articles/sample-csv', getSampleCsv);
router.get('/articles/export', exportArticles);
router.post('/articles/bulk-import', upload.single('file'), bulkImportArticles);
router.post('/articles/record-usage', recordUsageEndpoint);
router.get('/search', searchArticlesEndpoint);
router.post('/sync-projects', syncProjectsToArticles);

// ============================================================================
// Unanswered Questions Routes
// ============================================================================
router.get('/unanswered', getUnansweredQuestions);
router.put('/unanswered/:id/status', updateUnansweredStatus);
router.post('/unanswered/:id/create-article', createArticleFromUnanswered);

// ============================================================================
// Articles CRUD Routes
// ============================================================================
router.get('/articles', getArticles);
router.post('/articles', createArticle);
router.get('/articles/:id', getArticleById);
router.put('/articles/:id', updateArticle);
router.delete('/articles/:id', deleteArticle);

// ============================================================================
// Root Aliases for backward compatibility
// ============================================================================
router.get('/', getArticles);
router.post('/', createArticle);
router.get('/:id', getArticleById);
router.put('/:id', updateArticle);
router.patch('/:id', updateArticle);
router.delete('/:id', deleteArticle);

export default router;
