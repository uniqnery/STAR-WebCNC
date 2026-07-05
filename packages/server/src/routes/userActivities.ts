import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { listUserActivityHistory, UserActivityPage } from '../lib/userActivityHistory';

const router = Router();

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId, page, limit } = req.query as Record<string, string>;
    if (!machineId || !page || !['control', 'scheduler'].includes(page)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'machineId and page are required' },
      });
    }

    const items = await listUserActivityHistory(machineId, page as UserActivityPage, Number(limit ?? 100));
    return res.json({ success: true, data: { items } });
  } catch (err) {
    next(err);
  }
});

export default router;