import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { EmailJobPayload } from '../types';
import { QUEUE_NAME, emailQueue } from './emailQueue';
import { sendEmail } from '../services/mailerService';
import { checkAndConsume } from '../services/rateLimiter';
import { query } from '../config/db';
import { makeBullJobId } from '../services/campaignService';
import { upsertEmailLog } from '../services/esIndexer';
import { sendRateLimitNotification } from '../services/slackService';

/**
 * BullMQ Worker — the core of the email-sending pipeline.
 *
 * ─── Restart-safety guarantee ────────────────────────────────────────────────
 * Every BullMQ job carries a deterministic jobId (`email-{emailJobId}`).
 * The emailJobId is the Postgres UUID from the email_jobs table.
 *
 * On server restart:
 *   1. The bootstrap reconciler (src/jobs/bootstrap.ts) queries Postgres for
 *      rows with status IN ('scheduled','queued') and no bullmq_job_id.
 *   2. It calls emailQueue.add(..., { jobId: 'email-{uuid}' }) for each.
 *   3. BullMQ silently ignores add() if the jobId already exists in Redis
 *      (the job is still waiting / in-flight). If Redis was flushed, the job
 *      gets re-added with the same jobId — no duplicate because we check
 *      DB status before sending.
 *   4. Before actually sending an email the worker re-checks the DB row.
 *      If status is already 'sent', it skips the send (idempotent).
 *
 * ─── Rate limiting ───────────────────────────────────────────────────────────
 * Uses a Redis Lua INCR script (rateLimiter.ts). If the hourly limit is hit:
 *   - The job is re-added to the queue with a delay until the next hour window.
 *   - The DB row is set to 'rate_limited'.
 *   - The same deterministic jobId is reused, so BullMQ won't double-enqueue.
 */
export function createEmailWorker(): Worker<EmailJobPayload> {
  const worker = new Worker<EmailJobPayload>(
    QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      const {
        emailJobId,
        campaignId,
        senderAccountId,
        recipientEmail,
        recipientName,
        subject,
        body,
        hourlyLimit,
      } = job.data;

      console.log(`[Worker] ▶ Job ${job.id} → ${recipientEmail} (dbId=${emailJobId})`);

      // ── 0. Idempotency check ──────────────────────────────────────────────
      // If this job was already sent (e.g. worker crashed after send but before
      // DB update, then retried), skip it to avoid double-sending.
      const statusCheck = await query<{ status: string }>(
        'SELECT status FROM email_jobs WHERE id = $1',
        [emailJobId]
      );
      if (statusCheck.rows[0]?.status === 'sent') {
        console.log(`[Worker] ⏭  Job ${job.id} already sent — skipping`);
        return;
      }

      // ── 1. Mark as 'sending' in DB ────────────────────────────────────────
      await query(
        `UPDATE email_jobs
         SET status = 'sending', attempt_count = attempt_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [emailJobId]
      );

      // ── 1b. Index 'sending' status in Elasticsearch (non-fatal) ──────────
      upsertEmailLog({
        emailJobId,
        campaignId,
        userId:          job.data.userId,
        senderAccountId,
        senderEmail:     '',       // filled in by mailerService; we don't have it here cheaply
        recipientEmail,
        recipientName:   recipientName ?? null,
        subject,
        body:            job.data.body,
        status:          'sending',
        scheduledAt:     job.data.scheduledAt,
        sentAt:          null,
        errorMessage:    null,
        attemptCount:    (statusCheck.rows[0] ? 1 : 1), // incremented in DB above
      }).catch(() => {/* swallowed — ES must never block sending */});

      // ── 2. Atomic rate-limit check ────────────────────────────────────────
      const rateResult = await checkAndConsume(senderAccountId, hourlyLimit);

      if (!rateResult.allowed) {
        const { msUntilNextWindow } = rateResult;
        console.warn(
          `[Worker] ⏳ Rate limit hit for sender ${senderAccountId}. ` +
          `Re-delaying job ${job.id} by ${Math.round(msUntilNextWindow / 1000)}s`
        );

        // ── Slack notification (fresh DB lookup every time, silent no-op) ──
        // Fetch sender email for a human-readable message
        const senderRow = await query<{ email: string }>(
          'SELECT email FROM sender_accounts WHERE id = $1',
          [senderAccountId]
        ).catch(() => ({ rows: [] as { email: string }[] }));
        const senderEmail = senderRow.rows[0]?.email ?? senderAccountId;

        // Fire-and-forget — sendRateLimitNotification never throws
        sendRateLimitNotification(senderAccountId, senderEmail, msUntilNextWindow);

        // ── ES index 'rate_limited' status (non-fatal) ────────────────────
        upsertEmailLog({
          emailJobId,
          campaignId,
          userId:          job.data.userId,
          senderAccountId,
          senderEmail,
          recipientEmail,
          recipientName:   recipientName ?? null,
          subject,
          body:            job.data.body,
          status:          'rate_limited',
          scheduledAt:     job.data.scheduledAt,
          sentAt:          null,
          errorMessage:    null,
          attemptCount:    0,
        }).catch(() => {});

        // Re-enqueue with the same deterministic jobId after the window resets.
        // BullMQ will reject the add() if the job still exists in Redis —
        // we catch that error silently.
        try {
          await emailQueue.add(recipientEmail, job.data, {
            jobId: makeBullJobId(emailJobId),
            delay: msUntilNextWindow + 1000, // small buffer past the window boundary
          });
        } catch {
          // Job already exists in queue — that's fine, do nothing
        }

        // Update DB to reflect the delay
        await query(
          `UPDATE email_jobs SET status = 'rate_limited', updated_at = NOW() WHERE id = $1`,
          [emailJobId]
        );

        // Return without error so BullMQ marks this attempt as 'completed'
        // (avoids pointless retries — the re-enqueued job will handle sending)
        return;
      }

      // ── 3. Send the email ─────────────────────────────────────────────────
      try {
        const result = await sendEmail(
          senderAccountId,
          recipientEmail,
          recipientName,
          subject,
          body
        );

        // ── 4a. Mark as sent ─────────────────────────────────────────────────
        await query(
          `UPDATE email_jobs
           SET status = 'sent', sent_at = NOW(), error_message = NULL, updated_at = NOW()
           WHERE id = $1`,
          [emailJobId]
        );

        const sentAt = new Date().toISOString();
        console.log(
          `[Worker] ✅ Sent to ${recipientEmail} | preview: ${result.previewUrl}`
        );

        // ── ES index 'sent' status (non-fatal) ───────────────────────────────
        upsertEmailLog({
          emailJobId,
          campaignId,
          userId:          job.data.userId,
          senderAccountId,
          senderEmail:     result.messageId, // use messageId as proxy; full address in mailer
          recipientEmail,
          recipientName:   recipientName ?? null,
          subject,
          body:            job.data.body,
          status:          'sent',
          scheduledAt:     job.data.scheduledAt,
          sentAt,
          errorMessage:    null,
          attemptCount:    0,
        }).catch(() => {});

        // ── 5. Check if entire campaign is now complete ───────────────────────
        checkCampaignCompletion(campaignId).catch((err) =>
          console.error('[Worker] Campaign completion check failed:', err)
        );
      } catch (sendErr: any) {
        // ── 4b. Mark as failed ────────────────────────────────────────────────
        const errMsg = sendErr?.message ?? String(sendErr);
        console.error(`[Worker] ❌ Failed to send to ${recipientEmail}:`, errMsg);

        await query(
          `UPDATE email_jobs
           SET status = 'failed', error_message = $2, updated_at = NOW()
           WHERE id = $1`,
          [emailJobId, errMsg]
        );

        // ── ES index 'failed' status (non-fatal) ─────────────────────────────
        upsertEmailLog({
          emailJobId,
          campaignId,
          userId:          job.data.userId,
          senderAccountId,
          senderEmail:     '',
          recipientEmail,
          recipientName:   recipientName ?? null,
          subject,
          body:            job.data.body,
          status:          'failed',
          scheduledAt:     job.data.scheduledAt,
          sentAt:          null,
          errorMessage:    errMsg,
          attemptCount:    0,
        }).catch(() => {});

        // Re-throw so BullMQ records it as a failed attempt and applies backoff
        throw sendErr;
      }
    },
    {
      connection: {
        url: config.redisUrl,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      concurrency: config.scheduling.workerConcurrency,
      // Enforces minimum inter-send delay globally across all workers sharing Redis
      limiter: {
        max:      1,
        duration: config.scheduling.minDelayMs,
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] ✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] ❌ Job ${job?.id} failed (BullMQ):`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Connection error:', err);
  });

  console.log(
    `✅ Email worker started — concurrency=${config.scheduling.workerConcurrency}, ` +
    `minDelay=${config.scheduling.minDelayMs}ms`
  );

  return worker;
}

/**
 * After each successful send, check whether all jobs in a campaign are
 * terminal (sent or failed). If so, mark the campaign itself as 'completed'.
 * Fire-and-forget — errors are logged but never bubble up.
 */
async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const result = await query<{ non_terminal: string }>(
    `SELECT COUNT(*) AS non_terminal
     FROM email_jobs
     WHERE campaign_id = $1
       AND status NOT IN ('sent', 'failed')`,
    [campaignId]
  );

  const remaining = parseInt(result.rows[0]?.non_terminal ?? '1', 10);
  if (remaining === 0) {
    await query(
      `UPDATE campaigns SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [campaignId]
    );
    console.log(`[Worker] 🎉 Campaign ${campaignId} completed`);
  }
}
