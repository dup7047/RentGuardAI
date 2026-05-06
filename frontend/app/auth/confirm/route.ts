import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

const allowedRedirects = new Set(['/dashboard']);

function getRedirectPath(requestUrl: URL) {
  const next = requestUrl.searchParams.get('next');

  if (next && allowedRedirects.has(next)) {
    return next;
  }

  const redirectTo = requestUrl.searchParams.get('redirect_to');

  if (!redirectTo) {
    return '/dashboard';
  }

  try {
    const redirectUrl = new URL(redirectTo, requestUrl.origin);
    const callbackNext = redirectUrl.searchParams.get('next');

    if (callbackNext && allowedRedirects.has(callbackNext)) {
      return callbackNext;
    }

    if (
      redirectUrl.origin === requestUrl.origin &&
      allowedRedirects.has(redirectUrl.pathname)
    ) {
      return redirectUrl.pathname;
    }
  } catch {
    return '/dashboard';
  }

  return '/dashboard';
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type');
  const redirectPath = getRedirectPath(requestUrl);

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });

    if (!error) {
      return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
    }
  }

  return NextResponse.redirect(
    new URL('/login?authError=callback', requestUrl.origin),
  );
}
