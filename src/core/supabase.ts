import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env file.',
  );
}

export const supabaseClient = createClient<Database>(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);

/**
 * Manually refresh the session token.
 * Call this when you get a JWT expired error.
 */
export async function refreshSession() {
  const { data, error } = await supabaseClient.auth.refreshSession();
  if (error) {
    console.error('Failed to refresh session:', error);
    // If refresh fails, the user needs to re-login
    return null;
  }
  return data.session;
}
