import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { SenderAccount } from '../types';
import { query } from '../config/db';

// ─────────────────────────────────────────────────────────────────────────────
// In-process cache: senderAccountId → Nodemailer transporter
// This avoids recreating the transport on every email send.
// ─────────────────────────────────────────────────────────────────────────────
const transporterCache = new Map<string, Transporter>();

/**
 * Creates (or returns cached) a Nodemailer transporter for a given sender
 * account. Uses the smtp_host/port/user/pass stored in the database — those
 * are Ethereal credentials generated at sender-creation time.
 */
function getTransporter(sender: SenderAccount): Transporter {
  const cached = transporterCache.get(sender.id);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    secure: false, // Ethereal uses STARTTLS on 587
    auth: {
      user: sender.smtp_user,
      pass: sender.smtp_pass,
    },
  });

  transporterCache.set(sender.id, transporter);
  return transporter;
}

/**
 * Creates a fresh Ethereal test account and returns it as a SenderAccount-
 * shaped object (without id / user_id — caller persists it).
 *
 * Use this when registering a new sender that has no existing SMTP credentials.
 * Each call contacts Ethereal's API once and caches nothing — call it at
 * sender-creation time and store the returned credentials in the DB.
 */
export async function createEtherealAccount(): Promise<{
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}> {
  const account = await nodemailer.createTestAccount();
  return {
    email:    account.user,
    smtpHost: account.smtp.host,
    smtpPort: account.smtp.port,
    smtpUser: account.user,
    smtpPass: account.pass,
  };
}

export interface SendResult {
  messageId: string;
  previewUrl: string | false; // Ethereal preview URL
}

/**
 * Sends a single email using the credentials stored for `senderAccountId`.
 * Falls back to the static ETHEREAL_USER / ETHEREAL_PASS env vars if the
 * sender row has no smtp_user (should not happen in production but useful
 * during early local testing).
 *
 * @throws Error if the send fails — caller (worker) catches and marks the job
 *   as failed in the DB.
 */
export async function sendEmail(
  senderAccountId: string,
  recipientEmail: string,
  recipientName: string | null,
  subject: string,
  body: string
): Promise<SendResult> {
  // Fetch sender credentials from DB
  const senderResult = await query<SenderAccount>(
    'SELECT * FROM sender_accounts WHERE id = $1',
    [senderAccountId]
  );

  let sender: SenderAccount;

  if (senderResult.rows.length === 0) {
    // Fallback: use static Ethereal credentials from .env
    // This should only happen if a sender was deleted after scheduling.
    if (!config.ethereal.user || !config.ethereal.pass) {
      throw new Error(`Sender account ${senderAccountId} not found and no fallback Ethereal credentials configured`);
    }
    sender = {
      id:           senderAccountId,
      user_id:      '',
      display_name: 'Ethereal Fallback',
      email:        config.ethereal.user,
      smtp_host:    'smtp.ethereal.email',
      smtp_port:    587,
      smtp_user:    config.ethereal.user,
      smtp_pass:    config.ethereal.pass,
      created_at:   new Date(),
    };
  } else {
    sender = senderResult.rows[0];
  }

  const transporter = getTransporter(sender);

  const toField = recipientName
    ? `"${recipientName.replace(/"/g, '\\"')}" <${recipientEmail}>`
    : recipientEmail;

  const info = await transporter.sendMail({
    from:    `"${sender.display_name}" <${sender.smtp_user}>`,
    to:      toField,
    subject,
    text:    body,
    html:    body.replace(/\n/g, '<br>'),
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);

  console.log(
    `[Mailer] ✉️  Sent to ${recipientEmail} | msgId=${info.messageId} | preview=${previewUrl}`
  );

  return { messageId: info.messageId, previewUrl };
}
