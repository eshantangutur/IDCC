import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enumValue, optionalString } from '../utils/validate.js';
import { FORMAT_IDS } from '../services/formats.js';

export function createProgressRouter({ progressService }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const format = req.query.format ? enumValue(String(req.query.format), FORMAT_IDS, 'format') : null;
    const skill = optionalString(req.query.skill, 'Skill', { max: 60 });
    const from = optionalString(req.query.from, 'From date', { max: 40 });
    const to = optionalString(req.query.to, 'To date', { max: 40 });

    const progress = await progressService.getProgress(req.user.id, { format, from, to, skill });
    res.json(progress);
  });

  return router;
}
