import express from 'express';
import { getCampaigns, getCampaignById, createCampaign, updateCampaign, deleteCampaign, sendAgainCampaign } from './campaigns-controller.js';

const router = express.Router();

router.get('/', getCampaigns);
router.get('/:id', getCampaignById);
router.post('/', createCampaign);
router.put('/:id', updateCampaign);
router.patch('/:id', updateCampaign);
router.post('/:id/send-again', sendAgainCampaign);
router.delete('/:id', deleteCampaign);

export default router;
