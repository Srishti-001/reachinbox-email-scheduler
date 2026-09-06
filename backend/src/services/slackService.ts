/**
 * src/services/slackService.ts
 *
 * Handles all Slack-related work:
 *   1. sendRateLimitNotification() — called by the worker when a sender hits
 *      its hourly limit. Looks up the user's slack_connections row FRESH from
 *      Postgres on every invocation (so a user can connect Slack mid-run and
 *      the very next rate-limit hit will notify them without any restart).
 *      If no row exists, or the send fails, this is a completely silent no-op.
 *
 *   2. exchangeCodeForToken() — called by the OAuth callback route to exchange
 *      a Slack auth code for an access token + webhook URL using the Slack
 *      OAuth v2 API.
 *
 * All functions are guaranteed never to throw — callers do not need try/catch.
 */

import axios from 'axios';
import { query } from '../config/db';
import { config } from '../config';

// ─────────────────────────────────────────────────────────────────────────────
// Notification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a rate-limit notification to the user who owns `senderAccountId`.
 *
 * Flow:
 *   1. JOIN sender_accounts → users to get the owner's user_id.
 *   2. Look up that user_id in slack_connections.
 *   3. If found: post to webhook_url (preferred) or chat.postMessage.
 *   4. Any error anywhere → log a warning and return. Never throw.
 */
export async function sendRateLimitNotification(
  senderAccountId: string,
  senderEmail: string,
  msUntilNextWindow: number
): Promise<void> {
  try {
    // Fresh DB lookup — not cached so Slack connects mid-run are picked up immediately
    const result = await query<{
      webhook_url: string | null;
      access_token: string;
      channel: string | null;
    }>(
      `SELECT sc.webhook_url, sc.access_token, sc.channel
       FROM slack_connections sc
       JOIN sender_accounts sa ON sa.user_id = sc.user_id
       WHERE sa.id = $1
       LIMIT 1`,
      [senderAccountId]
    );

    if (result.rows.length === 0) {
      // No Slack integration for this sender's owner — silent no-op
      return;
    }

    const { webhook_url, access_token, channel } = result.rows[0];
    const minutesLeft = Math.ceil(msUntilNextWindow / 60_000);

    const text =
      `⚠️ *Rate limit reached* for sender \`${senderEmail}\`. ` +
      `Remaining emails in this campaign have been delayed by ~${minutesLeft} minute(s) ` +
      `until the next hourly window.`;

    if (webhook_url) {
      // Incoming Webhook is simpler and requires no channel parameter
      await axios.post(webhook_url, { text }, { timeout: 5000 });
    } else if (access_token && channel) {
      // Fall back to chat.postMessage if webhook isn't stored
      await axios.post(
        'https://slack.com/api/chat.postMessage',
        { channel, text },
        {
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: 5000,
        }
      );
    }

    console.log(`[Slack] 🔔 Rate-limit notification sent for sender ${senderEmail}`);
  } catch (err: any) {
    // Non-fatal — worker must continue regardless of Slack availability
    console.warn(`[Slack] ⚠️  Could not send notification: ${err?.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth token exchange
// ─────────────────────────────────────────────────────────────────────────────

export interface SlackTokenResponse {
  ok: boolean;
  access_token: string;
  team: { id: string; name: string };
  incoming_webhook?: {
    url: string;
    channel: string;
    channel_id: string;
  };
  authed_user?: { id: string };
  bot_user_id?: string;
  scope: string;
  error?: string;
}

/**
 * Exchanges an OAuth authorization code for an access token using
 * Slack's oauth.v2.access endpoint.
 *
 * @throws Error if Slack returns ok:false — caller (route handler) should
 *   redirect the user to an error page.
 */
export async function exchangeCodeForToken(code: string): Promise<SlackTokenResponse> {
  const params = new URLSearchParams({
    client_id:     config.slack.clientId,
    client_secret: config.slack.clientSecret,
    code,
    redirect_uri:  config.slack.redirectUri,
  });

  const response = await axios.post<SlackTokenResponse>(
    'https://slack.com/api/oauth.v2.access',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
  );

  if (!response.data.ok) {
    throw new Error(`Slack OAuth failed: ${response.data.error ?? 'unknown error'}`);
  }

  return response.data;
}
