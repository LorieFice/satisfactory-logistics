import { supabaseClient } from '@/core/supabase';
import { useStore } from '@/core/zustand';
import { notifications } from '@mantine/notifications';
import type { Tables } from '@/core/database.types';

export type RemoteLoadedGame = Pick<
  Tables<'games'>,
  'id' | 'name' | 'author_id' | 'data' | 'created_at' | 'updated_at' | 'share_token' | 'version'
>;

export type RemoteLoadedGamesList = RemoteLoadedGame[];

export async function loadRemoteGamesList() {
  const { auth } = useStore.getState();
  if (!auth.session) {
    console.log('No session, skipping load');
    return;
  }

  useStore.getState().setIsLoading(true);

  try {
    // Load owned games
    const { data: ownedGames, error: ownedError } = await supabaseClient
      .from('games')
      .select('id, name, author_id, data, created_at, updated_at, share_token, version')
      .eq('author_id', auth.session.user.id)
      .order('created_at', { ascending: false });

    if (ownedError) {
      throw ownedError;
    }

    // Load shared games (games where user is a collaborator)
    const { data: sharedGameIds, error: sharedIdsError } = await supabaseClient
      .from('shared_games')
      .select('game_id')
      .eq('user_id', auth.session.user.id);

    if (sharedIdsError) {
      throw sharedIdsError;
    }

    let sharedGames: RemoteLoadedGame[] = [];
    if (sharedGameIds && sharedGameIds.length > 0) {
      const { data: sharedGamesData, error: sharedGamesError } = await supabaseClient
        .from('games')
        .select('id, name, author_id, data, created_at, updated_at, share_token, version')
        .in('id', sharedGameIds.map(sg => sg.game_id))
        .order('created_at', { ascending: false });

      if (sharedGamesError) {
        throw sharedGamesError;
      }

      sharedGames = sharedGamesData ?? [];
    }

    // Combine and deduplicate (in case of any overlap)
    const allGamesMap = new Map<string, RemoteLoadedGame>();
    for (const game of [...(ownedGames ?? []), ...sharedGames]) {
      allGamesMap.set(game.id, game);
    }
    const allGames = Array.from(allGamesMap.values());

    console.log('Loaded games:', { owned: ownedGames?.length, shared: sharedGames.length, total: allGames.length });
    useStore.getState().setRemoteGames(allGames);
  } catch (error) {
    console.error('Error loading games:', error);
    notifications.show({
      color: 'red',
      title: 'Error loading games',
      message: (error as Error).message,
    });
  } finally {
    useStore.getState().setIsLoading(false);
  }
}
