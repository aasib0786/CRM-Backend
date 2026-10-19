import { Router } from 'express';
import {
    getPipelineStages, getPipelineStageById, createPipelineStage,
    updatePipelineStage, deletePipelineStage, bulkSavePipelineStages,
    getStageExtraFields, createStageExtraField, updateStageExtraField, deleteStageExtraField,
    getCustomFields, createCustomField, updateCustomField, deleteCustomField, bulkSaveCustomFields,
    getLeadSources, createLeadSource, updateLeadSource, toggleLeadSourceStatus, deleteLeadSource, bulkSaveLeadSources,
    getScoringConfig, saveScoringConfig, recalculateScoringScores,
    getAssignmentConfig, saveAssignmentConfig,
} from './pipeline-config-controller.js';
import {
    getInventoryFields, createInventoryField, updateInventoryField, deleteInventoryField, bulkSaveInventoryFields,
} from './inventory-fields-controller.js';
import jwt from 'jsonwebtoken';

const router = Router();

const optionalAuth = (req, res, next) => {
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
        if (token && token !== "null" && token !== "undefined") {
            if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1);
            const decoded = jwt.decode(token);
            if (decoded) {
                req.user = decoded;
                req.company_id = decoded.company_id || decoded.companyId;
            }
        }
    } catch (e) {}
    next();
};

// ── Pipeline Stages ──────────────────────────────────────────
router.get('/pipeline-stages/get-all', optionalAuth, getPipelineStages);
router.post('/pipeline-stages/create', optionalAuth, createPipelineStage);
router.post('/pipeline-stages/bulk-save', optionalAuth, bulkSavePipelineStages);
router.get('/pipeline-stages/get-by-id/:id', optionalAuth, getPipelineStageById);
router.put('/pipeline-stages/update/:id', optionalAuth, updatePipelineStage);
router.patch('/pipeline-stages/update/:id', optionalAuth, updatePipelineStage);
router.delete('/pipeline-stages/delete/:id', optionalAuth, deletePipelineStage);

// ── Stage Extra Fields ───────────────────────────────────────
router.get('/pipeline-stages/stage-fields/:stageId', optionalAuth, getStageExtraFields);
router.post('/pipeline-stages/stage-fields/:stageId/create', optionalAuth, createStageExtraField);
router.patch('/pipeline-stages/stage-fields/update/:fieldId', optionalAuth, updateStageExtraField);
router.delete('/pipeline-stages/stage-fields/delete/:fieldId', optionalAuth, deleteStageExtraField);

// ── Custom Fields ────────────────────────────────────────────
router.get('/custom-fields/get-all', optionalAuth, getCustomFields);
router.post('/custom-fields/create', optionalAuth, createCustomField);
router.post('/custom-fields/bulk-save', optionalAuth, bulkSaveCustomFields);
router.put('/custom-fields/update/:id', optionalAuth, updateCustomField);
router.patch('/custom-fields/update/:id', optionalAuth, updateCustomField);
router.delete('/custom-fields/delete/:id', optionalAuth, deleteCustomField);

// ── Lead Sources ─────────────────────────────────────────────
router.get('/lead-sources/get-all', optionalAuth, getLeadSources);
router.post('/lead-sources/create', optionalAuth, createLeadSource);
router.post('/lead-sources/bulk-save', optionalAuth, bulkSaveLeadSources);
router.put('/lead-sources/update/:id', optionalAuth, updateLeadSource);
router.patch('/lead-sources/update/:id', optionalAuth, updateLeadSource);
router.patch('/lead-sources/toggle-status/:id', optionalAuth, toggleLeadSourceStatus);
router.delete('/lead-sources/delete/:id', optionalAuth, deleteLeadSource);

// ── Inventory Fields ─────────────────────────────────────────
router.get('/inventory-fields/get-all', optionalAuth, getInventoryFields);
router.post('/inventory-fields/create', optionalAuth, createInventoryField);
router.post('/inventory-fields/bulk-save', optionalAuth, bulkSaveInventoryFields);
router.put('/inventory-fields/update/:id', optionalAuth, updateInventoryField);
router.patch('/inventory-fields/update/:id', optionalAuth, updateInventoryField);
router.delete('/inventory-fields/delete/:id', optionalAuth, deleteInventoryField);

// ── Lead Scoring Config ───────────────────────────────────────
router.get('/scoring', optionalAuth, getScoringConfig);
router.post('/scoring', optionalAuth, saveScoringConfig);
router.post('/scoring/recalculate', optionalAuth, recalculateScoringScores);

// ── Assignment Rules Config ───────────────────────────────────
router.get('/assignment-rules', optionalAuth, getAssignmentConfig);
router.post('/assignment-rules', optionalAuth, saveAssignmentConfig);

export default router;