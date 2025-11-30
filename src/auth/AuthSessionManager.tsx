import * as React from 'react';
import { loglev } from '@/core/logger/log';
import { supabaseClient, refreshSession } from '@/core/supabase';
import { useStore } from '@/core/zustand';

const logger = loglev.getLogger('auth');
logger.setLevel('debug');

export interface IAuthSessionManagerProps {}

// Refresh token 5 minutes before expiry
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function AuthSessionManager(_props: IAuthSessionManagerProps) {
  const setSession = useStore(state => state.setSession);
  const refreshTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTokenRefresh = React.useCallback((expiresAt: number) => {
    // Clear any existing timeout
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    const now = Date.now() / 1000; // Convert to seconds
    const timeUntilExpiry = (expiresAt - now) * 1000; // Convert to ms
    const refreshIn = Math.max(timeUntilExpiry - REFRESH_MARGIN_MS, 0);

    logger.info(`Token expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes, scheduling refresh in ${Math.round(refreshIn / 1000 / 60)} minutes`);

    refreshTimeoutRef.current = setTimeout(async () => {
      logger.info('Proactively refreshing token...');
      const newSession = await refreshSession();
      if (newSession) {
        logger.info('Token refreshed successfully');
        setSession(newSession);
        // Schedule next refresh
        if (newSession.expires_at) {
          scheduleTokenRefresh(newSession.expires_at);
        }
      } else {
        logger.warn('Failed to refresh token, user may need to re-login');
      }
    }, refreshIn);
  }, [setSession]);

  React.useEffect(() => {
    supabaseClient.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        logger.log('Loading Session:', session);
        if (error) {
          logger.error('getSession error:', error);
        }
        setSession(session);

        // Schedule proactive token refresh
        if (session?.expires_at) {
          scheduleTokenRefresh(session.expires_at);
        }
      })
      .catch(err => {
        console.error('[AUTH DEBUG] getSession error:', err);
        console.warn('No session', err);
      });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      logger.info('Auth state changed:', event);

      if (event === 'TOKEN_REFRESHED') {
        logger.info('Token was refreshed');
      }

      if (event === 'SIGNED_OUT') {
        // Clear refresh timeout on sign out
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
      }

      setSession(session);

      // Schedule proactive token refresh for new sessions
      if (session?.expires_at && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        scheduleTokenRefresh(session.expires_at);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [setSession, scheduleTokenRefresh]);

  return null;
}
