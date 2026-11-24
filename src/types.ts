export const STORAGE_KEY = 'escapement_roguelike_v1_save';
export const SAVE_VERSION = 1;
export const ARENA_RADIUS = 880;
export const MAX_WEAPON_SLOTS = 4;

export type ScreenState = 'title' | 'playing' | 'levelup' | 'paused' | 'gameover' | 'workshop' | 'codex';

export type WeaponId =
  | 'escapement_bolt'
  | 'ruby_prism'
  | 'tourbillon_orbit'
  | 'chime_hammer'
  | 'hairspring_arc'
  | 'pendulum_scythe';

export type PassiveId =
  | 'mainspring_tension'
  | 'jewel_calibration'
  | 'split_seconds'
  | 'lubricated_pivots'
  | 'magnetic_coils'
  | 'bimetallic_alloy'
  | 'tempered_glass'
  | 'overclock_capacitor'
  | 'ricochet_jewel'
  | 'chrono_leech'
  | 'volatile_spring'
  | 'anchor_tempo';

export type EvolutionId =
  | 'perpetual_barrage'
  | 'prism_singularity'
  | 'celestial_orrery'
  | 'cataclysm_carillon'
  | 'tesla_chronometer'
  | 'eclipse_regulator';

export type UpgradeId = WeaponId | PassiveId | EvolutionId;

export type UpgradeCategory = 'weapon' | 'passive' | 'evolution';

export type Rarity = 'brass' | 'blued' | 'ruby' | 'gilded' | 'mythic';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  category: UpgradeCategory;
  maxLevel: number;
  icon: string;
  color: string;
  shortDesc: string;
  levelDesc: (nextLevel: number, rarityMult: number) => string;
  /** For weapons: paired passive that unlocks evolution. For evolutions: [weaponId, passiveId] */
  synergyWith?: UpgradeId;
  requires?: [WeaponId, PassiveId];
  replacesWeapon?: WeaponId;
}

export interface DraftChoice {
  upgradeId: UpgradeId;
  category: UpgradeCategory;
  name: string;
  icon: string;
  color: string;
  rarity: Rarity;
  rarityLabel: string;
  rarityMult: number;
  currentLevel: number;
  nextLevel: number;
  description: string;
  synergyHint?: string;
  isEvolution: boolean;
}

export type EnemyType =
  | 'rust_mite'
  | 'burr_sprocket'
  | 'magnet_needle'
  | 'tarnish_globule'
  | 'mini_globule'
  | 'pendulum_brute'
  | 'overwound_coil';

export type BossType = 'grand_tourbillon' | 'mainspring_leviathan';

export type EliteTrait = 'none' | 'gilded' | 'overwound' | 'volatile';

export interface EnemyDef {
  type: EnemyType;
  name: string;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  radius: number;
  xpValue: number;
  giltChance: number;
  scoreValue: number;
  color: string;
  accent: string;
  mass: number;
}

export interface BossDef {
  type: BossType;
  name: string;
  title: string;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  radius: number;
  xpReward: number;
  giltReward: number;
  scoreValue: number;
  color: string;
  accent: string;
}

export interface WaveModifier {
  id: string;
  name: string;
  description: string;
  speedMult: number;
  hpMult: number;
  spawnMult: number;
  giltMult: number;
  xpMult: number;
  eliteBonus: number;
}

export interface WaveConfig {
  wave: number;
  duration: number;
  spawnInterval: number;
  maxEnemies: number;
  weights: Partial<Record<EnemyType, number>>;
  eliteCount: number;
  boss?: BossType;
  title: string;
  modifier?: WaveModifier;
}

export interface MetaUpgradeDef {
  id: MetaUpgradeId;
  name: string;
  description: string;
  icon: string;
  maxRank: number;
  baseCost: number;
  costStep: number;
  effectPerRank: string;
}

export type MetaUpgradeId =
  | 'hardened_mainspring'
  | 'tempered_case'
  | 'jewel_bearings'
  | 'precision_escapement'
  | 'gilded_reserve'
  | 'calibrated_start';

export interface SettingsData {
  soundEnabled: boolean;
  musicEnabled: boolean;
  shakeEnabled: boolean;
  hapticsEnabled: boolean;
}

export interface SaveData {
  version: number;
  gilt: number;
  bestWave: number;
  bestScore: number;
  bestCycle: number;
  totalKills: number;
  runsPlayed: number;
  metaRanks: Record<MetaUpgradeId, number>;
  discoveredEvolutions: EvolutionId[];
  settings: SettingsData;
}

export interface InputState {
  moveX: number;
  moveY: number;
  magnitude: number;
  active: boolean;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  pointerActive: boolean;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  wheelSpin: number;
  radius: number;
  hp: number;
  maxHp: number;
  ward: number;
  maxWard: number;
  wardRegenTimer: number;
  invulnTimer: number;
  hitFlashTimer: number;
  xp: number;
  xpToNext: number;
  level: number;
  standStillTime: number;
  anchorActive: boolean;
  chronoSlowTimer: number;
  killsSinceChrono: number;
  // Computed stats
  damageMult: number;
  attackSpeedMult: number;
  critChance: number;
  critMult: number;
  bonusProjectiles: number;
  moveSpeed: number;
  magnetRadius: number;
  xpMult: number;
  giltMult: number;
  knockbackMult: number;
  areaMult: number;
  bonusBounce: number;
  hpRegen: number;
  explosionPct: number;
  anchorFireBonus: number;
  // Equipped items
  weapons: Partial<Record<WeaponId, number>>;
  passives: Partial<Record<PassiveId, number>>;
  evolutions: Partial<Record<EvolutionId, boolean>>;
  rarityBonuses: Partial<Record<UpgradeId, number>>;
  rerollsLeft: number;
}

export interface EnemyEntity {
  active: boolean;
  id: number;
  isBoss: boolean;
  type: EnemyType;
  bossType: BossType | null;
  elite: EliteTrait;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kbVx: number;
  kbVy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  mass: number;
  xpValue: number;
  scoreValue: number;
  giltChance: number;
  color: string;
  accent: string;
  angle: number;
  spin: number;
  hitFlash: number;
  squash: number;
  slowTimer: number;
  aiState: number;
  aiTimer: number;
  aiTargetX: number;
  aiTargetY: number;
  phase: number;
  burnTimer: number;
  burnDps: number;
}

export type ProjectileKind =
  | 'bolt'
  | 'gilded_bolt'
  | 'ruby_prism'
  | 'mini_prism'
  | 'scythe'
  | 'eclipse_scythe'
  | 'orrery_spark'
  | 'enemy_dart'
  | 'boss_orb';

export interface ProjectileEntity {
  active: boolean;
  friendly: boolean;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  isCrit: boolean;
  pierce: number;
  bounces: number;
  life: number;
  maxLife: number;
  color: string;
  accent: string;
  angle: number;
  spin: number;
  explosiveRadius: number;
  knockback: number;
  hitIds: number[];
  // For boomerang scythes
  originX: number;
  originY: number;
  returnPhase: boolean;
  orbitAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
}

export type PickupKind = 'ruby' | 'ruby_large' | 'gilt' | 'heal' | 'relic_chest';

export interface PickupEntity {
  active: boolean;
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  radius: number;
  age: number;
  magnetized: boolean;
}

export interface ParticleEntity {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  shape: 'dot' | 'spark' | 'ring' | 'diamond' | 'gear';
  angle: number;
  vAngle: number;
  drag: number;
}

export interface DamageNumberEntity {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  text: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
  isCrit: boolean;
}

export interface ShockwaveEntity {
  active: boolean;
  friendly: boolean;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  lineWidth: number;
  life: number;
  maxLife: number;
  damage: number;
  applied: boolean;
}

export interface LightningArcEntity {
  active: boolean;
  points: Array<{ x: number; y: number }>;
  color: string;
  life: number;
  maxLife: number;
  width: number;
}

export interface TelegraphEntity {
  active: boolean;
  kind: 'circle' | 'line' | 'beam';
  x: number;
  y: number;
  x2: number;
  y2: number;
  radius: number;
  progress: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface RunSummary {
  wave: number;
  cycle: number;
  score: number;
  kills: number;
  giltEarned: number;
  durationSec: number;
  levelReached: number;
  isNewBestWave: boolean;
  isNewBestScore: boolean;
  evolutionsUnlocked: EvolutionId[];
  seed: number;
}

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  ward: number;
  maxWard: number;
  xp: number;
  xpToNext: number;
  level: number;
  wave: number;
  cycle: number;
  waveTimeLeft: number;
  waveDuration: number;
  waveTitle: string;
  waveModifierName: string | null;
  score: number;
  kills: number;
  giltRun: number;
  anchorActive: boolean;
  bossName: string | null;
  bossTitle: string | null;
  bossHp: number;
  bossMaxHp: number;
  weapons: Array<{ id: WeaponId; icon: string; level: number; evolved: boolean; color: string }>;
  bannerText: string | null;
  bannerSubtext: string | null;
  bannerColor: string;
  fps: number;
}

export interface SoundEngine {
  unlock(): void;
  setSettings(soundEnabled: boolean, musicEnabled: boolean): void;
  suspend(): void;
  resume(): void;
  setBossMode(active: boolean): void;
  playShot(kind: 'bolt' | 'prism' | 'scythe' | 'lightning' | 'chime' | 'gilded'): void;
  playHit(crit: boolean): void;
  playKill(elite: boolean): void;
  playExplosion(big: boolean): void;
  playPickup(kind: PickupKind, streak: number): void;
  playLevelUp(isEvolution: boolean): void;
  playPlayerHurt(): void;
  playBossSpawn(): void;
  playWaveClear(): void;
  playUiClick(): void;
  playGameOver(): void;
}
