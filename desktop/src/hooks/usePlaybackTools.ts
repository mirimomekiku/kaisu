import type { SeekPreferences } from "../lib/customization";
import { createContext, useContext } from "react";
import type { PlaybackProfilesApi } from "./usePlaybackProfiles";
import type { ListeningSessionsApi } from "./useListeningSessions";
import type { PlaylistsApi } from "./usePlaylists";
export const PlaybackToolsContext = createContext<{ profiles: PlaybackProfilesApi; sessions: ListeningSessionsApi; playlists: PlaylistsApi; waveformEnabled: boolean; seekPreferences: SeekPreferences } | null>(null);
export const usePlaybackTools = () => useContext(PlaybackToolsContext);
