export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type EmailJobStatus =
  | 'scheduled'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'rate_limited';

export type CampaignStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export interface Campaign {
  id: string;
  subject: string;
  status: CampaignStatus;
  total_recipients: number;
  scheduled_start: string;
  created_at: string;
}

export interface EmailJob {
  id: string;
  campaign_id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  scheduled_at: string;
  sent_at: string | null;
  status: EmailJobStatus;
  error_message: string | null;
}

export interface Lead {
  email: string;
  name?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface SenderAccount {
  id: string;
  display_name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  created_at: string;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channel?: string;
}

export interface ComposeFormValues {
  senderAccountId: string;
  subject: string;
  body: string;
  scheduledStart: string;
  delayBetweenMs: number;
  hourlyLimit: number;
}
