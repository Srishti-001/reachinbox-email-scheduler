import { Client } from '@elastic/elasticsearch';
import { config } from './index';

export const esClient = new Client({
  node: config.elasticsearch.url,
});

/**
 * Ensures the email_logs index exists with the correct mapping.
 * Called once on server startup. Non-fatal if Elasticsearch is unavailable.
 */
export async function ensureEmailLogsIndex(): Promise<void> {
  const indexName = config.elasticsearch.index;

  try {
    const exists = await esClient.indices.exists({ index: indexName });
    if (!exists) {
      await esClient.indices.create({
        index: indexName,
        mappings: {
          properties: {
            userId:         { type: 'keyword' },
            campaignId:     { type: 'keyword' },
            senderEmail:    { type: 'keyword' },
            recipientEmail: { type: 'keyword' },
            recipientName:  { type: 'text' },
            subject:        { type: 'text' },
            body:           { type: 'text' },
            status:         { type: 'keyword' },
            scheduledAt:    { type: 'date' },
            sentAt:         { type: 'date' },
            errorMessage:   { type: 'text' },
            attemptCount:   { type: 'integer' },
          },
        },
      });
      console.log(`✅ Elasticsearch index "${indexName}" created`);
    } else {
      console.log(`✅ Elasticsearch index "${indexName}" already exists`);
    }
  } catch (err) {
    // Non-fatal: app continues without ES if it's unavailable at startup
    console.warn('⚠️  Could not ensure Elasticsearch index (non-fatal):', (err as Error).message);
  }
}
