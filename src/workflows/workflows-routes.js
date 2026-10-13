import express from 'express';
import {
  getWorkflows,
  getWorkflowTemplates,
  createWorkflowFromTemplate,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  toggleWorkflow,
  deleteWorkflow,
  triggerWorkflowManual,
  getWorkflowRuns,
  getWorkflowRunDetails,
  cancelWorkflowRun,
  getLeadWorkflowRuns,
  runDryRunSimulation,
} from './workflows-controller.js';

const router = express.Router();

// 1. Dry run simulation
router.post('/dry-run', runDryRunSimulation);

// 2. Template routes
router.get('/templates', getWorkflowTemplates);
router.post('/from-template', createWorkflowFromTemplate);

// 2. Lead-specific workflow history
router.get('/lead/:leadId', getLeadWorkflowRuns);

// 3. Runs & execution history
router.get('/runs/:runId', getWorkflowRunDetails);
router.post('/runs/:runId/cancel', cancelWorkflowRun);

// 4. Single workflow operations
router.get('/:id/runs', getWorkflowRuns);
router.post('/:id/trigger', triggerWorkflowManual);
router.patch('/:id/toggle', toggleWorkflow);
router.get('/:id', getWorkflowById);
router.put('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);

// 5. Workflow list & creation
router.get('/', getWorkflows);
router.post('/', createWorkflow);

export default router;
