# Restart-Safety Test — ReachInbox Email Scheduler

This document walks through a full manual verification that the scheduler
survives a hard process kill mid-run without losing any jobs, sending
duplicates, or dropping Slack notifications incorrectly.

---

## Prerequisites

All services must be running:

```powershell
# Terminal 1 — Infrastructure
docker-compose up -d

# Terminal 2 — Backend (dev server)
cd backend && npm run dev

# Terminal 3 — Frontend (optional, for dashboard verification)
cd frontend && npm run dev
```

Confirm health:
```powershell
curl http://localhost:4000/health
# → {"status":"ok"}

curl http://localhost:9200/_cluster/health
# → {"status":"green"} or "yellow" (both fine for single-node)
```

---

## Step 1 — Set up test conditions

### 1a. Lower the rate limit temporarily

In `backend/.env`:
```
MAX_EMAILS_PER_HOUR=2
```
Restart the backend. This makes the rate limit easy to hit with 3 recipients.

### 1b. Confirm you have at least one sender account

```powershell
# (must be logged in — replace cookie value)
curl -b "connect.sid=<your-session>" http://localhost:4000/api/senders
```

If empty, create one via the Compose modal or:
```powershell
curl -X POST http://localhost:4000/api/senders \
  -b "connect.sid=<your-session>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Test Sender",
    "email": "test@ethereal.email",
    "smtpHost": "smtp.ethereal.email",
    "smtpPort": 587,
    "smtpUser": "<ethereal-user>",
    "smtpPass": "<ethereal-pass>"
  }'
```

---

## Step 2 — Schedule a campaign with staggered sends

Schedule 4 recipients with a **30-second delay** between them, starting **1 minute from now**:

```powershell
$START = (Get-Date).AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:ss")

curl -X POST http://localhost:4000/api/campaigns \
  -b "connect.sid=<your-session>" \
  -H "Content-Type: application/json" \
  -d "{
    \"senderAccountId\": \"<sender-uuid>\",
    \"subject\": \"Restart Safety Test\",
    \"body\": \"Hello, this is a restart-safety test email.\",
    \"recipients\": [
      {\"email\": \"recipient1@test.com\"},
      {\"email\": \"recipient2@test.com\"},
      {\"email\": \"recipient3@test.com\"},
      {\"email\": \"recipient4@test.com\"}
    ],
    \"scheduledStart\": \"${START}Z\",
    \"delayBetweenMs\": 30000,
    \"hourlyLimit\": 2
  }"
```

**Expected response:**
```json
{
  "success": true,
  "data": { "campaignId": "...", "totalQueued": 4, "skipped": 0 }
}
```

### Verify jobs exist in Bull Board
Open: http://localhost:4000/bull-ui  
Password: `admin` (or your `BULL_BOARD_PASSWORD`)  
→ You should see 4 **Delayed** jobs with staggered timestamps.

### Verify DB rows exist
```sql
SELECT id, recipient_email, status, scheduled_at, bullmq_job_id
FROM email_jobs
ORDER BY scheduled_at;
-- All 4 rows should have status='queued' and a bullmq_job_id
```

---

## Step 3 — Kill the server mid-run

Wait until **recipient1** and **recipient2** have been sent (watch server logs:
`[Worker] ✅ Sent to recipient1@test.com`), then **immediately kill the backend**:

```powershell
# Find and kill the node process
Get-Process node | Stop-Process -Force
```

At this point:
- `recipient1`, `recipient2` → **sent** (status='sent' in DB)
- `recipient3` → **rate_limited** (hourly limit=2 was hit, re-delayed)
- `recipient4` → **queued** in Redis but not yet processed

---

## Step 4 — Verify pre-restart state

```sql
SELECT recipient_email, status, bullmq_job_id, sent_at
FROM email_jobs
ORDER BY scheduled_at;
```

Expected:
| recipient_email   | status       | bullmq_job_id | sent_at    |
|---|---|---|---|
| recipient1@test   | sent         | email-{uuid}  | timestamp  |
| recipient2@test   | sent         | email-{uuid}  | timestamp  |
| recipient3@test   | rate_limited | email-{uuid}  | NULL       |
| recipient4@test   | queued       | email-{uuid}  | NULL       |

---

## Step 5 — Restart the backend

```powershell
cd backend && npm run dev
```

Watch the startup logs:
```
[Bootstrap] Running restart reconciler...
[Bootstrap] Found 2 non-terminal job(s) to reconcile
[Bootstrap] ✅ Done — 0 re-enqueued, 2 already live in Redis, 0 'sending' rows reset to 'queued'
```

> **Why 0 re-enqueued?** Recipients 3 and 4 still have their jobs in Redis
> (they were delayed, not consumed). The reconciler finds them live and skips
> re-enqueue. If Redis was also restarted (next scenario), it would re-enqueue.

---

## Step 6 — Verify after restart (Redis intact)

### 6a. Bull Board
→ Recipients 3 and 4 should still appear as **Delayed** with their original timestamps.

### 6b. Wait for recipient3 and 4 to fire
Watch logs. They should fire at their scheduled times.

### 6c. No duplicates in DB
```sql
SELECT recipient_email, COUNT(*) FROM email_jobs
WHERE campaign_id = '<campaign-id>'
GROUP BY recipient_email;
-- Every count must be exactly 1
```

### 6d. No duplicate sends on Ethereal
Each recipient's Ethereal inbox should contain exactly one message.
Preview URLs appear in server logs: `preview: https://ethereal.email/message/...`

---

## Step 7 — Redis flush scenario (harder test)

Simulate Redis being flushed (e.g. a Redis restart with no persistence):

```powershell
# Kill Redis container
docker stop reachinbox-redis

# Schedule a new campaign with 3 recipients (before kill)
# ... (repeat Step 2 with new recipients)

# Wait for 1 recipient to send, then stop backend
Get-Process node | Stop-Process -Force

# Flush Redis
docker start reachinbox-redis
docker exec reachinbox-redis redis-cli FLUSHALL

# Restart backend
cd backend && npm run dev
```

Watch startup logs:
```
[Bootstrap] Found 2 non-terminal job(s) to reconcile
[Bootstrap] ✅ Done — 2 re-enqueued, 0 already live in Redis, 0 'sending' rows reset to 'queued'
```

→ Both unsent recipients are re-enqueued with **zero delay** (past-due) and fire immediately.
→ The already-sent recipient is **skipped** (status='sent' in DB → worker step-0 idempotency guard).

---

## Step 8 — Verify no duplicate Slack notifications

If Slack was connected and a rate-limit hit fired a notification before the restart:

1. Check your Slack channel — it should have **exactly one** notification per rate-limit event.
2. After restart, if recipients 3/4 hit the limit again in the new window, **one more** notification fires (correct — it's a new hourly window).
3. The notification uses a fresh DB lookup every time — no stale cache.

---

## Step 9 — Double-POST idempotency test

Call `POST /api/campaigns` **twice** with identical recipients:

```powershell
# Call 1 — succeeds, creates campaign + 3 jobs
curl -X POST ... (same payload as Step 2)

# Call 2 — creates a NEW campaign row but each email_jobs INSERT
# hits UNIQUE(campaign_id, recipient_email) — which only applies
# within the same campaign. Two campaigns CAN have the same recipients.
# This is the intended behavior: each campaign is independent.
```

To test true idempotency within a campaign (e.g. a crash during enqueue):
```sql
-- Simulate partial write: clear bullmq_job_id for one row
UPDATE email_jobs SET bullmq_job_id = NULL WHERE recipient_email = 'recipient3@test.com';

-- Restart backend → reconciler re-enqueues only this row
```

---

## Checklist Summary

| Scenario | Expected Result | Verified |
|---|---|---|
| Server kill after 2/4 sends | Recipients 3+4 fire at original time | ☐ |
| No duplicate emails after restart | DB count = 1 per recipient per campaign | ☐ |
| No duplicate BullMQ jobs | Bull Board shows no duplicate job IDs | ☐ |
| Redis flush + restart | Unsent jobs re-enqueued, sent jobs skipped | ☐ |
| 'sending' row after crash | Reset to 'queued', retried, idempotency guard runs | ☐ |
| Double POST /api/campaigns | Two campaigns created (each idempotent internally) | ☐ |
| Slack notification not duplicated | Exactly one notification per rate-limit event | ☐ |
| ES search after restart | Previously indexed docs still searchable | ☐ |
