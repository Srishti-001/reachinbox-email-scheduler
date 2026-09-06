import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { requireAuth } from '../middleware/requireAuth';
import { query } from '../config/db';
import { EmailJob, PaginatedResponse, User } from '../types';
import { scheduleCampaignSchema, createCampaign } from '../services/campaignService';
import { searchEmailLogs } from '../services/esIndexer';

const getUser = (req: Request) => req.user as User;

const router = Router();
router.use(requireAuth);

// Multer for CSV uploads on /parse-csv
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

// Helper: build paginated response metadata
function buildPagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emails/schedule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience alias for POST /api/campaigns.
 * Accepts the exact same JSON body shape and delegates to campaignService.
 *
 * This endpoint is useful when posting from clients that prefer a flat
 * /emails namespace over /campaigns.
 */
router.post('/schedule', async (req: Request, res: Response, next: NextFunction) => {
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
      message: `${result.totalQueued} email(s) scheduled${
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emails/parse-csv
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accepts a multipart CSV upload (field name: "leads").
 * Parses, validates, and deduplicates email rows.
 * Returns the clean list + flagged invalid rows.
 *
 * Expected columns (case-insensitive): email (required), name (optional)
 */
router.post(
  '/parse-csv',
  upload.single('leads'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No CSV file uploaded (field name: leads)' });
        return;
      }

      const csvText = req.file.buffer.toString('utf-8');
      const parsed = Papa.parse<Record<string, string>>(csvText, {
        header:         true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen       = new Set<string>();
      const valid:   Array<{ email: string; name?: string }> = [];
      const invalid: Array<{ row: number; value: string; reason: string }> = [];

      parsed.data.forEach((row, idx) => {
        const raw   = row['email']?.trim() ?? '';
        const email = raw.toLowerCase();

        if (!email) {
          invalid.push({ row: idx + 2, value: raw, reason: 'missing email column' });
          return;
        }
        if (!emailRegex.test(email)) {
          invalid.push({ row: idx + 2, value: raw, reason: 'invalid email format' });
          return;
        }
        if (seen.has(email)) {
          // silently deduplicate — not flagged as invalid
          return;
        }
        seen.add(email);
        valid.push({ email, name: row['name']?.trim() || undefined });
      });

      res.json({
        success: true,
        data: {
          count:   valid.length,
          leads:   valid,
          invalid: invalid.slice(0, 50), // cap to avoid huge payloads
          parseErrors: parsed.errors.map(e => e.message),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emails/scheduled
// ─────────────────────────────────────────────────────────────────────────────

router.get('/scheduled', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page       = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit      = Math.min(100, parseInt(String(req.query.limit ?? '20'), 10));
    const offset     = (page - 1) * limit;
    const campaignId = req.query.campaignId as string | undefined;

    const baseParams: any[] = [getUser(req).id];
    let campaignFilter = '';
    if (campaignId) {
      baseParams.push(campaignId);
      campaignFilter = `AND ej.campaign_id = $${baseParams.length}`;
    }

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)
       FROM email_jobs ej
       JOIN campaigns c ON ej.campaign_id = c.id
       WHERE c.user_id = $1 ${campaignFilter}
         AND ej.status IN ('scheduled','queued','rate_limited','sending')`,
      baseParams
    );

    const dataParams = [...baseParams, limit, offset];
    const dataResult = await query<EmailJob & { subject: string }>(
      `SELECT ej.*, c.subject
       FROM email_jobs ej
       JOIN campaigns c ON ej.campaign_id = c.id
       WHERE c.user_id = $1 ${campaignFilter}
         AND ej.status IN ('scheduled','queued','rate_limited','sending')
       ORDER BY ej.scheduled_at ASC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    const response: PaginatedResponse<EmailJob & { subject: string }> = {
      success: true,
      data:    dataResult.rows,
      ...buildPagination(page, limit, total),
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emails/sent
// ─────────────────────────────────────────────────────────────────────────────

router.get('/sent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page       = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit      = Math.min(100, parseInt(String(req.query.limit ?? '20'), 10));
    const offset     = (page - 1) * limit;
    const campaignId = req.query.campaignId as string | undefined;

    const baseParams: any[] = [getUser(req).id];
    let campaignFilter = '';
    if (campaignId) {
      baseParams.push(campaignId);
      campaignFilter = `AND ej.campaign_id = $${baseParams.length}`;
    }

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)
       FROM email_jobs ej
       JOIN campaigns c ON ej.campaign_id = c.id
       WHERE c.user_id = $1 ${campaignFilter}
         AND ej.status IN ('sent','failed')`,
      baseParams
    );

    const dataParams = [...baseParams, limit, offset];
    const dataResult = await query<EmailJob & { subject: string }>(
      `SELECT ej.*, c.subject
       FROM email_jobs ej
       JOIN campaigns c ON ej.campaign_id = c.id
       WHERE c.user_id = $1 ${campaignFilter}
         AND ej.status IN ('sent','failed')
       ORDER BY ej.sent_at DESC NULLS LAST
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    const response: PaginatedResponse<EmailJob & { subject: string }> = {
      success: true,
      data:    dataResult.rows,
      ...buildPagination(page, limit, total),
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// GET /api/emails/search
// ───────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/emails/search?q=hello&page=1&limit=20
 *
 * Full-text search across subject, recipientEmail, recipientName, body, status.
 * Results are scoped to the authenticated user's campaigns.
 * Backed by Elasticsearch — if ES is unavailable, returns an empty result set
 * (never crashes the API).
 *
 * Query params:
 *   q       string  (required) — search term
 *   page    number  (default 1)
 *   limit   number  (default 20, max 100)
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q     = String(req.query.q ?? '').trim();
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit = Math.min(100, parseInt(String(req.query.limit ?? '20'), 10));
    const from  = (page - 1) * limit;

    if (!q) {
      res.status(400).json({ success: false, error: 'Query parameter “q” is required' });
      return;
    }

    const result = await searchEmailLogs(getUser(req).id, q, from, limit);

    res.json({
      success:    true,
      data:       result.hits,
      total:      result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
