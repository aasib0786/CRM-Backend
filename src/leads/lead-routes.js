import { Router } from 'express';
import {
    getLeads,
    getLeadsStats,
    getLeadById,
    createLead,
    updateLead,
    deleteLead,
    bulkDeleteLeads,
    bulkAssignLeads,
    bulkChangeStage,
    autoAssignLeads,
    reassignAgentLeads,
    addLeadActivity,
    dismissLeadReminder,
} from './lead-controller.js';
import jwt from 'jsonwebtoken';

const router = Router();

const optionalAuth = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        let token = null;
        if (authHeader?.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1]?.trim();
        } else if (req.cookies?.token) {
            token = req.cookies.token;
        } else if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        }
        if (token && token !== "null" && token !== "undefined") {
            const decoded = jwt.decode(token);
            if (decoded) req.user = decoded;
        }
    } catch (e) {}
    next();
};

// ── Stats ──────────────────────────────────────────────────────
router.get('/stats', optionalAuth, getLeadsStats);

// ── Bulk actions (before /:id to avoid conflict) ───────────────
router.delete('/bulk', optionalAuth, bulkDeleteLeads);
router.patch('/bulk/assign', optionalAuth, bulkAssignLeads);
router.patch('/bulk/stage', optionalAuth, bulkChangeStage);
router.patch('/auto-assign', optionalAuth, autoAssignLeads);
router.patch('/reassign-agent', optionalAuth, reassignAgentLeads);

// ── CRUD ───────────────────────────────────────────────────────
router.get('/', optionalAuth, getLeads);
router.post('/', optionalAuth, createLead);
router.get('/:id', optionalAuth, getLeadById);
router.patch('/:id', optionalAuth, updateLead);
router.delete('/:id', optionalAuth, deleteLead);
router.patch('/:id/dismiss-reminder', optionalAuth, dismissLeadReminder);
router.post('/:id/activities', optionalAuth, addLeadActivity);

export default router;