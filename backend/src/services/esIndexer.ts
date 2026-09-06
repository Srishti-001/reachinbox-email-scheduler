/**
 * src/services/esIndexer.ts
 *
 * Thin, non-fatal wrapper around the Elasticsearch client for indexing
 * email job documents. All public functions swallow ES errors and log
 * a warning — a temporarily unavailable ES cluster must NEVER block or
 * crash the email scheduling / sending pipeline.
 *
 * Document shape matches the mappings in src/config/elasticsearch.ts.
 */

import { esClient } from '../config/elasticsearch';
import { config } from '../config';

const INDEX = () => config.elasticsearch.index;

export interface EmailLogDoc {
  emailJobId:     string;
  campaignId:     string;
  userId:         string;
  senderAccountId: string;
  senderEmail:    string;
  recipientEmail: string;
  recipientName:  string | null;
  subject:        string;
  body:           string;
  status:         string;
  scheduledAt:    string;   // ISO-8601
  sentAt:         string | null;
  errorMessage:   string | null;
  attemptCount:   number;
}

/**
 * Upsert a document for an email job.
 * Uses the emailJobId as the ES document _id so repeated calls are idempotent.
 * Any ES error is caught — calling code is never interrupted.
 */
export async function upsertEmailLog(doc: EmailLogDoc): Promise<void> {
  try {
    await esClient.update({
      index: INDEX(),
      id:    doc.emailJobId,
      doc,
      doc_as_upsert: true,
    });
  } catch (err: any) {
    console.warn(
      `[ES] ⚠️  Could not upsert doc for emailJob ${doc.emailJobId}: ${err?.message}`
    );
  }
}

/**
 * Search email logs across subject, recipientEmail, and status fields.
 *
 * @param userId  Scope results to a single user's campaigns
 * @param q       Free-text query string
 * @param from    Pagination offset
 * @param size    Page size (max 100)
 */
export interface SearchHit {
  emailJobId:     string;
  campaignId:     string;
  recipientEmail: string;
  recipientName:  string | null;
  subject:        string;
  status:         string;
  scheduledAt:    string;
  sentAt:         string | null;
  errorMessage:   string | null;
}

export interface SearchResult {
  total: number;
  hits:  SearchHit[];
}

export async function searchEmailLogs(
  userId: string,
  q: string,
  from = 0,
  size = 20
): Promise<SearchResult> {
  try {
    const response = await esClient.search<EmailLogDoc>({
      index: INDEX(),
      from,
      size:  Math.min(size, 100),
      query: {
        bool: {
          must: [
            { term: { userId } },              // always scope to the calling user
            {
              multi_match: {
                query:  q,
                fields: ['subject^3', 'recipientEmail^2', 'recipientName', 'body', 'status'],
                type:   'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
        },
      },
      sort: [{ scheduledAt: { order: 'desc' } }],
    });

    const hits: SearchHit[] = response.hits.hits.map((h) => {
      const src = h._source!;
      return {
        emailJobId:     src.emailJobId,
        campaignId:     src.campaignId,
        recipientEmail: src.recipientEmail,
        recipientName:  src.recipientName,
        subject:        src.subject,
        status:         src.status,
        scheduledAt:    src.scheduledAt,
        sentAt:         src.sentAt,
        errorMessage:   src.errorMessage,
      };
    });

    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : (response.hits.total?.value ?? 0);

    return { total, hits };
  } catch (err: any) {
    console.warn(`[ES] ⚠️  Search failed: ${err?.message}`);
    // Return empty result instead of crashing the API
    return { total: 0, hits: [] };
  }
}
