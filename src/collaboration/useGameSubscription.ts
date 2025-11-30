import { supabaseClient } from '@/core/supabase';
import { useStore } from '@/core/zustand';
import type { SerializedGame } from '@/games/store/gameFactoriesActions';
import { loglev } from '@/core/logger/log';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { mergeGameState } from './mergeGameState';
import { serializeGame } from '@/games/store/gameFactoriesActions';
import { cancelPendingSync } from './syncManager';

const logger = loglev.getLogger('collaboration:subscription');

/**
 * Hook to subscribe to realtime updates for a game.
 * When another user makes changes, this will automatically update the local state.
 *
 * @param gameId - Local game ID to watch
 */
export function useGameSubscription(gameId: string | null | undefined) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const game = useStore(state => (gameId ? state.games.games[gameId] : null));
  const savedId = game?.savedId;

  useEffect(() => {
    if (!savedId) {
      return;
    }

    logger.info('Subscribing to game updates', { savedId, gameId });

    const channel = supabaseClient
      .channel(`game:${savedId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${savedId}`,
        },
        payload => {
          handleRemoteUpdate(gameId!, payload.new as RemoteGameRow);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${savedId}`,
        },
        () => {
          handleRemoteDelete(gameId!);
        },
      )
      .subscribe(status => {
        logger.info('Subscription status changed', { status, savedId });
        if (status === 'SUBSCRIBED') {
          useStore.getState().setSubscriptionState(gameId!, true);
        } else {
          useStore.getState().setSubscriptionState(gameId!, false);
        }
      });

    channelRef.current = channel;

    return () => {
      logger.info('Unsubscribing from game updates', { savedId });
      channel.unsubscribe();
      channelRef.current = null;
      if (gameId) {
        useStore.getState().setSubscriptionState(gameId, false);
      }
    };
  }, [savedId, gameId]);

  return channelRef;
}

interface RemoteGameRow {
  id: string;
  data: SerializedGame;
  version: number;
  author_id: string;
  updated_at: string;
}

function handleRemoteUpdate(gameId: string, remote: RemoteGameRow) {
  const state = useStore.getState();
  const localGame = state.games.games[gameId];

  if (!localGame) {
    logger.warn('Received update for unknown game', { gameId });
    return;
  }

  const localVersion = localGame.version ?? 1;
  const remoteVersion = remote.version;

  logger.info('Received remote update', {
    gameId,
    localVersion,
    remoteVersion,
  });

  // Only apply if remote version is newer
  if (remoteVersion <= localVersion) {
    logger.debug('Ignoring update, local version is same or newer');
    return;
  }

  // Cancel any pending sync to avoid overwriting the remote changes
  cancelPendingSync();

  // Get current local state for merging
  const localSerialized = serializeGame(gameId);
  const remoteSerialized = remote.data;

  // Merge local and remote states
  const merged = mergeGameState(localSerialized, remoteSerialized);

  // Apply the merged state
  useStore.getState().applyRemoteGameUpdate(
    gameId,
    merged,
    remoteVersion,
  );

  logger.info('Applied remote update', { gameId, newVersion: remoteVersion });
}

function handleRemoteDelete(gameId: string) {
  logger.warn('Game was deleted remotely', { gameId });

  // The game owner deleted the game - remove it locally
  const state = useStore.getState();
  const game = state.games.games[gameId];

  if (game) {
    // Check if current user is not the owner
    const session = state.auth.session;
    if (session && game.authorId !== session.user.id) {
      // This was a shared game that got deleted by owner
      useStore.getState().removeGame(gameId);
    }
  }
}

/**
 * Hook to subscribe to all games the user has access to.
 * Use this on the games list page to show real-time updates.
 */
export function useAllGamesSubscription() {
  const session = useStore(state => state.auth.session);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!session?.user.id) {
      return;
    }

    logger.info('Subscribing to all user games');

    // Subscribe to games where user is author or has shared access
    const channel = supabaseClient
      .channel('user-games')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
          filter: `author_id=eq.${session.user.id}`,
        },
        payload => {
          logger.debug('Own game changed', { event: payload.eventType });
          // Could trigger a refresh of the games list here if needed
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [session?.user.id]);

  return channelRef;
}
