import type { Json } from '@/core/database.types';
import { supabaseClient } from '@/core/supabase';
import { useStore } from '@/core/zustand';
import { serializeGame } from '@/games/store/gameFactoriesActions';
import { debounce } from 'lodash';
import { loglev } from '@/core/logger/log';

const logger = loglev.getLogger('collaboration:sync');

const SYNC_DEBOUNCE_MS = 1000;

/**
 * Debounced function to sync a game to the remote database.
 * Waits for 1 second of inactivity before syncing to avoid excessive API calls.
 */
export const syncGameToRemote = debounce(async (gameId: string) => {
  const state = useStore.getState();
  const game = state.games.games[gameId];

  if (!game?.savedId) {
    logger.debug('Game not saved to remote yet, skipping sync', { gameId });
    return;
  }

  const session = state.auth.session;
  if (!session) {
    logger.debug('No session, skipping sync');
    return;
  }

  try {
    useStore.getState().setSyncingState(gameId, true);

    const serialized = serializeGame(gameId);
    const currentVersion = game.version ?? 1;

    logger.info('Syncing game to remote', {
      gameId,
      savedId: game.savedId,
      currentVersion,
    });

    const { data, error } = await supabaseClient
      .from('games')
      .update({
        data: serialized as unknown as Json,
        version: currentVersion + 1,
        name: game.name,
      })
      .eq('id', game.savedId)
      .select('version')
      .single();

    if (error) {
      logger.error('Sync failed', { error });
      useStore.getState().setSyncError(gameId, error.message);
      return;
    }

    logger.info('Sync successful', { newVersion: data.version });
    useStore.getState().setGameVersion(gameId, data.version);
    useStore.getState().setSyncError(gameId, null);
  } catch (error) {
    logger.error('Sync error', { error });
    useStore.getState().setSyncError(gameId, String(error));
  } finally {
    useStore.getState().setSyncingState(gameId, false);
  }
}, SYNC_DEBOUNCE_MS);

/**
 * Triggers a sync for the currently selected game.
 * Call this after any local state mutation that should be synced.
 */
export function triggerSync(gameId?: string | null) {
  const targetGameId = gameId ?? useStore.getState().games.selected;
  if (targetGameId) {
    const game = useStore.getState().games.games[targetGameId];
    // Only sync if game is saved to remote
    if (game?.savedId) {
      syncGameToRemote(targetGameId);
    }
  }
}

/**
 * Immediately syncs a game without debouncing.
 * Use this for critical saves (e.g., before navigating away).
 */
export async function syncGameImmediately(gameId: string): Promise<boolean> {
  syncGameToRemote.cancel();

  const state = useStore.getState();
  const game = state.games.games[gameId];

  if (!game?.savedId) {
    return false;
  }

  const session = state.auth.session;
  if (!session) {
    return false;
  }

  try {
    useStore.getState().setSyncingState(gameId, true);

    const serialized = serializeGame(gameId);
    const currentVersion = game.version ?? 1;

    const { data, error } = await supabaseClient
      .from('games')
      .update({
        data: serialized as unknown as Json,
        version: currentVersion + 1,
        name: game.name,
      })
      .eq('id', game.savedId)
      .select('version')
      .single();

    if (error) {
      useStore.getState().setSyncError(gameId, error.message);
      return false;
    }

    useStore.getState().setGameVersion(gameId, data.version);
    useStore.getState().setSyncError(gameId, null);
    return true;
  } catch (error) {
    useStore.getState().setSyncError(gameId, String(error));
    return false;
  } finally {
    useStore.getState().setSyncingState(gameId, false);
  }
}

/**
 * Cancels any pending sync operations.
 */
export function cancelPendingSync() {
  syncGameToRemote.cancel();
}
