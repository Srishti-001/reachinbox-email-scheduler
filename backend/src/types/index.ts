// ============================================================
// ENUMS
// ============================================================

export enum EmailJobStatus {
  SCHEDULED    = 'scheduled',
  QUEUED       = 'queued',
  SENDING      = 'sending',
  SENT         = 'sent',
  FAILED       = 'failed',
  RATE_LIMITED = 'rate_limited',
}

export enum CampaignStatus {
  PENDING   = 'pending',
  RUNNING   = 'running',
  PAUSED    = 'paused',
  COMPLETED = 'completed',
  FAILED    = 'failed',
}

// ============================================================
// DATABASE ROW TYPES
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  google_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

export interface SlackConnection {
  id: string;
  user_id: string;
  access_token: string;
  team_id: string;
  team_name: string | null;
  webhook_url: string | null;
  channel: string | null;
  bot_user_id: string | null;
  scope: string | null;
  connected_at: Date;
  updated_at: Date;
}

export interface SenderAccount {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  created_at: Date;
}

export interface Campaign {
  id: string;
  user_id: string;
  sender_account_id: string;
  subject: string;
  body: string;
  total_recipients: number;
  scheduled_start: Date;
  delay_between_ms: number;
  hourly_limit: number;
  status: CampaignStatus;
  created_at: Date;
  updated_at: Date;
}

export interface EmailJob {
  id: string;
  campaign_id: string;
  recipient_email: string;
  recipient_name: string | null;
  bullmq_job_id: string | null;
  scheduled_at: Date;
  sent_at: Date | null;
  status: EmailJobStatus;
  error_message: string | null;
  attempt_count: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================
// BULLMQ JOB PAYLOAD
// ============================================================

export interface EmailJobPayload {
  emailJobId: string;           // UUID from email_jobs — the primary idempotency key
  campaignId: string;
  userId: string;
  senderAccountId: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  body: string;
  scheduledAt: string;          // ISO8601
  delayBetweenMs: number;
  hourlyLimit: number;
}

// ============================================================
// API TYPES
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Lead {
  email: string;
  name?: string;
}

// ============================================================
// EXPRESS SESSION AUGMENTATION
// ============================================================

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

