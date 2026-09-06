import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { query } from '../config/db';
import { config } from '../config';
import { SlackConnection, User } from '../types';
import { exchangeCodeForToken } from '../services/slackService';

const getUser = (req: Request) => req.user as User;

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /slack/status  (unchanged from Stage 1)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query<SlackConnection>(
      'SELECT team_name, channel FROM slack_connections WHERE user_id = $1',
      [getUser(req).id]
    );
    if (result.rows.length === 0) {
      res.json({ success: true, data: { connected: false } });
      return;
    }
    const conn = result.rows[0];
    res.json({
      success: true,
      data: { connected: true, teamName: conn.team_name, channel: conn.channel },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /slack/connect  — redirects user to Slack's OAuth v2 authorize page
// ─────────────────────────────────────────────────────────────────────────────

router.get('/connect', requireAuth, (req: Request, res: Response) => {
  if (!config.slack.clientId || !config.slack.redirectUri) {
    res.status(503).json({
      success: false,
      error: 'Slack OAuth is not configured — set SLACK_CLIENT_ID and SLACK_REDIRECT_URI in .env',
    });
    return;
  }

  // Store the user ID in session so the callback knows who to associate the
  // token with (Slack OAuth callback is not protected by requireAuth because
  // Slack calls it without a session cookie).
  (req.session as any).slackUserId = getUser(req).id;

  const params = new URLSearchParams({
    client_id:    config.slack.clientId,
    redirect_uri: config.slack.redirectUri,
    scope:        'chat:write,incoming-webhook',
    // user_scope not needed — bot scopes are sufficient for notifications
  });

  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  res.redirect(slackAuthUrl);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /slack/callback  — Slack sends code here; exchange for token, persist
// ─────────────────────────────────────────────────────────────────────────────

router.get('/callback', async (req: Request, res: Response) => {
  const code  = req.query.code  as string | undefined;
  const error = req.query.error as string | undefined;

  // Slack sends ?error=access_denied if the user cancelled
  if (error || !code) {
    res.redirect(`${config.frontendUrl}/dashboard/scheduled?slack=cancelled`);
    return;
  }

  // Recover the user who initiated the flow from their session
  const userId: string | undefined = (req.session as any).slackUserId ?? req.session?.userId;
  if (!userId) {
    res.redirect(`${config.frontendUrl}/login?error=slack_session_expired`);
    return;
  }

  try {
    const token = await exchangeCodeForToken(code);

    const webhookUrl = token.incoming_webhook?.url   ?? null;
    const channel    = token.incoming_webhook?.channel ?? null;
    const teamId     = token.team.id;
    const teamName   = token.team.name;
    const botUserId  = token.bot_user_id ?? null;
    const scope      = token.scope;

    // Upsert into slack_connections (one row per user — UNIQUE on user_id)
    await query(
      `INSERT INTO slack_connections
         (user_id, access_token, team_id, team_name, webhook_url, channel, bot_user_id, scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             team_id      = EXCLUDED.team_id,
             team_name    = EXCLUDED.team_name,
             webhook_url  = EXCLUDED.webhook_url,
             channel      = EXCLUDED.channel,
             bot_user_id  = EXCLUDED.bot_user_id,
             scope        = EXCLUDED.scope,
             updated_at   = NOW()`,
      [userId, token.access_token, teamId, teamName, webhookUrl, channel, botUserId, scope]
    );

    // Clean up the temporary session key
    delete (req.session as any).slackUserId;

    res.redirect(`${config.frontendUrl}/dashboard/scheduled?slack=connected`);
  } catch (err: any) {
    console.error('[Slack] OAuth callback error:', err.message);
    res.redirect(
      `${config.frontendUrl}/dashboard/scheduled?slack=error&msg=${encodeURIComponent(err.message)}`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /slack/disconnect  (unchanged from Stage 1)
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM slack_connections WHERE user_id = $1', [getUser(req).id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
