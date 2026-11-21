import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function createSessionRouter({ sessions }) {
  const router = Router();
  router.post('/', requireAuth, (req, res) => {
    const session = sessions.create({ host: req.user });
    res.status(201).json(sessions.toHostView(session));
  });
  return router;
}
