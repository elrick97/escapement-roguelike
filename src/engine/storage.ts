import {
  SAVE_VERSION,
  STORAGE_KEY,
  type EvolutionId,
  type MetaUpgradeId,
  type SaveData,
  type SettingsData,
} from '../types';

const META_UPGRADE_IDS: readonly MetaUpgradeId[] = [
  'hardened_mainspring',
  'tempered_case',
  'jewel_bearings',
  'precision_escapement',
  'gilded_reserve',
  'calibrated_start',
];

const VALID_EVOLUTION_IDS: ReadonlySet<string> = new Set<EvolutionId>([
  'perpetual_barrage',
  'prism_singularity',
  'celestial_orrery',
  'cataclysm_carillon',
  'tesla_chronometer',
  'eclipse_regulator',
]);

const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;
const MAX_META_RANK = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const truncated = Math.floor(value);
  if (truncated < min) return min;
  if (truncated > max) return max;
  return truncated;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isEvolutionId(value: unknown): value is EvolutionId {
  return typeof value === 'string' && VALID_EVOLUTION_IDS.has(value);
}

/**
 * Creates a fresh default save payload matching the current schema version.
 */
export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    gilt: 0,
    bestWave: 0,
    bestScore: 0,
    bestCycle: 0,
    totalKills: 0,
    runsPlayed: 0,
    metaRanks: {
      hardened_mainspring: 0,
      tempered_case: 0,
      jewel_bearings: 0,
      precision_escapement: 0,
      gilded_reserve: 0,
      calibrated_start: 0,
    },
    discoveredEvolutions: [],
    settings: {
      soundEnabled: true,
      musicEnabled: true,
      shakeEnabled: true,
      hapticsEnabled: true,
    },
  };
}

function sanitizeSave(raw: unknown): SaveData {
  const defaults = createDefaultSave();
  if (!isRecord(raw)) {
    return defaults;
  }

  const metaRanks = { ...defaults.metaRanks };
  if (isRecord(raw.metaRanks)) {
    for (const id of META_UPGRADE_IDS) {
      metaRanks[id] = clampInt(raw.metaRanks[id], 0, MAX_META_RANK, 0);
    }
  }

  const discoveredEvolutions: EvolutionId[] = [];
  if (Array.isArray(raw.discoveredEvolutions)) {
    const seen = new Set<EvolutionId>();
    for (const entry of raw.discoveredEvolutions) {
      if (isEvolutionId(entry) && !seen.has(entry)) {
        seen.add(entry);
        discoveredEvolutions.push(entry);
      }
    }
  }

  const settings: SettingsData = { ...defaults.settings };
  if (isRecord(raw.settings)) {
    settings.soundEnabled = readBoolean(raw.settings.soundEnabled, defaults.settings.soundEnabled);
    settings.musicEnabled = readBoolean(raw.settings.musicEnabled, defaults.settings.musicEnabled);
    settings.shakeEnabled = readBoolean(raw.settings.shakeEnabled, defaults.settings.shakeEnabled);
    settings.hapticsEnabled = readBoolean(
      raw.settings.hapticsEnabled,
      defaults.settings.hapticsEnabled,
    );
  }

  return {
    version: SAVE_VERSION,
    gilt: clampInt(raw.gilt, 0, MAX_SAFE_INT, defaults.gilt),
    bestWave: clampInt(raw.bestWave, 0, MAX_SAFE_INT, defaults.bestWave),
    bestScore: clampInt(raw.bestScore, 0, MAX_SAFE_INT, defaults.bestScore),
    bestCycle: clampInt(raw.bestCycle, 0, MAX_SAFE_INT, defaults.bestCycle),
    totalKills: clampInt(raw.totalKills, 0, MAX_SAFE_INT, defaults.totalKills),
    runsPlayed: clampInt(raw.runsPlayed, 0, MAX_SAFE_INT, defaults.runsPlayed),
    metaRanks,
    discoveredEvolutions,
    settings,
  };
}

/**
 * Loads, validates, and migrates save data from `localStorage`.
 * Never throws on corrupt JSON or restricted storage environments.
 */
export function loadSave(): SaveData {
  try {
    if (typeof localStorage === 'undefined') {
      return createDefaultSave();
    }
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized === null || serialized.length === 0) {
      return createDefaultSave();
    }
    const parsed: unknown = JSON.parse(serialized);
    return sanitizeSave(parsed);
  } catch {
    return createDefaultSave();
  }
}

/**
 * Persists save data to `localStorage`, silently ignoring storage exceptions.
 */
export function writeSave(data: SaveData): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore SecurityError, QuotaExceededError, or serialization failures.
  }
}

/**
 * Resets persisted progress to defaults and writes it to `localStorage`.
 */
export function resetSave(): SaveData {
  const fresh = createDefaultSave();
  writeSave(fresh);
  return fresh;
}
