import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { config } from '../config';
import { query } from '../config/db';
import { User } from '../types';

const router = Router();

// ── Passport Google Strategy ──────────────────────────────────────────────────

passport.use(
  new GoogleStrategy(
    {
      clientID:     config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL:  config.google.callbackUrl,
    },
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: (err: any, user?: User | false) => void
    ) => {
      try {
        const email     = profile.emails?.[0]?.value ?? '';
        const name      = profile.displayName ?? '';
        const avatarUrl = profile.photos?.[0]?.value ?? null;
        const googleId  = profile.id;

        // Upsert: create user if new, otherwise update name/avatar
        const result = await query<User>(
          `INSERT INTO users (email, name, avatar_url, google_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (google_id) DO UPDATE
             SET name       = EXCLUDED.name,
                 avatar_url = EXCLUDED.avatar_url,
                 updated_at = NOW()
           RETURNING *`,
          [email, name, avatarUrl, googleId]
        );

        return done(null, result.rows[0]);
      } catch (err) {
        return done(err as Error);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const result = await query<User>('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0] ?? false);
  } catch (err) {
    done(err);
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /auth/google — initiates the Google OAuth flow */
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

/** GET /auth/google/callback — handles OAuth callback from Google */
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${config.frontendUrl}/login?error=oauth_failed`,
  }),
  (req: Request, res: Response, next: NextFunction) => {
    // Store user id in express-session for subsequent API calls.
    req.session.userId = (req.user as User).id;

    // IMPORTANT: explicitly save the session before redirecting.
    // Without this call, there is a race condition: the browser follows
    // the redirect and immediately fires GET /auth/me (and other API calls)
    // before express-session's async write to Redis completes, causing 401.
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(`${config.frontendUrl}/dashboard/scheduled`);
    });
  }
);

/** Shared session-destroy handler used by both GET and POST /auth/logout */
function destroySession(req: Request, res: Response, next: NextFunction): void {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
}

/**
 * GET /auth/logout — destroys the session (used by the frontend).
 * POST /auth/logout — same behavior (for API/curl clients).
 */
router.get('/logout',  destroySession);
router.post('/logout', destroySession);

/** GET /auth/me — returns the current authenticated user */
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.session?.userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const result = await query<User>(
      'SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      success: true,
      data: {
        id:        user.id,
        email:     user.email,
        name:      user.name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { passport };
export default router;

