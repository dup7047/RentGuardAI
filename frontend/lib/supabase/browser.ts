'use client';

import { createBrowserClient } from '@supabase/ssr';

import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  supabaseCookieOptions,
} from './config';

export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      flowType: 'pkce',
    },
    cookieOptions: supabaseCookieOptions,
  });
}
