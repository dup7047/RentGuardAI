// Resend transactional email wrapper.
//
// Stub-safe: when RESEND_API_KEY is missing (local dev, CI without the
// secret) the wrapper logs the intent and returns success. Mirrors the
// pattern in routes/waitlist-email.ts so deploys without the env var don't
// 500 on transactional sends.

import { Resend } from 'resend';
import { logger } from '../logger.js';

const FROM_DEFAULT = 'RentGuard NYC <hello@rentguard.cc>';

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string };

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) {
    logger.warn({ to: input.to, subject: input.subject }, 'resend stub: would send email');
    return { ok: true, id: null };
  }
  const { data, error } = await client.emails.send({
    from: process.env.RESEND_FROM ?? FROM_DEFAULT,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (error) {
    logger.error({ err: error, to: input.to }, 'resend send failed');
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id ?? null };
}
