import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { query } from '../config/db';
import { createEtherealAccount } from '../services/mailerService';
import { SenderAccount, User } from '../types';

const getUser = (req: Request) => req.user as User;

const router = Router();
router.use(requireAuth);

/** GET /api/senders — list all sender accounts for the current user */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query<Omit<SenderAccount, 'smtp_pass'>>(
      `SELECT id, display_name, email, smtp_host, smtp_port, created_at
       FROM sender_accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [getUser(req).id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

/** POST /api/senders — create a new sender account */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { displayName, email, smtpHost, smtpPort, smtpUser, smtpPass } = req.body as {
      displayName: string;
      email: string;
      smtpHost: string;
      smtpPort: number;
      smtpUser: string;
      smtpPass: string;
    };

    if (!displayName || !email || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      res.status(400).json({ success: false, error: 'All sender fields are required' });
      return;
    }

    const result = await query<{ id: string }>(
      `INSERT INTO sender_accounts (user_id, display_name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [getUser(req).id, displayName, email, smtpHost, Number(smtpPort), smtpUser, smtpPass]
    );

    res.status(201).json({ success: true, data: { id: result.rows[0].id } });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(400).json({ success: false, error: 'A sender with this email already exists' });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/senders/ethereal — auto-generates a fresh Ethereal SMTP test
 * account and immediately creates a sender_account row for the current user.
 *
 * No body required. Optionally pass { displayName: "..." } to customise the label.
 * Emails sent through this sender are visible at https://ethereal.email
 */
router.post('/ethereal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const displayName: string = (req.body?.displayName as string) || 'Ethereal Test Sender';

    // Calls Ethereal's API to provision a fresh throw-away SMTP account
    const acct = await createEtherealAccount();

    const result = await query<{ id: string }>(
      `INSERT INTO sender_accounts (user_id, display_name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [getUser(req).id, displayName, acct.email, acct.smtpHost, acct.smtpPort, acct.smtpUser, acct.smtpPass]
    );

    res.status(201).json({
      success: true,
      data: {
        id:          result.rows[0].id,
        displayName,
        email:       acct.email,
        smtpHost:    acct.smtpHost,
        smtpPort:    acct.smtpPort,
        previewHint: 'Sent emails are visible at https://ethereal.email — log in with the email/pass above',
      },
    });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(400).json({ success: false, error: 'An Ethereal sender already exists for your account' });
      return;
    }
    next(err);
  }
});

/** DELETE /api/senders/:id — delete a sender account */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      'DELETE FROM sender_accounts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, getUser(req).id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Sender not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;


