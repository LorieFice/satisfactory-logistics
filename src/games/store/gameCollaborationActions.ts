import { loglev } from '@/core/logger/log';
import { createActions } from '@/core/zustand-helpers/actions';
import type { SerializedGame } from './gameFactoriesActions';

const logger = loglev.getLogger('games:collaboration');

export const gameCollaborationActions = createActions({
  /**
   * Sets the version of a game after a successful sync.
   */
  setGameVersion: (gameId: string, version: number) => state => {
    if (state.games.games[gameId]) {
      state.games.games[gameId].version = version;
    }
  },

  /**
   * Sets the syncing state for a game.
   */
  setSyncingState: (gameId: string, isSyncing: boolean) => state => {
    // We'll store this in gameSave for now to avoid adding new state structure
    // This is a simple flag to show UI feedback
    if (isSyncing) {
      state.gameSave.isSaving = true;
    } else {
      state.gameSave.isSaving = false;
    }
  },

  /**
   * Sets a sync error for a game.
   */
  setSyncError: (_gameId: string, _error: string | null) => _state => {
    // For now, we'll just log errors. Could add error state later.
    if (_error) {
      logger.error('Sync error for game', { gameId: _gameId, error: _error });
    }
  },

  /**
   * Sets the subscription state for a game.
   */
  setSubscriptionState: (_gameId: string, _isSubscribed: boolean) => _state => {
    // Track subscription state - could add to game object if needed
    logger.debug('Subscription state changed', {
      gameId: _gameId,
      isSubscribed: _isSubscribed,
    });
  },

  /**
   * Applies a remote game update, merging with local state.
   * This is called when we receive a realtime update from Supabase.
   */
  applyRemoteGameUpdate:
    (gameId: string, merged: SerializedGame, version: number) => state => {
      const localGame = state.games.games[gameId];
      if (!localGame) {
        logger.warn('Cannot apply remote update: game not found', { gameId });
        return;
      }

      logger.info('Applying remote game update', {
        gameId,
        version,
        factoryCount: merged.factories.length,
      });

      // Clear old factories that are no longer in the merged state
      const mergedFactoryIds = new Set(merged.factories.map(f => f.id));
      for (const factoryId of localGame.factoriesIds) {
        if (!mergedFactoryIds.has(factoryId)) {
          delete state.factories.factories[factoryId];
          delete state.solvers.instances[factoryId];
        }
      }

      // Apply merged game state
      state.games.games[gameId] = {
        ...localGame,
        ...merged.game,
        // Preserve local-only fields
        savedId: localGame.savedId,
        authorId: localGame.authorId,
        shareToken: localGame.shareToken,
        createdAt: localGame.createdAt,
        // Update version
        version,
      };

      // Apply merged factories
      for (const factory of merged.factories) {
        state.factories.factories[factory.id] = factory;
      }

      // Apply merged solvers
      for (const solver of merged.solvers ?? []) {
        state.solvers.instances[solver.id] = solver;
      }
    },
});
