import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const rawKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

const cleanUrl = (url?: string): string => {
  if (!url) return 'https://placeholder-project.supabase.co';
  const match = url.match(/https?:\/\/[^\s"'`]+/);
  return match ? match[0] : url.trim();
};

const cleanKey = (key?: string): string => {
  if (!key) return 'placeholder-anon-key';
  return key.replace(/^[^\w.-]+/, '').trim();
};

const supabaseUrl = cleanUrl(rawUrl);
const supabaseAnonKey = cleanKey(rawKey);

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    !supabaseUrl.includes('placeholder-project') &&
    supabaseAnonKey &&
    !supabaseAnonKey.includes('placeholder-anon-key')
  );
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
