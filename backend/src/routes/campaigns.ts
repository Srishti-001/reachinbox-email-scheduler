import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { query } from '../config/db';
import { Campaign, User } from '../types';
import { scheduleCampaignSchema, createCampaign } from '../services/campaignService';

const getUser = (req: Request) => req.user as User;

const router = Router();
router.use(requireAuth);

/** GET /api/campaigns — list campaigns for the current user */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query<Campaign>(
      `SELECT id, subject, status, total_recipients, scheduled_start, created_at
       FROM campaigns
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [getUser(req).id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

/** GET /api/campaigns/:id — get a single campaign with per-status counts */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaignResult = await query<Campaign>(
      'SELECT * FROM campaigns WHERE id = $1 AND user_id = $2',
      [req.params.id, getUser(req).id]
    );

    if (campaignResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }

    const statsResult = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count
       FROM email_jobs
       WHERE campaign_id = $1
       GROUP BY status`,
      [req.params.id]
    );

    const stats = statsResult.rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = parseInt(row.count, 10);
      return acc;
    }, {});

    res.json({
      success: true,
      data: { ...campaignResult.rows[0], stats },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/campaigns — create and schedule an email campaign.
 *
 * Body (JSON):
 *   senderAccountId  string (UUID)
 *   subject          string
 *   body             string
 *   recipients       Array<{ email: string; name?: string }>
 *   scheduledStart   ISO-8601 datetime string
 *   delayBetweenMs   number (ms between sends, default 1000)
 *   hourlyLimit      number (max emails/hour per sender, default 50)
 *
 * Guarantees:
 *   - Input validated with Zod
 *   - Duplicates within the recipients array are silently deduplicated
 *   - Postgres UNIQUE(campaign_id, recipient_email) prevents DB duplicates
 *   - Deterministic BullMQ job IDs prevent queue duplicates on re-run
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = scheduleCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await createCampaign(getUser(req).id, parsed.data);

    res.status(201).json({
      success: true,
      data: result,
      message: `Campaign created — ${result.totalQueued} email(s) scheduled${
        result.skipped > 0 ? `, ${result.skipped} duplicate(s) skipped` : ''
      }`,
    });
  } catch (err: any) {
    if (err.status) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
