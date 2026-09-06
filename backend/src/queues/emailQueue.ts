import { Queue } from 'bullmq';
import { config } from '../config';
import { EmailJobPayload } from '../types';

export const QUEUE_NAME = 'email-send';

/**
 * The main BullMQ queue for all outbound email jobs.
 * Backed by Redis — jobs survive server restarts.
 * Jobs are enqueued with deterministic IDs (`email-{emailJobId}`)
 * so re-enqueuing on restart is fully idempotent.
 */
export const emailQueue = new Queue<EmailJobPayload>(QUEUE_NAME, {
  connection: {
    url: config.redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },
  defaultJobOptions: {
    // Keep last 1000 completed jobs visible in Bull Board
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
    // Retry up to 3 times with exponential backoff
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

emailQueue.on('error', (err) => {
  console.error('[EmailQueue] Error:', err);
});

console.log(`✅ BullMQ queue "${QUEUE_NAME}" initialized`);
