import express from 'express';
import { getTeams, createTeam, deleteTeam } from './teams-controller.js';

const router = express.Router();

router.get('/', getTeams);
router.post('/', createTeam);
router.delete('/:id', deleteTeam);

export default router;
