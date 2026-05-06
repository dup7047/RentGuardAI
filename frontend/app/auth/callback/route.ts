import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

const allowedRedirects = new Set(['/dashboard']);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/dashboard';
  const redirectPath = allowedRedirects.has(next) ? next : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
    }
  }

  return NextResponse.redirect(
    new URL('/login?authError=callback', requestUrl.origin),
  );
}
