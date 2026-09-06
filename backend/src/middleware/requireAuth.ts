import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { User } from '../types';

// Extend Express Request to carry the authenticated user.
// Placing this here means every route that imports requireAuth
// automatically sees req.user without needing a separate import.
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Middleware that validates the Passport session and attaches req.user.
 * Returns 401 if the session is missing or the user no longer exists.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized — please log in' });
      return;
    }

    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    next(err);
  }
}
