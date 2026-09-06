# ReachInbox — Email Job Scheduler

> **Full-stack assignment for ReachInbox.ai** — A production-grade email scheduling
> system built on TypeScript + Express + BullMQ + PostgreSQL + Elasticsearch.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Setup Instructions](#3-setup-instructions)
4. [Environment Variable Reference](#4-environment-variable-reference)
5. [Feature Checklist vs. Assignment Requirements](#5-feature-checklist-vs-assignment-requirements)
6. [Restart-Safety Demo](#6-restart-safety-demo)
7. [Assumptions, Trade-offs & Known Limits](#7-assumptions-trade-offs--known-limits)
8. [Deployment Notes](#8-deployment-notes)

---

## 1. Project Overview

ReachInbox Email Scheduler lets authenticated users (Google OAuth) schedule bulk
email campaigns to CSV-uploaded lead lists. Emails are sent via Ethereal (fake
SMTP — safe for demos) through a BullMQ worker that enforces per-sender hourly
rate limits, re-delays overflowing emails to the next hour window, and indexes
every send event into Elasticsearch for full-text search. A live Bull Board
dashboard shows queue state in real time. Slack OAuth lets users receive
rate-limit notifications in their workspace.

The system is fully persistent across restarts: a bootstrap reconciler re-enqueues
any job that was in-flight or scheduled when the server died, with mathematically
guaranteed no-duplicate-send semantics.

---

## 2. Architecture Overview

### How scheduling works (BullMQ delayed jobs — no cron, no setInterval)

```
POST /api/campaigns
       │
       ▼
campaignService.ts
  ├─ Validate input (Zod)
  ├─ Verify sender ownership
  ├─ Deduplicate recipients (case-insensitive)
  ├─ BEGIN TRANSACTION
  │    ├─ INSERT campaigns row
  │    ├─ INSERT email_jobs rows (staggered scheduledAt = start + i × delay)
  │    │    └─ ON CONFLICT(campaign_id, recipient_email) DO NOTHING
  │    └─ UPDATE campaign status → 'running'
  └─ COMMIT
       │
       ▼ (after commit — safe to fail without losing DB rows)
  ├─ emailQueue.add(payload, { jobId: "email-{uuid}", delay: ms })
  │    └─ BullMQ stores job in Redis as a delayed job
  └─ UPDATE email_jobs SET bullmq_job_id = 'email-{uuid}'
       │
       ▼  (at scheduled time)
  Worker picks up job
  ├─ Step 0: DB idempotency check (skip if status='sent')
  ├─ Step 1: Mark status='sending' + ES upsert
  ├─ Step 2: Redis Lua rate-limit check (atomic INCR)
  │    ├─ Allowed → sendEmail() → status='sent' + ES upsert
  │    └─ Over limit → re-delay to next hour + Slack notification + status='rate_limited'
  └─ Step 3: Check campaign completion
```

**Why BullMQ delayed jobs, not cron?**  
Each email is a first-class job with an individual delay. The scheduler is
a pure queue: no polling, no timer drift, no OS-level scheduler dependency.
BullMQ persists jobs in Redis with AOF (appendonly yes) — jobs survive Redis
restarts.

### How persistence / restart-safety works

The bootstrap reconciler (`src/jobs/bootstrap.ts`) runs 2 seconds after every
server start. It queries Postgres for all jobs with status IN
`('scheduled','queued','rate_limited','sending')` and:

1. **Job still in Redis** → updates `bullmq_job_id` in DB and skips.
2. **Job missing from Redis** (Redis was flushed/restarted) → re-enqueues with
   the same deterministic `jobId = "email-{postgres-uuid}"`. BullMQ ignores a
   duplicate `add()` if the jobId already exists.
3. **Status='sending'** (worker crashed mid-send) → resets to `'queued'`, then
   re-enqueues. The worker's step-0 check (`status === 'sent'`) prevents
   double-sending even if the previous attempt completed.

**Duplicate-send prevention — three independent layers:**
| Layer | Mechanism |
|---|---|
| DB constraint | `UNIQUE(campaign_id, recipient_email)` — one row per recipient per campaign |
| BullMQ dedup | Deterministic `jobId = "email-{uuid}"` — BullMQ ignores duplicate `add()` |
| Worker idempotency | Step-0 re-checks DB before sending — skips if `status='sent'` |

### How rate limiting works

```
Redis key: rate:{senderAccountId}:{hourWindow}
  where hourWindow = Math.floor(Date.now() / 3_600_000)

Lua script (atomic):
  INCR key              → current count in this window
  if current == 1: EXPIRE key 7200   (2-hour TTL)
  if current > limit: return -1       (over limit)
  else: return current                (allowed)
```

When the limit is hit:
1. Slack notification fires (fresh DB lookup — picks up mid-run connects)
2. Job is re-enqueued with `delay = msUntilNextHourWindow + 1000ms buffer`
3. Same deterministic `jobId` is reused — BullMQ deduplicates
4. DB status → `'rate_limited'`, ES document updated

### How concurrency is configured

| Knob | Env var | Default |
|---|---|---|
| Worker process concurrency | `WORKER_CONCURRENCY` | 5 |
| Minimum inter-send delay | `MIN_DELAY_MS` | 1000ms |
| Hourly limit (per campaign) | `hourlyLimit` in POST body | 50 |

The BullMQ `limiter` setting (`max: 1, duration: MIN_DELAY_MS`) enforces the
minimum delay globally across all worker instances sharing Redis, preventing
burst sends even with concurrency > 1.

---

## 3. Setup Instructions

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- A Google Cloud project (for OAuth)
- A Slack app (optional, for notifications)

### Step 1 — Clone and start infrastructure

```bash
git clone <repo-url>
cd reachinbox-email-scheduler

docker-compose up -d
# Starts: PostgreSQL :5432, Redis :6379, Elasticsearch :9200
```

Wait ~30 seconds for Elasticsearch to be healthy:
```bash
curl http://localhost:9200/_cluster/health
```

### Step 2 — Backend

```bash
cd backend
cp .env.example .env
# Edit .env — fill in Google OAuth credentials at minimum (see below)

npm install
npm run migrate    # applies src/db/migrations/001_initial.sql
npm run dev        # starts Express on :4000
```

### Step 3 — Frontend

```bash
cd frontend
cp .env.local.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:4000   (already set)

npm install
npm run dev        # starts Next.js on :3000
```

### Step 4 — Access points

| URL | Description |
|---|---|
| http://localhost:3000 | Frontend — login with Google |
| http://localhost:4000/health | Backend health |
| http://localhost:4000/bull-ui | Bull Board (user: any, password: `BULL_BOARD_PASSWORD`) |
| http://localhost:9200/email_logs/_count | Elasticsearch doc count |

### Google OAuth credentials

1. Go to [Google Cloud Console → APIs → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create **OAuth 2.0 Client ID** (Web application)
3. Authorized redirect URI: `http://localhost:4000/auth/google/callback`
4. Copy **Client ID** and **Client Secret** into `backend/.env`

### Slack app credentials (optional)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create App
2. Add OAuth scopes: `chat:write`, `incoming-webhook`
3. Redirect URL: `http://localhost:4000/slack/callback`
4. Copy **Client ID** and **Client Secret** into `backend/.env`
5. Connect via the "Connect Slack" button in the dashboard header

### Ethereal (no setup required)

Ethereal accounts are **auto-generated** when you create a sender account via
the API. No manual signup needed. Preview URLs for every sent email appear
in the server console and at https://ethereal.email.

To create a sender account via API (after logging in):
```bash
curl -X POST http://localhost:4000/api/senders \
  -b "connect.sid=<your-session>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "My Sender",
    "email": "demo@ethereal.email",
    "smtpHost": "smtp.ethereal.email",
    "smtpPort": 587,
    "smtpUser": "<generated-user>",
    "smtpPass": "<generated-pass>"
  }'
```

Or call `createEtherealAccount()` in `src/services/mailerService.ts` to
get fresh credentials programmatically.

---

## 4. Environment Variable Reference

All variables live in `backend/.env` (copy from `backend/.env.example`).

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `4000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string (`postgresql://user:pass@host:port/db`) |
| `REDIS_URL` | **Yes** | — | Redis connection string (`redis://host:port`) |
| `GOOGLE_CLIENT_ID` | **Yes** | — | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | **Yes** | — | Google OAuth 2.0 client secret |
| `GOOGLE_CALLBACK_URL` | **Yes** | — | OAuth callback (e.g. `http://localhost:4000/auth/google/callback`) |
| `SESSION_SECRET` | **Yes** | — | Secret for express-session cookie signing — use a long random string in prod |
| `SESSION_MAX_AGE_HOURS` | No | `24` | Session cookie lifetime in hours |
| `SLACK_CLIENT_ID` | No | `""` | Slack app client ID (optional — Slack connect will return 503 if unset) |
| `SLACK_CLIENT_SECRET` | No | `""` | Slack app client secret |
| `SLACK_REDIRECT_URI` | No | `""` | Slack OAuth redirect URI (e.g. `http://localhost:4000/slack/callback`) |
| `ELASTICSEARCH_URL` | No | `http://localhost:9200` | Elasticsearch node URL |
| `ELASTICSEARCH_INDEX` | No | `email_logs` | Index name for email log documents |
| `MAX_EMAILS_PER_HOUR` | No | `50` | Default hourly send limit used by rate limiter (overridable per campaign) |
| `MIN_DELAY_MS` | No | `1000` | Minimum ms between any two sends (enforced by BullMQ limiter across workers) |
| `WORKER_CONCURRENCY` | No | `5` | Number of concurrent BullMQ worker slots |
| `ETHEREAL_USER` | No | `""` | Static fallback Ethereal user (only needed if a sender is deleted post-schedule) |
| `ETHEREAL_PASS` | No | `""` | Static fallback Ethereal password |
| `FRONTEND_URL` | No | `http://localhost:3000` | CORS allowed origin + OAuth redirect base URL |
| `BULL_BOARD_PATH` | No | `/bull-ui` | URL path for Bull Board dashboard |
| `BULL_BOARD_PASSWORD` | No | `admin` | HTTP Basic Auth password for Bull Board |

Frontend variables live in `frontend/.env.local`:

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Backend API base URL (must be accessible from browser) |

---

## 5. Feature Checklist vs. Assignment Requirements

### Backend

| Requirement | Implementation | Status |
|---|---|---|
| TypeScript + Express.js | `backend/src/app.ts`, all routes | ✅ |
| BullMQ + Redis for scheduling (no cron) | `src/queues/emailQueue.ts` + `worker.ts` | ✅ |
| Cron / node-cron / agenda **forbidden** | Not used anywhere — only BullMQ delayed jobs | ✅ |
| MySQL or Postgres | PostgreSQL 16 via `node-postgres` | ✅ |
| Ethereal SMTP (fake SMTP) | `src/services/mailerService.ts` | ✅ |
| Multiple sender accounts | `sender_accounts` table + `GET/POST/DELETE /api/senders` | ✅ |
| Elasticsearch indexing | `src/services/esIndexer.ts` — indexes on queued/sending/sent/failed/rate_limited | ✅ |
| ES searchable across subject/recipient/status | `GET /api/emails/search?q=` | ✅ |
| Live Bull Board dashboard | `@bull-board/express` at `BULL_BOARD_PATH` with Basic Auth | ✅ |
| Fully persistent on restart | Bootstrap reconciler in `src/jobs/bootstrap.ts` | ✅ |
| Deterministic job IDs (no duplicates) | `jobId = "email-{postgres-uuid}"` in campaignService + BullMQ dedup | ✅ |
| Per-sender hourly rate limiting | Redis Lua atomic INCR in `src/services/rateLimiter.ts` | ✅ |
| Rate-limit overflow → re-delay to next window | Worker re-enqueues with `delay = msUntilNextWindow` | ✅ |
| Configurable concurrency | `WORKER_CONCURRENCY` env var + BullMQ `concurrency` option | ✅ |
| Minimum send delay (MIN_DELAY_MS) | BullMQ `limiter: { max: 1, duration: MIN_DELAY_MS }` | ✅ |
| Slack OAuth (real, not mocked) | `GET /slack/connect` → OAuth v2 → `GET /slack/callback` stores token | ✅ |
| Slack notification on rate-limit hit | `slackService.sendRateLimitNotification()` — fresh DB lookup per call | ✅ |
| Google OAuth 2.0 login | Passport.js Google strategy in `src/routes/auth.ts` | ✅ |
| Session persistence (httpOnly cookie) | `express-session` with `httpOnly: true`, `secure: true` in prod | ✅ |
| All routes auth-guarded | `requireAuth` middleware on all `/api/*` routes | ✅ |
| Consistent error JSON (no stack traces) | Global `errorHandler` middleware always returns `{ success, error }` | ✅ |
| Slack tokens never exposed to frontend | `/slack/status` returns only `{ connected, teamName, channel }` | ✅ |

### Frontend

| Requirement | Implementation | Status |
|---|---|---|
| Google login page | `src/app/login/page.tsx` — Google sign-in button → `/auth/google` | ✅ |
| Auth guard (redirect to login) | `src/app/dashboard/layout.tsx` — `useEffect` redirect if not authed | ✅ |
| Dashboard shell (Header + TabNav) | `src/components/layout/Header.tsx` + `TabNav.tsx` | ✅ |
| Header shows real user name/email/avatar | From `AuthContext` → `GET /auth/me` | ✅ |
| Working logout | `GET /auth/logout` → clears session → redirect | ✅ |
| Compose modal with CSV upload | `src/components/compose/ComposeModal.tsx` | ✅ |
| Sender dropdown (real data) | `GET /api/senders` populates `<select>` in ComposeModal | ✅ |
| CSV parse + invalid row flagging | Client-side `parseCSVFile()` + preview count | ✅ |
| POST /api/campaigns on submit | `axios.post('/api/campaigns', ...)` | ✅ |
| Scheduled emails tab (real data) | `GET /api/emails/scheduled` — paginated, 10s auto-refresh | ✅ |
| Sent emails tab (real data) | `GET /api/emails/sent` — paginated, 15s auto-refresh | ✅ |
| ES-backed search on Sent tab | `GET /api/emails/search?q=` — debounced 350ms | ✅ |
| Color-coded status badges | `StatusBadge` in `src/components/ui/Badge.tsx` | ✅ |
| Loading skeletons | `TableSkeleton` shimmer animation | ✅ |
| Empty states | `EmptyState` component with contextual message | ✅ |
| Pagination | `Pagination` component on both tabs | ✅ |
| Slack connect/disconnect in header | `SlackWidget` in Header — live status, OAuth link, disconnect | ✅ |
| Mobile responsive | Tables → stacked cards on mobile; modal → bottom sheet | ✅ |
| Accessible modal | Focus trap, Escape key, `aria-modal`, `aria-labelledby` | ✅ |
| Error boundary | `ErrorBoundary` around dashboard children | ✅ |
| Toast notifications | `react-hot-toast` on success/error | ✅ |
| No mock data remaining | All data from real API endpoints | ✅ |

---

## 6. Restart-Safety Demo

See **[RESTART_TEST.md](./RESTART_TEST.md)** for a step-by-step manual test
covering three failure scenarios:

1. **Server crash after partial sends** — unsent jobs fire at original times.
2. **Redis flush** — jobs re-enqueued from Postgres state, no duplicates.
3. **Worker crash mid-send** — 'sending' rows reset and retried safely.

Quick verification command (after scheduling a campaign):
```bash
# Check for any duplicate email_jobs rows
SELECT recipient_email, COUNT(*)
FROM email_jobs
GROUP BY recipient_email
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

---

## 7. Assumptions, Trade-offs & Known Limits

| Topic | Decision | Rationale |
|---|---|---|
| **Email provider** | Ethereal (fake SMTP) | Required by assignment — not suitable for real sending |
| **Multiple campaigns → same recipient** | Allowed (two campaigns, two sends) | Assignment dedups within a campaign; cross-campaign sends are intentional |
| **Sender SMTP credentials storage** | Stored as plaintext in Postgres | Demo/assignment scope — production would use secrets management (AWS Secrets Manager, Vault) |
| **ES unavailability** | Non-fatal warning, search returns empty | Assignment requires ES indexing; made non-blocking so core scheduling never fails |
| **Slack unavailability** | Non-fatal warning, silently skipped | Notification is best-effort; email sending must never be blocked by Slack |
| **Rate limit window** | Clock-hour bucket (e.g. 14:00–15:00) | Simpler than sliding window, matches the assignment spec |
| **Frontend auth** | Express-session cookie (not JWT) | Simpler, httpOnly, no token management on client |
| **Worker process** | Embedded in same Express process | Acceptable for assignment; production would run as a separate service |
| **Elasticsearch security** | `xpack.security.enabled=false` in docker-compose | Demo only — production must enable TLS + authentication |
| **Bull Board auth** | HTTP Basic Auth (password in env) | Simple, sufficient for demo; production would use OAuth or IP allowlist |
| **CSV upload** | Client-side parse (PapaParse) + backend `/parse-csv` endpoint | Both paths available; UI uses client-side for immediate feedback |

---

## 8. Deployment Notes

> This section documents production deployment intent — not implemented in this submission.

### Recommended architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Load Balancer / CDN            │
                    └──────┬──────────────────────┬───────────┘
                           │                      │
              ┌────────────▼───────┐   ┌──────────▼────────┐
              │   API Service      │   │  Frontend (Next.js)│
              │   (Express :4000)  │   │  (Static / Vercel) │
              │   × 2+ replicas    │   └───────────────────-┘
              └────────────┬───────┘
                           │ (shared Redis)
              ┌────────────▼───────┐
              │   Worker Service   │
              │   (BullMQ worker)  │
              │   × N replicas     │
              └────────────────────┘
                     │          │          │
              ┌──────▼──┐ ┌────▼────┐ ┌───▼──────────┐
              │Postgres │ │ Redis   │ │Elasticsearch │
              │(managed)│ │(managed)│ │  (managed)   │
              └─────────┘ └─────────┘ └──────────────┘
```

### Key production changes

1. **Separate API and Worker** — split `app.ts` so the worker process runs
   independently. This allows independent scaling and prevents a slow worker
   from blocking API responses.

2. **Environment secrets** — use AWS Secrets Manager, GCP Secret Manager, or
   HashiCorp Vault for `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`,
   `SLACK_CLIENT_SECRET`, and SMTP passwords. Never bake secrets into Docker images.

3. **Session store** — replace the default in-memory session store with
   `connect-redis` (already have Redis) or `connect-pg-simple` so sessions
   survive API restarts.

4. **Redis persistence** — enable Redis AOF (`appendonly yes` — already in
   docker-compose) on managed Redis (ElastiCache, Upstash) with automatic
   failover.

5. **Elasticsearch** — enable `xpack.security.enabled=true`, configure TLS,
   use a managed service (Elastic Cloud, AWS OpenSearch).

6. **HTTPS** — terminate TLS at the load balancer. Set `cookie.secure = true`
   and `cookie.sameSite = 'strict'` in Express session config.

7. **Postgres migrations** — run `npm run migrate` as a pre-deploy step (not
   at runtime) using a dedicated migration role with limited permissions.

8. **Health checks** — add `/health/ready` (checks DB + Redis connectivity)
   alongside the existing `/health/live` for Kubernetes liveness/readiness probes.

9. **Logging** — replace `console.log` with a structured logger (pino, winston)
   that emits JSON logs consumable by Datadog / CloudWatch / Loki.

10. **Rate-limit window** — consider migrating from clock-hour buckets to a true
    sliding window (Redis ZSET or token bucket) for more granular control in
    production workloads.
