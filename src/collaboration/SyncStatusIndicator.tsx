import { useStore } from '@/core/zustand';
import { Badge, Tooltip } from '@mantine/core';
import { IconCloud, IconCloudCheck, IconCloudUpload } from '@tabler/icons-react';

export interface ISyncStatusIndicatorProps {
  gameId?: string | null;
}

export function SyncStatusIndicator({ gameId }: ISyncStatusIndicatorProps) {
  const isSaving = useStore(state => state.gameSave.isSaving);
  const game = useStore(state => state.games.games[gameId ?? state.games.selected ?? '']);
  const session = useStore(state => state.auth.session);

  // Don't show if no game or not logged in
  if (!game || !session) {
    return null;
  }

  // Game not saved to cloud yet
  if (!game.savedId) {
    return (
      <Tooltip label="Game not saved to cloud yet">
        <Badge
          size="sm"
          variant="light"
          color="gray"
          leftSection={<IconCloud size={12} />}
        >
          Local
        </Badge>
      </Tooltip>
    );
  }

  // Syncing
  if (isSaving) {
    return (
      <Tooltip label="Saving changes...">
        <Badge
          size="sm"
          variant="light"
          color="yellow"
          leftSection={<IconCloudUpload size={12} />}
        >
          Syncing
        </Badge>
      </Tooltip>
    );
  }

  // Check if this is a shared game (not owned by current user)
  const isShared = game.authorId && game.authorId !== session.user.id;

  // Synced
  return (
    <Tooltip label={isShared ? 'Shared game - changes sync automatically' : 'Game saved to cloud'}>
      <Badge
        size="sm"
        variant="light"
        color={isShared ? 'blue' : 'green'}
        leftSection={<IconCloudCheck size={12} />}
      >
        {isShared ? 'Shared' : 'Synced'}
      </Badge>
    </Tooltip>
  );
}
