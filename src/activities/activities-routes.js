import express from 'express';
import { getActivities, createActivity, deleteActivity } from './activities-controller.js';

const router = express.Router();

router.get('/', getActivities);
router.post('/', createActivity);
router.delete('/:id', deleteActivity);

export default router;
