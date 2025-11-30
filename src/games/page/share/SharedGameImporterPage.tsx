import { supabaseClient } from '@/core/supabase';
import { useStore } from '@/core/zustand';
import type { SerializedGame } from '@/games/store/gameFactoriesActions';
import { Center, Container, Loader, Text, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export interface ISharedGameImporterPageProps {}

export function SharedGameImporterPage(_props: ISharedGameImporterPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const gameSavedId = searchParams.get('gameSavedId');
  const [status, setStatus] = useState('Loading shared game...');

  useEffect(() => {
    async function loadSharedGame() {
      if (!gameSavedId || !token) {
        console.error('Missing gameId or token');
        notifications.show({
          title: 'Error loading shared game',
          message: 'Link is missing required parameters',
          color: 'red',
        });
        navigate('/factories/calculator');
        return;
      }

      const session = useStore.getState().auth.session;

      try {
        setStatus('Fetching game data...');

        // Use RPC function to bypass RLS and get game by share token
        const { data, error } = await supabaseClient
          .rpc('get_game_by_share_token', {
            game_uuid: gameSavedId,
            token: token,
          })
          .single();

        if (error) {
          throw error;
        }

        if (!data) {
          throw new Error('Game not found or invalid share token');
        }

        // Check if user is already collaborating on this game
        const existingGame = Object.values(useStore.getState().games.games).find(
          g => g.savedId === gameSavedId,
        );

        if (existingGame) {
          // Already have this game - just select it and refresh data
          setStatus('Game already in your list, refreshing...');
          const serialized = data.data as unknown as SerializedGame;
          useStore.getState().loadRemoteGame(serialized, data, { override: true });
          useStore.getState().selectGame(existingGame.id);
          navigate('/games');
          notifications.show({
            title: 'Game refreshed',
            message: `"${serialized.game.name}" data has been updated`,
            color: 'blue',
          });
          return;
        }

        // Add user as collaborator if they're logged in and not the owner
        if (session && data.author_id !== session.user.id) {
          setStatus('Joining as collaborator...');
          await supabaseClient.rpc('join_game_by_share_token', {
            game_uuid: gameSavedId,
            token: token,
          });
        }

        // Load game into local state
        setStatus('Setting up game...');
        const serialized = data.data as unknown as SerializedGame;
        useStore.getState().loadRemoteGame(serialized, data);
        useStore.getState().selectGame(serialized.game.id);

        navigate('/games');

        const isOwner = session && data.author_id === session.user.id;
        notifications.show({
          title: isOwner ? 'Your game loaded' : 'Joined shared game',
          message: isOwner
            ? `Game "${serialized.game.name}" has been loaded`
            : `You now have access to "${serialized.game.name}". Changes will sync automatically.`,
          color: 'green',
        });
      } catch (error) {
        console.error('Error loading shared game:', error);
        notifications.show({
          title: 'Error loading shared game',
          message: (error as Error)?.message ?? 'Unknown error',
          color: 'red',
        });
        navigate('/factories/calculator');
      }
    }

    loadSharedGame();
  }, [navigate, gameSavedId, token]);

  return (
    <div>
      <Container size="lg">
        <Center w="100%" p="xl">
          <Stack align="center" gap="md">
            <Loader size="lg" />
            <Text c="dimmed">{status}</Text>
          </Stack>
        </Center>
      </Container>
    </div>
  );
}
