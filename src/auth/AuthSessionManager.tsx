import * as React from 'react';
import { loglev } from '@/core/logger/log';
import { supabaseClient } from '@/core/supabase';
import { useStore } from '@/core/zustand';

const logger = loglev.getLogger('auth');
logger.setLevel('debug');

export interface IAuthSessionManagerProps {}

export function AuthSessionManager(_props: IAuthSessionManagerProps) {
  const setSession = useStore(state => state.setSession);

  React.useEffect(() => {
    console.log('[AUTH DEBUG] Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
    console.log('[AUTH DEBUG] Anon key present:', !!import.meta.env.VITE_SUPABASE_ANON_KEY);
    console.log('[AUTH DEBUG] Anon key starts with:', import.meta.env.VITE_SUPABASE_ANON_KEY?.substring(0, 20));

    supabaseClient.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        console.log('[AUTH DEBUG] getSession result:', { session, error });
        logger.log('Loading Session:', session);
        setSession(session);
      })
      .catch(err => {
        console.error('[AUTH DEBUG] getSession error:', err);
        console.warn('No session', err);
      });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      console.log('[AUTH DEBUG] onAuthStateChange event:', event);
      console.log('[AUTH DEBUG] onAuthStateChange session:', session);
      // Load factories from remote
      logger.info('Loading session from remote', event);
      // await loadFromRemote(session);
      logger.log('Session Loaded from remote', session);

      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  return null;
}
