import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { requireAuth } from '../middleware/requireAuth';
import { Lead } from '../types';

const router = Router();

// Store uploaded files in memory (max 10 MB)
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

router.use(requireAuth);

/**
 * POST /api/upload/csv
 * Accepts a CSV file (field name: "leads").
 * Parses and deduplicates valid email addresses.
 * Returns: { count, preview (first 10 rows) }
 *
 * Expected columns (case-insensitive): email (required), name (optional)
 */
router.post(
  '/csv',
  upload.single('leads'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No CSV file uploaded (field name: leads)' });
        return;
      }

      const csvText = req.file.buffer.toString('utf-8');

      const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });

      if (parsed.errors.length > 0) {
        res.status(400).json({
          success: false,
          error: 'CSV parse errors detected',
          details: parsed.errors.slice(0, 5).map((e) => e.message),
        });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen = new Set<string>();
      const leads: Lead[] = [];

      for (const row of parsed.data) {
        const email = row['email']?.trim().toLowerCase();
        if (!email || !emailRegex.test(email)) continue;
        if (seen.has(email)) continue;
        seen.add(email);
        leads.push({
          email,
          name: row['name']?.trim() || undefined,
        });
      }

      res.json({
        success: true,
        data: {
          count:   leads.length,
          preview: leads.slice(0, 10),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

