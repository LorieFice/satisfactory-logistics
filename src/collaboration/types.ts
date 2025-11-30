import type { SerializedGame } from '@/games/store/gameFactoriesActions';

export interface Collaborator {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface GameCollaborationState {
  /** Whether the game is synced to remote */
  isSynced: boolean;
  /** Whether a sync operation is in progress */
  isSyncing: boolean;
  /** Whether we're subscribed to realtime updates */
  isSubscribed: boolean;
  /** Last sync error, if any */
  syncError: string | null;
  /** List of collaborators who have access to the game */
  collaborators: Collaborator[];
}

export interface RemoteGameUpdate {
  savedId: string;
  data: SerializedGame;
  version: number;
  updatedAt: string;
}

export interface SyncResult {
  success: boolean;
  version?: number;
  error?: string;
}
