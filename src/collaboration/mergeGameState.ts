import type { Factory } from '@/factories/Factory';
import type { SerializedGame } from '@/games/store/gameFactoriesActions';
import type { SolverInstance } from '@/solver/store/Solver';

/**
 * Merges local and remote game states with factory-level conflict resolution.
 *
 * Strategy:
 * - New factories from both local and remote are kept (union)
 * - For factories that exist in both, remote version wins (last-write-wins)
 * - Deleted factories: if remote doesn't have it but local does, it's deleted
 *
 * @param local - Local game state
 * @param remote - Remote game state (from Supabase)
 * @returns Merged game state
 */
export function mergeGameState(
  local: SerializedGame,
  remote: SerializedGame,
): SerializedGame {
  const remoteFactoryIds = new Set(remote.factories.map(f => f.id));

  // Find factories that only exist locally (newly created by this user)
  const localOnlyFactories = local.factories.filter(f => !remoteFactoryIds.has(f.id));
  const localOnlyFactoryIds = new Set(localOnlyFactories.map(f => f.id));

  // Find solvers for local-only factories (solver.id equals factory.id)
  const localOnlySolvers = local.solvers.filter(s => localOnlyFactoryIds.has(s.id));

  // Merge factories: remote factories + local-only factories
  const mergedFactories: Factory[] = [
    ...remote.factories,
    ...localOnlyFactories,
  ];

  // Merge solvers: remote solvers + local-only solvers
  const remoteSolverIds = new Set(remote.solvers.map(s => s.id));
  const mergedSolvers: SolverInstance[] = [
    ...remote.solvers,
    ...localOnlySolvers.filter(s => !remoteSolverIds.has(s.id)),
  ];

  // Merge factory IDs in game object
  const mergedFactoryIds = [
    ...remote.game.factoriesIds,
    ...localOnlyFactories.map(f => f.id),
  ];

  return {
    game: {
      ...remote.game,
      factoriesIds: mergedFactoryIds,
    },
    factories: mergedFactories,
    solvers: mergedSolvers,
  };
}

/**
 * Checks if local state has unsaved changes compared to remote.
 * Returns true if there are local-only factories that haven't been synced.
 */
export function hasLocalChanges(
  local: SerializedGame,
  remote: SerializedGame,
): boolean {
  const remoteFactoryIds = new Set(remote.factories.map(f => f.id));

  // Check for local-only factories
  const hasLocalOnlyFactories = local.factories.some(f => !remoteFactoryIds.has(f.id));
  if (hasLocalOnlyFactories) return true;

  // Check for modified factories (basic check on factory count in case of deletions)
  if (local.factories.length !== remote.factories.length) return true;

  return false;
}

/**
 * Gets a list of factory IDs that were created locally but not yet synced.
 */
export function getLocalOnlyFactoryIds(
  local: SerializedGame,
  remote: SerializedGame,
): string[] {
  const remoteFactoryIds = new Set(remote.factories.map(f => f.id));
  return local.factories
    .filter(f => !remoteFactoryIds.has(f.id))
    .map(f => f.id);
}
