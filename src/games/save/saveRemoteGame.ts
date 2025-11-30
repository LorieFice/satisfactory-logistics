import type { Json } from '@/core/database.types';
import { supabaseClient } from '@/core/supabase';
import { useStore } from '@/core/zustand';
import { notifications } from '@mantine/notifications';
import { serializeGame } from '@/games/store/gameFactoriesActions';

// Ensure user has a profile (creates one if missing)
async function ensureProfile(userId: string) {
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single();

  if (!profile) {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (user) {
      await supabaseClient.from('profiles').upsert({
        id: userId,
        username:
          user.user_metadata?.global_name ??
          user.user_metadata?.name ??
          user.user_metadata?.full_name ??
          user.email,
        avatar_url: user.user_metadata?.avatar_url,
      });
    }
  }
}

export async function saveRemoteGame(gameId?: string | null) {
  const { auth } = useStore.getState();
  useStore.getState().setIsSaving(true);
  try {
    if (!auth.session) {
      console.log(
        'No session, skipping save, previous at ' + auth.sync.syncedAt,
      );
      return;
    }

    // Ensure current user has a profile before saving
    await ensureProfile(auth.session.user.id);

    const state = useStore.getState();
    gameId ??= state.games.selected!;
    const game = state.games.games[gameId ?? ''];
    if (!game) {
      console.error('No game, skipping save');
      notifications.show({
        title: 'Error saving game',
        message: 'No game selected',
      });
      return;
    }

    const currentVersion = game.version ?? 1;
    const isNewGame = !game.savedId;

    let data;
    let error;

    if (isNewGame) {
      // New game - insert with current user as author
      const result = await supabaseClient
        .from('games')
        .insert({
          author_id: auth.session.user.id,
          name: game.name,
          data: serializeGame(gameId) as unknown as Json,
          version: currentVersion + 1,
          updated_at: new Date().toISOString(),
        })
        .select('id, author_id, created_at, share_token, version')
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Existing game - update (works for both owner and collaborators via RLS)
      // savedId is guaranteed to exist here since isNewGame is false
      const result = await supabaseClient
        .from('games')
        .update({
          name: game.name,
          data: serializeGame(gameId) as unknown as Json,
          version: currentVersion + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', game.savedId!)
        .select('id, author_id, created_at, share_token, version')
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('Error syncing factories:', error);
      throw error;
    }

    console.log('Saved game to remote:', data);
    useStore.getState().setRemoteGameData(game.id, data);
    useStore.getState().setGameVersion(game.id, data.version);

    if (isNewGame) {
      notifications.show({
        title: 'Game saved',
        message: `"${game.name}" has been saved to the cloud`,
        color: 'green',
      });
    }
  } catch (error: any) {
    console.error('Error saving game:', error);
    notifications.show({
      title: 'Error saving game',
      message: error?.message ?? error ?? 'Unknown error',
      color: 'red',
    });
  } finally {
    useStore.getState().setIsSaving(false);
  }
}
