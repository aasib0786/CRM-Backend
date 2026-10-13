import express from 'express';
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  linkLeadToInventoryItem,
  getProjectTasks,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  getProjectDocuments,
  addProjectDocument,
  deleteProjectDocument,
  linkLeadToProject,
  unlinkLeadFromProject,
  getSellingTypes,
  saveSellingTypes,
  deleteSellingType,
  getInventoryFields,
  saveInventoryFields,
  deleteInventoryField,
} from './projects-controller.js';

const router = express.Router();

// Selling Types settings routes
router.get('/settings/selling-types', getSellingTypes);
router.post('/settings/selling-types', saveSellingTypes);
router.delete('/settings/selling-types/:id', deleteSellingType);

// Inventory Fields settings routes
router.get('/settings/inventory-fields', getInventoryFields);
router.post('/settings/inventory-fields', saveInventoryFields);
router.delete('/settings/inventory-fields/:id', deleteInventoryField);

// Projects routes
router.get('/', getProjects);
router.post('/', createProject);
router.get('/:id', getProjectById);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

// Inventory items routes
router.get('/:id/inventory', getInventoryItems);
router.post('/:id/inventory', createInventoryItem);
router.put('/:id/inventory/:itemId', updateInventoryItem);
router.delete('/:id/inventory/:itemId', deleteInventoryItem);
router.post('/:id/inventory/:itemId/link-lead', linkLeadToInventoryItem);

// Tasks routes
router.get('/:id/tasks', getProjectTasks);
router.post('/:id/tasks', createProjectTask);
router.put('/:id/tasks/:taskId', updateProjectTask);
router.patch('/:id/tasks/:taskId', updateProjectTask);
router.delete('/:id/tasks/:taskId', deleteProjectTask);
router.put('/tasks/:taskId', updateProjectTask);
router.delete('/tasks/:taskId', deleteProjectTask);

// Documents routes
router.get('/:id/documents', getProjectDocuments);
router.post('/:id/documents', addProjectDocument);
router.delete('/:id/documents/:docId', deleteProjectDocument);

// Lead Linking routes
router.post('/:id/leads/link', linkLeadToProject);
router.post('/:id/leads', linkLeadToProject);
router.delete('/:id/leads/:leadId/unlink', unlinkLeadFromProject);
router.delete('/:id/leads/:leadId', unlinkLeadFromProject);

export default router;
