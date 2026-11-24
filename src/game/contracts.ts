import type {
  DraftChoice,
  HudSnapshot,
  MetaUpgradeId,
  RunSummary,
  SaveData,
  ScreenState,
  SettingsData,
} from '../types';

export interface GameCallbacks {
  onScreenChange: (screen: ScreenState) => void;
  onHudUpdate: (hud: HudSnapshot) => void;
  onDraftReady: (
    choices: DraftChoice[],
    title: string,
    subtitle: string,
    canReroll: boolean,
    rerollsLeft: number
  ) => void;
  onRunOver: (summary: RunSummary) => void;
  onSaveChanged: (save: SaveData) => void;
}

export interface IGameEngine {
  startRun(seed?: number): void;
  pause(): void;
  resume(): void;
  quitToTitle(): void;
  selectDraftChoice(index: number): void;
  rerollDraft(): void;
  getSave(): SaveData;
  updateSettings(partial: Partial<SettingsData>): void;
  buyMetaUpgrade(id: MetaUpgradeId): boolean;
  resetProgress(): void;
  getScreen(): ScreenState;
  destroy(): void;
}

export interface EscapementTelemetry {
  getScreen: () => ScreenState;
  getFps: () => number;
  getWave: () => number;
  getLevel: () => number;
  getKills: () => number;
  getHp: () => number;
  getActiveCounts: () => {
    enemies: number;
    projectiles: number;
    pickups: number;
    particles: number;
  };
  /** Test helper to jump to a wave or award XP during automated QA */
  grantXp: (amount: number) => void;
  advanceWave: () => void;
  damagePlayer: (amount: number) => void;
}

declare global {
  interface Window {
    __ESCAPEMENT__?: EscapementTelemetry;
  }
}
