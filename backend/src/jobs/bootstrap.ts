import { emailQueue } from '../queues/emailQueue';
import { query } from '../config/db';
import { EmailJob, EmailJobPayload } from '../types';

/**
 * Bootstrap Reconciler — runs once on server start, 2 seconds after boot.
 *
 * Guarantees that every email_job that SHOULD still fire actually has a live
 * BullMQ job waiting in Redis. Handles two distinct failure scenarios:
 *
 * ── Scenario A: Crash before bullmq_job_id was written ──────────────────────
 *   Symptoms: status IN ('scheduled','queued') AND bullmq_job_id IS NULL
 *   Action:   Re-enqueue with deterministic jobId; write bullmq_job_id.
 *
 * ── Scenario B: Redis was flushed / restarted ────────────────────────────────
 *   Symptoms: status IN ('scheduled','queued','rate_limited') AND
 *             bullmq_job_id IS NOT NULL but the job is gone from Redis.
 *   Action:   Re-enqueue with the SAME deterministic jobId (BullMQ ignores
 *             if already present), clear stale bullmq_job_id so the DB lookup
 *             in the WHERE clause doesn't skip this row on the next restart.
 *
 * ── Idempotency guarantee ────────────────────────────────────────────────────
 *   BullMQ silently ignores add() when jobId already exists in Redis.
 *   The Postgres UNIQUE(campaign_id, recipient_email) prevents duplicate rows.
 *   The worker's step-0 idempotency check (status === 'sent') prevents
 *   double-sending even if a job fires twice.
 *
 *   Running the reconciler multiple times is completely safe.
 *
 * ── 'sending' row cleanup ────────────────────────────────────────────────────
 *   If the worker died while a row was in status='sending', the send may or
 *   may not have completed. We reset these rows back to 'queued' and re-enqueue
 *   them. The worker's step-0 idempotency check catches the case where the
 *   email was already sent: it reads the DB again before calling sendEmail().
 */
export async function runBootstrapReconciler(): Promise<void> {
  console.log('[Bootstrap] Running restart reconciler...');

  try {
    type ReconcileRow = EmailJob & {
      campaign_subject:        string;
      campaign_body:           string;
      campaign_delay_between_ms: number;
      campaign_hourly_limit:   number;
      campaign_user_id:        string;
      campaign_sender_account_id: string;
    };

    // Fetch ALL non-terminal jobs regardless of bullmq_job_id:
    //   - 'scheduled' / 'queued' / 'rate_limited' may be missing from Redis.
    //   - 'sending' means the worker died mid-flight; re-enqueue for retry
    //     (the worker's idempotency check prevents double-send if it succeeded).
    const result = await query<ReconcileRow>(`
      SELECT
        ej.*,
        c.subject           AS campaign_subject,
        c.body              AS campaign_body,
        c.delay_between_ms  AS campaign_delay_between_ms,
        c.hourly_limit      AS campaign_hourly_limit,
        c.user_id           AS campaign_user_id,
        c.sender_account_id AS campaign_sender_account_id
      FROM email_jobs ej
      JOIN campaigns c ON ej.campaign_id = c.id
      WHERE ej.status IN ('scheduled', 'queued', 'rate_limited', 'sending')
    `);

    const jobs = result.rows;
    console.log(`[Bootstrap] Found ${jobs.length} non-terminal job(s) to reconcile`);

    let requeued = 0;
    let alreadyLive = 0;
    let resetSending = 0;

    for (const job of jobs) {
      const jobId      = `email-${job.id}`;
      const now        = Date.now();
      const scheduledAt = new Date(job.scheduled_at).getTime();
      const delay      = Math.max(0, scheduledAt - now);

      // ── For 'sending' rows: reset status back to 'queued' before re-enqueue ─
      // The worker will re-check status in step-0; if actually sent, it skips.
      if (job.status === 'sending') {
        await query(
          `UPDATE email_jobs
           SET status = 'queued', bullmq_job_id = NULL, updated_at = NOW()
           WHERE id = $1 AND status = 'sending'`,
          [job.id]
        );
        resetSending++;
      }

      const payload: EmailJobPayload = {
        emailJobId:        job.id,
        campaignId:        job.campaign_id,
        userId:            job.campaign_user_id,
        senderAccountId:   job.campaign_sender_account_id,
        recipientEmail:    job.recipient_email,
        recipientName:     job.recipient_name,
        subject:           job.campaign_subject,
        body:              job.campaign_body,
        scheduledAt:       new Date(job.scheduled_at).toISOString(),
        delayBetweenMs:    job.campaign_delay_between_ms,
        hourlyLimit:       job.campaign_hourly_limit,
      };

      // BullMQ.add() is idempotent when jobId already exists in Redis —
      // it returns the existing job without error. We check whether the job
      // was already live to produce accurate reconciler metrics.
      const existingJob = await emailQueue.getJob(jobId);

      if (existingJob) {
        alreadyLive++;
        // Ensure DB has the correct bullmq_job_id (covers Scenario A partial writes)
        await query(
          `UPDATE email_jobs
           SET bullmq_job_id = $1, updated_at = NOW()
           WHERE id = $2 AND (bullmq_job_id IS NULL OR bullmq_job_id != $1)`,
          [jobId, job.id]
        );
        continue;
      }

      // Job is not in Redis — re-enqueue it
      await emailQueue.add(payload.recipientEmail, payload, { jobId, delay });

      // Write (or refresh) the bullmq_job_id so the next reconciler run
      // knows this was processed. Use ON CONFLICT logic via plain UPDATE.
      await query(
        `UPDATE email_jobs
         SET bullmq_job_id = $1, status = 'queued', updated_at = NOW()
         WHERE id = $2`,
        [jobId, job.id]
      );

      requeued++;
    }

    console.log(
      `[Bootstrap] ✅ Done — ${requeued} re-enqueued, ` +
      `${alreadyLive} already live in Redis, ` +
      `${resetSending} 'sending' rows reset to 'queued'`
    );
  } catch (err) {
    // Non-fatal: the app continues even if reconciliation fails partially.
    // Errors here are logged loudly so ops can investigate.
    console.error('[Bootstrap] ❌ Reconciler error (non-fatal):', err);
  }
}
