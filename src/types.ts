export type AlertLevel = 'none' | 'yellow' | 'red';

export interface AlertFilters {
  auth?: 'query' | 'bearer';
  clearConfirmPolls: number;
}

export interface MusicSyncConfig {
  syncStart: string;
  dayRolloverHour: number;
}

export interface LocationNode {
  uid: string;
  name: string;
  type: 'oblast' | 'city' | 'raion' | 'hromada';
  raions?: LocationNode[];
  hromadas?: LocationNode[];
}

export interface LocationLookup {
  uid: string;
  name: string;
  type: 'oblast' | 'city' | 'raion' | 'hromada';
  oblastUid: string;
  raionUid: string | null;
}

export interface LocationIndex {
  updatedAt: string;
  oblasts: LocationNode[];
  byUid: Record<string, LocationLookup>;
}

export interface SignalConfig {
  yellow: string;
  red: string;
  clear: string;
  activeHours: { start: string; end: string } | null;
}

export interface VenueConfig {
  venueName: string;
  tagline?: string;
  logo: string;
  pollIntervalSec: number;
  staleAfterSec: number;
  alerts: AlertFilters;
  music?: MusicSyncConfig;
  signals: SignalConfig;
  gamarjos: { dir: string };
  theme?: { heroImage: string };
  proxyUrl: string;
}

export interface LocalMusicTrack {
  src: string;
  fileName: string;
  title: string;
  size: number;
}

export interface GamarjosFile {
  src: string;
  title: string;
}

export interface DiagnosticEntry {
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
}
