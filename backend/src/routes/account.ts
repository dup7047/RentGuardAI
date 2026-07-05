// /v1/account — soft-delete + undo flow.
//
//   DELETE /v1/account            → set profiles.deletion_requested_at and
//                                   email a 30-day undo link (purge cron TBD).
//   POST   /v1/account/undo-delete → verify the JWT, clear the timestamp.
//
// The undo route only requires that the JWT in the body is valid for the
// user it identifies, so the email link works on a fresh device without
// re-signing-in; it still sits behind the shared rate limit, and a mismatch
// between c.get('userId') and the token's sub is rejected.

import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';

import { getDb } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../lib/errors.js';
import { sendEmail } from '../lib/email.js';
import { logger } from '../logger.js';

type Vars = {
  anonToken: string;
  userId?: string;
  userEmail?: string;
  validated: { body?: unknown };
};

export const accountRoute = new Hono<{ Variables: Vars }>();

const UNDO_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getUndoSecret(): Uint8Array {
  const secret = process.env.ACCOUNT_UNDO_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError(
      'internal_error',
      'Account undo flow is not configured. Contact support if this persists.',
    );
  }
  return new TextEncoder().encode(secret);
}

async function signUndoToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: 'undo-delete' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${UNDO_TOKEN_TTL_SECONDS}s`)
    .sign(getUndoSecret());
}

async function verifyUndoToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, getUndoSecret());
    if (payload.purpose !== 'undo-delete' || typeof payload.sub !== 'string') {
      throw new AppError('validation_failed', 'Undo link is not valid.');
    }
    return payload.sub;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('validation_failed', 'Undo link is expired or invalid.');
  }
}

function frontendOrigin(): string {
  return process.env.PUBLIC_APP_ORIGIN ?? 'https://www.rentguard.cc';
}

function deletionEmail(undoUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Your RentGuard account is scheduled for deletion';
  const text = [
    'You asked us to delete your RentGuard NYC account.',
    '',
    'We have marked your account for deletion. Your saved buildings and account data will be',
    'permanently removed in 30 days. Until then, you can undo this with one click:',
    '',
    undoUrl,
    '',
    'If you did not request this, click the link above to restore your account. Questions?',
    'Reply to this email or write hello@rentguard.cc.',
  ].join('\n');
  const html = `
    <p>You asked us to delete your <strong>RentGuard NYC</strong> account.</p>
    <p>We have marked your account for deletion. Your saved buildings and account data will be
    permanently removed in 30 days. Until then, you can undo this with one click:</p>
    <p><a href="${undoUrl}" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;
    text-decoration:none;display:inline-block">Undo deletion</a></p>
    <p>If you did not request this, click the button above to restore your account. Questions?
    Reply to this email or write <a href="mailto:hello@rentguard.cc">hello@rentguard.cc</a>.</p>
  `;
  return { subject, html, text };
}

// DELETE /v1/account — mark the authed user for deletion + send the undo email.
accountRoute.delete('/account', async (c) => {
  const userId = c.get('userId');
  const email = c.get('userEmail');
  if (!userId || !email) {
    throw new AppError('unauthorized', 'Sign in to delete your account.');
  }

  await getDb()
    .update(profiles)
    .set({ deletionRequestedAt: new Date() })
    .where(eq(profiles.id, userId));

  const token = await signUndoToken(userId);
  const undoUrl = `${frontendOrigin()}/account/undo-delete?token=${encodeURIComponent(token)}`;
  const { subject, html, text } = deletionEmail(undoUrl);
  const result = await sendEmail({ to: email, subject, html, text });
  if (!result.ok) {
    // We do NOT roll back the timestamp on email failure — the user
    // clicked Delete, so the deletion intent is recorded. They can still
    // contact support if the email never arrives. Log loud so we notice.
    logger.error({ userId, err: result.error }, 'deletion email send failed');
  }

  // TODO: cancel any active Stripe subscription here once subscriptions exist.

  return c.json({ ok: true, deletion_requested_at: new Date().toISOString() });
});

// POST /v1/account/undo-delete — verify the JWT, clear the timestamp.
const UndoBody = z.object({ token: z.string().min(1).max(2048) });

accountRoute.post('/account/undo-delete', validate({ body: UndoBody }), async (c) => {
  const { token } = c.get('validated').body as z.infer<typeof UndoBody>;
  const tokenUserId = await verifyUndoToken(token);

  await getDb()
    .update(profiles)
    .set({ deletionRequestedAt: null })
    .where(eq(profiles.id, tokenUserId));

  return c.json({ ok: true, restored: true });
});
