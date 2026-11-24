import { BOSS_DEFS } from '../data/enemies';
import { getWaveConfig, getWaveScaling } from '../data/waves';
import type { FxManager } from '../render/particles';
import type {
  EliteTrait,
  EnemyType,
  PlayerState,
  SoundEngine,
  WaveConfig,
} from '../types';
import type { SeededRNG } from '../utils/rng';
import type { EnemySystem } from './enemies';

const ELITE_TRAIT_LIST: readonly Exclude<EliteTrait, 'none'>[] = [
  'gilded',
  'overwound',
  'volatile',
];

const ALL_ENEMY_TYPES: readonly EnemyType[] = [
  'rust_mite',
  'burr_sprocket',
  'magnet_needle',
  'tarnish_globule',
  'pendulum_brute',
  'overwound_coil',
];

export class WaveDirector {
  public wave = 1;
  public cycle = 0;
  public waveTimer = 22;
  public currentConfig: WaveConfig;

  public bannerText: string | null = null;
  public bannerSubtext: string | null = null;
  public bannerColor = '#F5C542';

  private bannerTimer = 0;
  private spawnTimer = 0.4;
  private elitesSpawned = 0;
  private bossSpawned = false;
  private waveBreakTimer = 0;

  constructor(rng: SeededRNG) {
    this.currentConfig = getWaveConfig(1, rng);
    this.waveTimer = this.currentConfig.duration;
  }

  public startRun(rng: SeededRNG, sound: SoundEngine): void {
    this.wave = 1;
    this.beginWave(1, rng, null, null, sound);
  }

  private beginWave(
    waveNum: number,
    rng: SeededRNG,
    enemySys: EnemySystem | null,
    player: PlayerState | null,
    sound: SoundEngine,
    fx?: FxManager,
  ): void {
    this.wave = waveNum;
    this.cycle = getWaveScaling(waveNum).cycle;
    this.currentConfig = getWaveConfig(waveNum, rng);
    this.waveTimer = this.currentConfig.duration;
    this.spawnTimer = 0.35;
    this.elitesSpawned = 0;
    this.bossSpawned = false;
    this.waveBreakTimer = 0;

    if (this.currentConfig.boss && enemySys && player) {
      const bossType = this.currentConfig.boss;
      const boss = enemySys.spawnBoss(
        bossType,
        player,
        this.wave,
        rng,
        this.currentConfig.modifier,
      );
      this.bossSpawned = true;
      sound.playBossSpawn();
      sound.setBossMode(true);
      const bDef = BOSS_DEFS[bossType];
      this.setBanner(bDef.name.toUpperCase(), bDef.title, '#FF2E63', 3.4);
      if (boss && fx) {
        const ring = fx.spawnShockwave(false, boss.x, boss.y, 160, '#FF2E63', 0, 5, 0.5);
        if (ring) ring.applied = true;
        fx.spawnBurst(boss.x, boss.y, '#FF2E63', 18, 60, 210, 3, 6, 'diamond');
      }
    } else {
      sound.setBossMode(false);
      const mod = this.currentConfig.modifier;
      this.setBanner(
        this.currentConfig.title.toUpperCase(),
        mod ? `${mod.name} — ${mod.description}` : null,
        '#F5C542',
        2.8,
      );
    }
  }

  public setBanner(
    text: string,
    subtext: string | null,
    color: string,
    duration: number,
  ): void {
    this.bannerText = text;
    this.bannerSubtext = subtext;
    this.bannerColor = color;
    this.bannerTimer = duration;
  }

  private pickEnemyType(rng: SeededRNG): EnemyType {
    const weights = this.currentConfig.weights;
    let total = 0;
    for (let i = 0; i < ALL_ENEMY_TYPES.length; i++) {
      total += weights[ALL_ENEMY_TYPES[i]] ?? 0;
    }
    if (total <= 0) return 'rust_mite';

    let roll = rng.next() * total;
    for (let i = 0; i < ALL_ENEMY_TYPES.length; i++) {
      const t = ALL_ENEMY_TYPES[i];
      const w = weights[t] ?? 0;
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return t;
    }
    return 'rust_mite';
  }

  private pickEliteType(rng: SeededRNG): EnemyType {
    // Prefer sturdy types if present in wave weights
    const weights = this.currentConfig.weights;
    const preferred: EnemyType[] = [
      'pendulum_brute',
      'burr_sprocket',
      'tarnish_globule',
      'magnet_needle',
      'overwound_coil',
    ];
    const pool: EnemyType[] = [];
    for (let i = 0; i < preferred.length; i++) {
      if ((weights[preferred[i]] ?? 0) > 0) {
        pool.push(preferred[i]);
      }
    }
    if (pool.length > 0) {
      return rng.pick(pool);
    }
    return this.pickEnemyType(rng);
  }

  public update(
    dt: number,
    rng: SeededRNG,
    enemySys: EnemySystem,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    onBonusGilt: (amount: number) => void,
  ): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerText = null;
        this.bannerSubtext = null;
      }
    }

    // Brief breather after wave clear while pickups vacuum in
    if (this.waveBreakTimer > 0) {
      this.waveBreakTimer -= dt;
      if (this.waveBreakTimer <= 0) {
        this.beginWave(this.wave + 1, rng, enemySys, player, sound, fx);
      }
      return;
    }

    // Ensure boss spawns if this is a boss wave
    if (this.currentConfig.boss && !this.bossSpawned) {
      const bossType = this.currentConfig.boss;
      const boss = enemySys.spawnBoss(
        bossType,
        player,
        this.wave,
        rng,
        this.currentConfig.modifier,
      );
      this.bossSpawned = true;
      sound.playBossSpawn();
      sound.setBossMode(true);
      const bDef = BOSS_DEFS[bossType];
      this.setBanner(bDef.name.toUpperCase(), bDef.title, '#FF2E63', 3.4);
      if (boss) {
        const ring = fx.spawnShockwave(false, boss.x, boss.y, 160, '#FF2E63', 0, 5, 0.5);
        if (ring) ring.applied = true;
      }
    }

    // Countdown wave timer
    this.waveTimer = Math.max(0, this.waveTimer - dt);

    // Spawn scheduled elites evenly across wave duration
    const eliteTotal = this.currentConfig.eliteCount;
    if (eliteTotal > 0 && this.elitesSpawned < eliteTotal) {
      const elapsed = this.currentConfig.duration - this.waveTimer;
      const interval = (this.currentConfig.duration * 0.78) / eliteTotal;
      const nextEliteAt = 3.2 + this.elitesSpawned * interval;
      if (elapsed >= nextEliteAt) {
        this.elitesSpawned++;
        const eType = this.pickEliteType(rng);
        const trait = rng.pick(ELITE_TRAIT_LIST);
        const pos = enemySys.getSpawnPositionAroundPlayer(player, rng, 360, 480);
        const elite = enemySys.spawnEnemy(
          eType,
          pos.x,
          pos.y,
          this.wave,
          trait,
          this.currentConfig.modifier,
          rng,
        );
        if (elite) {
          fx.spawnBurst(elite.x, elite.y, '#F5C542', 10, 40, 140, 2.5, 4.5, 'diamond');
        }
      }
    }

    // Regular enemy spawning cadence
    const activeCount = enemySys.enemies.activeCount();
    const isBossWave = Boolean(this.currentConfig.boss);
    const cap = isBossWave
      ? Math.min(this.currentConfig.maxEnemies, 26)
      : this.currentConfig.maxEnemies;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const baseInterval = this.currentConfig.spawnInterval;
      this.spawnTimer = isBossWave ? Math.max(baseInterval * 1.45, 0.72) : baseInterval;

      if (activeCount < cap) {
        const batch = this.wave >= 6 && !isBossWave ? (rng.chance(0.35) ? 2 : 1) : 1;
        for (let b = 0; b < batch; b++) {
          if (enemySys.enemies.activeCount() >= cap) break;
          const eType = this.pickEnemyType(rng);
          const pos = enemySys.getSpawnPositionAroundPlayer(player, rng, 360, 520);
          enemySys.spawnEnemy(
            eType,
            pos.x,
            pos.y,
            this.wave,
            'none',
            this.currentConfig.modifier,
            rng,
          );
        }
      }
    }

    // Check wave completion
    const bossCleared = !isBossWave || (this.bossSpawned && !enemySys.hasActiveBoss());
    const waveComplete = isBossWave ? bossCleared : this.waveTimer <= 0;

    if (waveComplete) {
      this.completeWave(enemySys, player, sound, onBonusGilt);
    }
  }

  private completeWave(
    enemySys: EnemySystem,
    player: PlayerState,
    sound: SoundEngine,
    onBonusGilt: (amount: number) => void,
  ): void {
    enemySys.magnetizeAllPickups();
    const modGilt = this.currentConfig.modifier?.giltMult ?? 1;
    const bonusGilt = Math.round((8 + this.wave * 3) * player.giltMult * modGilt);
    onBonusGilt(bonusGilt);
    sound.playWaveClear();
    sound.setBossMode(false);
    this.setBanner(
      `CHIME ${this.wave} CLEARED!`,
      `+${bonusGilt} Gilt Bonus • All Ruby Bearings Vacuumed`,
      '#2EC4B6',
      1.6,
    );
    this.waveBreakTimer = 1.15;
  }

  public forceAdvanceWave(
    rng: SeededRNG,
    enemySys: EnemySystem,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
  ): void {
    enemySys.enemies.releaseAll();
    this.beginWave(this.wave + 1, rng, enemySys, player, sound, fx);
  }
}
