import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../config/db';
import { emailQueue } from '../queues/emailQueue';
import { EmailJobPayload, Lead, Campaign, SenderAccount } from '../types';
import { upsertEmailLog } from './esIndexer';

// ─────────────────────────────────────────────────────────────────────────────
// Validation schema for the schedule-campaign request body
// ─────────────────────────────────────────────────────────────────────────────

export const scheduleCampaignSchema = z.object({
  senderAccountId: z.string().uuid('senderAccountId must be a valid UUID'),
  subject:         z.string().min(1, 'subject is required').max(500),
  body:            z.string().min(1, 'body is required'),
  recipients:      z
    .array(
      z.object({
        email: z.string().email('each recipient must have a valid email'),
        name:  z.string().optional(),
      })
    )
    .min(1, 'at least one recipient is required'),
  scheduledStart:  z.string().datetime({ message: 'scheduledStart must be an ISO-8601 datetime' }),
  delayBetweenMs:  z.number().int().min(0).default(1000),
  hourlyLimit:     z.number().int().min(1).default(50),
});

export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic BullMQ job ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produces a stable, collision-free job ID from the email_jobs row UUID.
 *
 * Format: `email-{emailJobId}`
 *
 * Idempotency guarantee:
 *   BullMQ ignores `queue.add()` calls where the jobId already exists in
 *   Redis. Combined with the Postgres UNIQUE(campaign_id, recipient_email)
 *   constraint, this means:
 *     1. No DB row can be inserted twice for the same campaign + recipient.
 *     2. No BullMQ job can be enqueued twice for the same DB row.
 *   Together these two guarantees ensure an email can never be sent twice,
 *   even if the server crashes mid-scheduling or mid-reconcile.
 */
export function makeBullJobId(emailJobId: string): string {
  return `email-${emailJobId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main service function
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCampaignResult {
  campaignId: string;
  totalQueued: number;
  skipped: number; // duplicate recipients that already existed
}

/**
 * Creates a campaign + one email_jobs row per recipient, then enqueues
 * a delayed BullMQ job for each one.
 *
 * Everything inside the Postgres transaction is idempotent via ON CONFLICT DO
 * NOTHING, so partial failures and retries are safe.
 *
 * @param userId          The authenticated user's UUID
 * @param input           Validated schedule-campaign payload
 */
export async function createCampaign(
  userId: string,
  input: ScheduleCampaignInput
): Promise<CreateCampaignResult> {
  const { senderAccountId, subject, body, recipients, scheduledStart, delayBetweenMs, hourlyLimit } = input;

  // 1. Verify the sender belongs to this user
  const senderResult = await query<{ id: string; smtp_user: string }>(
    'SELECT id, smtp_user FROM sender_accounts WHERE id = $1 AND user_id = $2',
    [senderAccountId, userId]
  );
  if (senderResult.rows.length === 0) {
    throw Object.assign(new Error('Sender account not found or does not belong to you'), { status: 404 });
  }

  // 2. Deduplicate recipients by email (case-insensitive)
  const seen = new Set<string>();
  const uniqueRecipients: Lead[] = [];
  for (const r of recipients) {
    const normalised = r.email.toLowerCase().trim();
    if (!seen.has(normalised)) {
      seen.add(normalised);
      uniqueRecipients.push({ email: normalised, name: r.name });
    }
  }

  const baseStart = new Date(scheduledStart).getTime();

  // 3. Persist campaign + all email_jobs in a single transaction
  let campaignId: string;
  const insertedJobIds: { id: string; email: string; scheduledAt: Date }[] = [];
  let skipped = 0;

  await withTransaction(async (client) => {
    // Create campaign row
    const campRes = await client.query<{ id: string }>(
      `INSERT INTO campaigns
         (user_id, sender_account_id, subject, body, total_recipients,
          scheduled_start, delay_between_ms, hourly_limit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING id`,
      [userId, senderAccountId, subject, body, uniqueRecipients.length,
       new Date(scheduledStart), delayBetweenMs, hourlyLimit]
    );
    campaignId = campRes.rows[0].id;

    // Insert one email_jobs row per recipient, staggered by delayBetweenMs
    for (let i = 0; i < uniqueRecipients.length; i++) {
      const recipient = uniqueRecipients[i];
      const scheduledAt = new Date(baseStart + i * delayBetweenMs);

      const jobRes = await client.query<{ id: string }>(
        `INSERT INTO email_jobs
           (campaign_id, recipient_email, recipient_name, scheduled_at, status)
         VALUES ($1, $2, $3, $4, 'scheduled')
         ON CONFLICT (campaign_id, recipient_email) DO NOTHING
         RETURNING id`,
        [campaignId, recipient.email, recipient.name ?? null, scheduledAt]
      );

      if (jobRes.rows.length > 0) {
        insertedJobIds.push({
          id:          jobRes.rows[0].id,
          email:       recipient.email,
          scheduledAt,
        });
      } else {
        skipped++;
      }
    }

    // Update campaign status to 'running' now that jobs are persisted
    await client.query(
      `UPDATE campaigns SET status = 'running', updated_at = NOW() WHERE id = $1`,
      [campaignId!]
    );
  });

  // 4. Enqueue BullMQ jobs AFTER the transaction commits
  //    (safe to call even on partial re-runs — BullMQ deduplicates by jobId)
  for (const job of insertedJobIds) {
    const bullJobId = makeBullJobId(job.id);
    const now       = Date.now();
    const delay     = Math.max(0, job.scheduledAt.getTime() - now);

    const payload: EmailJobPayload = {
      emailJobId:      job.id,
      campaignId:      campaignId!,
      userId,
      senderAccountId,
      recipientEmail:  job.email,
      recipientName:   uniqueRecipients.find(r => r.email === job.email)?.name ?? null,
      subject,
      body,
      scheduledAt:     job.scheduledAt.toISOString(),
      delayBetweenMs,
      hourlyLimit,
    };

    await emailQueue.add(job.email, payload, { jobId: bullJobId, delay });

    // Write the BullMQ job ID back so the reconciler skips it on next restart
    await query(
      `UPDATE email_jobs SET bullmq_job_id = $1, status = 'queued', updated_at = NOW()
       WHERE id = $2 AND bullmq_job_id IS NULL`,
      [bullJobId, job.id]
    );

    // Index 'scheduled' state in Elasticsearch (non-fatal — ES must never
    // block the scheduling flow)
    upsertEmailLog({
      emailJobId:      job.id,
      campaignId:      campaignId!,
      userId,
      senderAccountId,
      senderEmail:     senderResult.rows[0].smtp_user,
      recipientEmail:  job.email,
      recipientName:   uniqueRecipients.find(r => r.email === job.email)?.name ?? null,
      subject,
      body,
      status:          'queued',
      scheduledAt:     job.scheduledAt.toISOString(),
      sentAt:          null,
      errorMessage:    null,
      attemptCount:    0,
    }).catch(() => {/* swallowed — never block scheduling */});
  }

  return {
    campaignId:  campaignId!,
    totalQueued: insertedJobIds.length,
    skipped,
  };
}
