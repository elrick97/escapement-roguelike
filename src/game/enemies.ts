import { BOSS_DEFS, ELITE_TRAITS, ENEMY_DEFS } from '../data/enemies';
import { getWaveScaling } from '../data/waves';
import { ObjectPool } from '../engine/pool';
import type { SpatialHash } from '../engine/spatialHash';
import type { FxManager } from '../render/particles';
import {
  ARENA_RADIUS,
  type BossType,
  type EliteTrait,
  type EnemyEntity,
  type EnemyType,
  type PickupEntity,
  type PickupKind,
  type PlayerState,
  type SoundEngine,
  type WaveModifier,
} from '../types';
import { clamp, SeededRNG } from '../utils/rng';

export interface EnemyEventHooks {
  onEnemyKilled: (enemy: EnemyEntity, player: PlayerState) => void;
  onPlayerHit: (amount: number, sourceX: number, sourceY: number) => void;
  onPlayerHeal: (amount: number) => void;
  onPickupXp: (amount: number) => void;
  onPickupGilt: (amount: number) => void;
  onRelicChest: () => void;
  onSpawnHostileProjectile: (
    kind: 'enemy_dart' | 'boss_orb',
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    damage: number,
    color: string,
  ) => void;
  onExplosionTriggered: (big: boolean) => void;
}

const TWO_PI = Math.PI * 2;
const PICKUP_STREAK_WINDOW = 0.65;

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 0.0001) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

export class EnemySystem {
  public readonly enemies: ObjectPool<EnemyEntity>;
  public readonly pickups: ObjectPool<PickupEntity>;

  private nextEnemyId = 1;
  private pickupStreak = 0;
  private pickupStreakTimer = 0;
  private explosionDepth = 0;

  // Reusable scratch arrays for zero-allocation queries
  private readonly sepScratch: EnemyEntity[] = [];
  private readonly blastScratch: EnemyEntity[] = [];

  constructor() {
    this.enemies = new ObjectPool<EnemyEntity>(260, () => ({
      active: false,
      id: 0,
      isBoss: false,
      type: 'rust_mite',
      bossType: null,
      elite: 'none',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      kbVx: 0,
      kbVy: 0,
      radius: 12,
      hp: 20,
      maxHp: 20,
      speed: 100,
      damage: 8,
      mass: 1,
      xpValue: 3,
      scoreValue: 15,
      giltChance: 0.08,
      color: '#E76F51',
      accent: '#F4A261',
      angle: 0,
      spin: 0,
      hitFlash: 0,
      squash: 0,
      slowTimer: 0,
      aiState: 0,
      aiTimer: 0,
      aiTargetX: 0,
      aiTargetY: 0,
      phase: 1,
      burnTimer: 0,
      burnDps: 0,
    }));

    this.pickups = new ObjectPool<PickupEntity>(300, () => ({
      active: false,
      kind: 'ruby',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      value: 1,
      radius: 6,
      age: 0,
      magnetized: false,
    }));
  }

  public clear(): void {
    this.enemies.releaseAll();
    this.pickups.releaseAll();
    this.nextEnemyId = 1;
    this.pickupStreak = 0;
    this.pickupStreakTimer = 0;
    this.explosionDepth = 0;
  }

  public populateSpatialHash(hash: SpatialHash<EnemyEntity>): void {
    hash.clear();
    const items = this.enemies.items;
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      if (e.active) {
        hash.insert(e);
      }
    }
  }

  public getSpawnPositionAroundPlayer(
    player: PlayerState,
    rng: SeededRNG,
    minDist = 350,
    maxDist = 510,
  ): { x: number; y: number } {
    const angle = rng.next() * TWO_PI;
    const dist = rng.range(minDist, maxDist);
    let x = player.x + Math.cos(angle) * dist;
    let y = player.y + Math.sin(angle) * dist;

    const rFromCenter = Math.hypot(x, y);
    const maxAllowed = ARENA_RADIUS - 42;
    if (rFromCenter > maxAllowed) {
      const scale = maxAllowed / rFromCenter;
      x *= scale;
      y *= scale;
      // If clamping brought it right next to the player near the edge, push inward/around
      if (Math.hypot(x - player.x, y - player.y) < 220) {
        const opp = Math.atan2(-player.y, -player.x) + rng.range(-0.9, 0.9);
        x = player.x + Math.cos(opp) * 340;
        y = player.y + Math.sin(opp) * 340;
        const r2 = Math.hypot(x, y);
        if (r2 > maxAllowed) {
          x *= maxAllowed / r2;
          y *= maxAllowed / r2;
        }
      }
    }
    return { x, y };
  }

  public spawnEnemy(
    type: EnemyType,
    x: number,
    y: number,
    wave: number,
    elite: EliteTrait = 'none',
    modifier?: WaveModifier,
    rng?: SeededRNG,
  ): EnemyEntity | null {
    const e = this.enemies.acquire();
    if (!e) return null;

    const def = ENEMY_DEFS[type];
    const scaling = getWaveScaling(wave);
    const modHp = modifier?.hpMult ?? 1;
    const modSpd = modifier?.speedMult ?? 1;
    const modXp = modifier?.xpMult ?? 1;

    let hpMult = scaling.hpMult * modHp;
    let speedMult = scaling.speedMult * modSpd;
    let dmgMult = scaling.dmgMult;
    let sizeMult = 1;
    let xpMult = modXp;
    let giltBonus = 0;

    if (elite !== 'none') {
      const trait = ELITE_TRAITS[elite];
      hpMult *= trait.hpMult;
      speedMult *= trait.speedMult;
      dmgMult *= trait.dmgMult;
      sizeMult *= trait.sizeMult;
      xpMult *= 3;
      giltBonus = 0.7;
    }

    e.id = this.nextEnemyId++;
    e.isBoss = false;
    e.type = type;
    e.bossType = null;
    e.elite = elite;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    e.kbVx = 0;
    e.kbVy = 0;
    e.radius = def.radius * sizeMult;
    e.maxHp = Math.max(1, Math.round(def.baseHp * hpMult));
    e.hp = e.maxHp;
    e.speed = def.baseSpeed * speedMult;
    e.damage = Math.max(1, Math.round(def.baseDamage * dmgMult));
    e.mass = def.mass * (elite !== 'none' ? 1.8 : 1);
    e.xpValue = Math.max(1, Math.round(def.xpValue * xpMult));
    e.scoreValue = Math.round(def.scoreValue * (elite !== 'none' ? 4 : 1));
    e.giltChance = Math.min(1, def.giltChance + giltBonus);
    e.color = def.color;
    e.accent = def.accent;
    e.angle = 0;
    e.spin = rng ? rng.next() * TWO_PI : 0;
    e.hitFlash = 0;
    e.squash = 0;
    e.slowTimer = 0;
    e.aiState = 0;
    e.aiTimer = rng ? rng.range(0.5, 1.5) : 1.0;
    e.aiTargetX = 0;
    e.aiTargetY = 0;
    e.phase = 1;
    e.burnTimer = 0;
    e.burnDps = 0;

    return e;
  }

  public spawnBoss(
    bossType: BossType,
    player: PlayerState,
    wave: number,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): EnemyEntity | null {
    const e = this.enemies.acquire();
    if (!e) return null;

    const def = BOSS_DEFS[bossType];
    const scaling = getWaveScaling(wave);
    const pos = this.getSpawnPositionAroundPlayer(player, rng, 320, 420);

    e.id = this.nextEnemyId++;
    e.isBoss = true;
    e.type = 'pendulum_brute';
    e.bossType = bossType;
    e.elite = 'none';
    e.x = pos.x;
    e.y = pos.y;
    e.vx = 0;
    e.vy = 0;
    e.kbVx = 0;
    e.kbVy = 0;
    e.radius = def.radius;
    e.maxHp = Math.round(def.baseHp * scaling.hpMult * (modifier?.hpMult ?? 1));
    e.hp = e.maxHp;
    e.speed = def.baseSpeed * Math.min(1.35, scaling.speedMult);
    e.damage = Math.round(def.baseDamage * scaling.dmgMult);
    e.mass = 24;
    e.xpValue = def.xpReward;
    e.scoreValue = def.scoreValue;
    e.giltChance = 1;
    e.color = def.color;
    e.accent = def.accent;
    e.angle = Math.atan2(player.y - pos.y, player.x - pos.x);
    e.spin = 0;
    e.hitFlash = 0;
    e.squash = 0;
    e.slowTimer = 0;
    e.aiState = 0;
    e.aiTimer = 1.1;
    e.aiTargetX = 0;
    e.aiTargetY = 0;
    e.phase = 1;
    e.burnTimer = 0;
    e.burnDps = 0;

    return e;
  }

  public hasActiveBoss(): boolean {
    const items = this.enemies.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].active && items[i].isBoss) {
        return true;
      }
    }
    return false;
  }

  public getActiveBoss(): EnemyEntity | null {
    const items = this.enemies.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].active && items[i].isBoss) {
        return items[i];
      }
    }
    return null;
  }

  public findNearestEnemy(
    x: number,
    y: number,
    maxRange = Infinity,
    excludeIds?: readonly number[],
  ): EnemyEntity | null {
    const items = this.enemies.items;
    let best: EnemyEntity | null = null;
    let bestDistSq = maxRange * maxRange;

    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      if (!e.active) continue;
      if (excludeIds && excludeIds.includes(e.id)) continue;

      const dx = e.x - x;
      const dy = e.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }

    return best;
  }

  public spawnPickup(
    kind: PickupKind,
    x: number,
    y: number,
    value: number,
    magnetized = false,
  ): PickupEntity | null {
    const p = this.pickups.acquire();
    if (!p) return null;

    const angle = Math.random() * TWO_PI;
    const kick = kind === 'relic_chest' ? 24 : 55;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * kick;
    p.vy = Math.sin(angle) * kick;
    p.value = value;
    p.radius =
      kind === 'relic_chest'
        ? 14
        : kind === 'heal'
          ? 9
          : kind === 'ruby_large'
            ? 8.5
            : kind === 'gilt'
              ? 7
              : 6;
    p.age = 0;
    p.magnetized = magnetized;
    return p;
  }

  public magnetizeAllPickups(): void {
    const items = this.pickups.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].active) {
        items[i].magnetized = true;
      }
    }
  }

  public damageEnemy(
    e: EnemyEntity,
    rawDamage: number,
    isCrit: boolean,
    kbX: number,
    kbY: number,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    spatialHash: SpatialHash<EnemyEntity>,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
    options?: {
      suppressDamageNumber?: boolean;
      fromCataclysm?: boolean;
      slowSec?: number;
      burnSec?: number;
      burnDps?: number;
    },
  ): boolean {
    if (!e.active) return false;

    const dmg = Math.max(1, rawDamage);
    e.hp -= dmg;
    e.hitFlash = 0.11;
    e.squash = Math.min(1.0, e.squash + (isCrit ? 0.85 : 0.45));

    const kbFactor = (player.knockbackMult / Math.max(0.4, e.mass)) * (e.isBoss ? 0.12 : 1);
    e.kbVx += kbX * kbFactor;
    e.kbVy += kbY * kbFactor;

    if (options?.slowSec && options.slowSec > e.slowTimer) {
      e.slowTimer = options.slowSec;
    }
    if (options?.burnSec && options.burnDps) {
      e.burnTimer = Math.max(e.burnTimer, options.burnSec);
      e.burnDps = Math.max(e.burnDps, options.burnDps);
    }

    if (!options?.suppressDamageNumber) {
      fx.spawnDamageNumber(e.x, e.y - e.radius * 0.6, dmg, isCrit);
    }

    if (e.hp > 0) {
      sound.playHit(isCrit);
      return false;
    }

    // Enemy defeated
    this.killEnemy(e, player, fx, sound, spatialHash, hooks, rng, modifier, options?.fromCataclysm ?? false);
    return true;
  }

  private killEnemy(
    e: EnemyEntity,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    spatialHash: SpatialHash<EnemyEntity>,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
    fromCataclysm = false,
  ): void {
    const ex = e.x;
    const ey = e.y;
    const isBig = e.isBoss || e.elite !== 'none';
    const eType = e.type;
    const eMaxHp = e.maxHp;
    const eXp = e.xpValue;
    const eGiltChance = e.giltChance;
    const isBoss = e.isBoss;
    const isElite = e.elite !== 'none';
    const bossType = e.bossType;

    e.active = false;

    fx.spawnDeathBurst(ex, ey, e.color, e.accent, isBig);
    sound.playKill(isBig);
    hooks.onEnemyKilled(e, player);

    // Tarnish Globule splits into 2 Mini-Globules
    if (eType === 'tarnish_globule' && !isBoss) {
      for (let k = 0; k < 2; k++) {
        const angle = (k === 0 ? 1 : -1) * 1.1 + rng.range(-0.4, 0.4);
        const child = this.spawnEnemy(
          'mini_globule',
          ex + Math.cos(angle) * 14,
          ey + Math.sin(angle) * 14,
          1,
          'none',
          modifier,
          rng,
        );
        if (child) {
          // Inherit scaled stats relative to parent
          child.maxHp = Math.max(10, Math.round(eMaxHp * 0.28));
          child.hp = child.maxHp;
          child.kbVx = Math.cos(angle) * 155;
          child.kbVy = Math.sin(angle) * 155;
        }
      }
    }

    // Spawn pickups
    if (isBoss && bossType) {
      const bDef = BOSS_DEFS[bossType];
      // Scatter several large rubies + gilt + guaranteed relic chest
      for (let i = 0; i < 6; i++) {
        const a = (i * TWO_PI) / 6;
        this.spawnPickup(
          'ruby_large',
          ex + Math.cos(a) * 28,
          ey + Math.sin(a) * 28,
          Math.ceil(bDef.xpReward / 6),
          true,
        );
      }
      const giltTotal = Math.round(bDef.giltReward * (modifier?.giltMult ?? 1));
      const giltPieces = 5;
      const perCoin = Math.max(1, Math.round(giltTotal / giltPieces));
      for (let i = 0; i < giltPieces; i++) {
        const a = (i * TWO_PI) / giltPieces + 0.3;
        this.spawnPickup('gilt', ex + Math.cos(a) * 34, ey + Math.sin(a) * 34, perCoin, true);
      }
      this.spawnPickup('relic_chest', ex, ey, 1, false);
      this.spawnPickup('heal', ex + 18, ey - 18, 25, false);
    } else {
      const rubyKind: PickupKind = eXp >= 12 || isElite ? 'ruby_large' : 'ruby';
      this.spawnPickup(rubyKind, ex, ey, eXp, false);

      const giltProb = eGiltChance * (modifier?.giltMult ?? 1);
      if (rng.chance(giltProb)) {
        const giltVal = isElite ? 5 : 1;
        this.spawnPickup('gilt', ex + rng.range(-10, 10), ey + rng.range(-10, 10), giltVal, false);
      }

      if (isElite) {
        this.spawnPickup('relic_chest', ex + 8, ey - 8, 1, false);
      } else {
        const lowHpBoost = player.hp < player.maxHp * 0.45 ? 0.025 : 0;
        if (rng.chance(0.018 + lowHpBoost)) {
          this.spawnPickup('heal', ex, ey, 18, false);
        }
      }
    }

    // Volatile Spring (and Cataclysm Carillon chain amplification)
    const hasVolatile = player.explosionPct > 0;
    const cataclysmBoost = Boolean(player.evolutions.cataclysm_carillon) && fromCataclysm;
    if ((hasVolatile || cataclysmBoost) && this.explosionDepth < 2) {
      this.explosionDepth++;
      const pct = hasVolatile ? player.explosionPct : 0.32;
      const mult = player.evolutions.cataclysm_carillon ? 1.5 : 1.0;
      const blastRadius = 78 * player.areaMult * (player.evolutions.cataclysm_carillon ? 1.28 : 1);
      const blastDamage = Math.min(480, Math.max(16, eMaxHp * pct * mult)) * player.damageMult;

      const ring = fx.spawnShockwave(true, ex, ey, blastRadius, '#FF9F1C', 0, 3.5, 0.26);
      if (ring) ring.applied = true;
      fx.spawnBurst(ex, ey, '#FF9F1C', 8, 90, 230, 2.2, 4.4, 'spark');
      hooks.onExplosionTriggered(isBig);

      spatialHash.query(ex, ey, blastRadius, this.blastScratch);
      // Copy refs since nested kills could reuse blastScratch if depth > 1
      const targets = this.blastScratch.slice();
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (!target.active) continue;
        const dx = target.x - ex;
        const dy = target.y - ey;
        const d = Math.hypot(dx, dy);
        if (d <= blastRadius + target.radius) {
          const inv = d > 0.001 ? 1 / d : 0;
          this.damageEnemy(
            target,
            blastDamage,
            false,
            dx * inv * 130,
            dy * inv * 130,
            player,
            fx,
            sound,
            spatialHash,
            hooks,
            rng,
            modifier,
            { fromCataclysm: Boolean(player.evolutions.cataclysm_carillon) },
          );
        }
      }
      this.explosionDepth--;
    }
  }

  public updateEnemies(
    dt: number,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    spatialHash: SpatialHash<EnemyEntity>,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    const items = this.enemies.items;
    const chronoMult = player.chronoSlowTimer > 0 ? 0.45 : 1.0;
    const kbDamp = Math.exp(-10 * dt);

    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      if (!e.active) continue;

      // Decay hit flash, squash, slow
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (e.squash > 0) e.squash = Math.max(0, e.squash - dt * 5.2);
      if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);

      // Burn DoT
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        const burnTick = e.burnDps * dt;
        e.hp -= burnTick;
        if (Math.random() < dt * 7) {
          fx.spawnBurst(e.x, e.y, '#FF9F1C', 1, 20, 65, 1.5, 2.8, 'dot');
        }
        if (e.hp <= 0) {
          this.killEnemy(e, player, fx, sound, spatialHash, hooks, rng, modifier, false);
          continue;
        }
      }

      const slowMult = e.slowTimer > 0 ? 0.52 : 1.0;
      const effSpeed = e.speed * chronoMult * slowMult;
      const effDt = dt * chronoMult * slowMult;

      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.hypot(dx, dy);
      const nx = dist > 0.001 ? dx / dist : 1;
      const ny = dist > 0.001 ? dy / dist : 0;

      if (e.isBoss) {
        this.updateBossAi(e, effDt, effSpeed, dx, dy, dist, nx, ny, player, fx, sound, hooks, rng, modifier);
      } else {
        this.updateRegularAi(e, effDt, effSpeed, dx, dy, dist, nx, ny, player, fx, sound, spatialHash, hooks, rng, modifier);
      }

      if (!e.active) continue;

      // Soft separation using spatial hash (non-bosses)
      let sepX = 0;
      let sepY = 0;
      if (!e.isBoss) {
        spatialHash.query(e.x, e.y, e.radius * 2.15, this.sepScratch);
        const len = Math.min(this.sepScratch.length, 10);
        for (let j = 0; j < len; j++) {
          const o = this.sepScratch[j];
          if (o === e || !o.active) continue;
          const sx = e.x - o.x;
          const sy = e.y - o.y;
          const minDist = e.radius + o.radius;
          const dSq = sx * sx + sy * sy;
          if (dSq < minDist * minDist && dSq > 0.0001) {
            const d = Math.sqrt(dSq);
            const push = ((minDist - d) / minDist) * 140;
            sepX += (sx / d) * push;
            sepY += (sy / d) * push;
          }
        }
      }

      // Integrate velocity, knockback & separation
      e.x += (e.vx + e.kbVx + sepX) * dt;
      e.y += (e.vy + e.kbVy + sepY) * dt;
      e.kbVx *= kbDamp;
      e.kbVy *= kbDamp;

      // Clamp inside arena perimeter
      const maxR = ARENA_RADIUS - e.radius;
      const rCenter = Math.hypot(e.x, e.y);
      if (rCenter > maxR && rCenter > 0.001) {
        const s = maxR / rCenter;
        e.x *= s;
        e.y *= s;
      }

      // Contact damage with player
      const hitDist = player.radius + e.radius - 3;
      const pDx = player.x - e.x;
      const pDy = player.y - e.y;
      if (pDx * pDx + pDy * pDy <= hitDist * hitDist) {
        hooks.onPlayerHit(e.damage, e.x, e.y);
      }
    }

    // Check hostile shockwave rings against player
    const shockwaves = fx.shockwaves.items;
    for (let i = 0; i < shockwaves.length; i++) {
      const s = shockwaves[i];
      if (!s.active || s.friendly || s.applied || s.damage <= 0) continue;
      if (s.radius >= s.maxRadius * 0.55) {
        s.applied = true;
        const d = Math.hypot(player.x - s.x, player.y - s.y);
        if (d <= s.maxRadius + player.radius * 0.5) {
          hooks.onPlayerHit(s.damage, s.x, s.y);
        }
      }
    }
  }

  private updateRegularAi(
    e: EnemyEntity,
    effDt: number,
    effSpeed: number,
    _dx: number,
    _dy: number,
    dist: number,
    nx: number,
    ny: number,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    spatialHash: SpatialHash<EnemyEntity>,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    switch (e.type) {
      case 'rust_mite':
      case 'mini_globule': {
        const wobble = Math.sin(e.spin * 2.5 + e.id) * 0.22;
        const cosW = Math.cos(wobble);
        const sinW = Math.sin(wobble);
        e.vx = (nx * cosW - ny * sinW) * effSpeed;
        e.vy = (nx * sinW + ny * cosW) * effSpeed;
        e.angle = Math.atan2(e.vy, e.vx);
        e.spin += effDt * 4.5;
        break;
      }

      case 'tarnish_globule': {
        e.vx = nx * effSpeed;
        e.vy = ny * effSpeed;
        e.angle = Math.atan2(e.vy, e.vx);
        e.spin += effDt * 2.2;
        break;
      }

      case 'burr_sprocket': {
        e.aiTimer -= effDt;
        if (e.aiState === 0) {
          e.vx = nx * effSpeed;
          e.vy = ny * effSpeed;
          e.spin += effDt * 3.5;
          if (dist < 245 && e.aiTimer <= 0) {
            e.aiState = 1;
            e.aiTimer = 0.55;
            const dashDist = Math.min(310, dist + 120);
            e.aiTargetX = e.x + nx * dashDist;
            e.aiTargetY = e.y + ny * dashDist;
            fx.spawnTelegraph('line', e.x, e.y, e.aiTargetX, e.aiTargetY, e.radius * 0.85, '#FF9F1C', 0.55);
          }
        } else if (e.aiState === 1) {
          // Wind-up
          e.vx *= 0.75;
          e.vy *= 0.75;
          e.spin += effDt * 16;
          if (e.aiTimer <= 0) {
            e.aiState = 2;
            e.aiTimer = 0.42;
            const ddx = e.aiTargetX - e.x;
            const ddy = e.aiTargetY - e.y;
            const dd = Math.hypot(ddx, ddy) || 1;
            e.vx = (ddx / dd) * effSpeed * 2.6;
            e.vy = (ddy / dd) * effSpeed * 2.6;
          }
        } else {
          // Dash
          e.spin += effDt * 22;
          if (e.aiTimer <= 0) {
            e.aiState = 0;
            e.aiTimer = 2.2;
          }
        }
        break;
      }

      case 'magnet_needle': {
        e.aiTimer -= effDt;
        e.angle = Math.atan2(ny, nx);
        if (e.aiState === 0) {
          const strafe = (e.id % 2 === 0 ? 1 : -1) * 0.48;
          let radial = 0;
          if (dist > 265) radial = 1;
          else if (dist < 175) radial = -0.85;
          const tx = nx * radial - ny * strafe;
          const ty = ny * radial + nx * strafe;
          e.vx = tx * effSpeed;
          e.vy = ty * effSpeed;

          if (e.aiTimer <= 0 && dist < 440) {
            e.aiState = 1;
            e.aiTimer = 0.5;
            e.aiTargetX = e.x + nx * 320;
            e.aiTargetY = e.y + ny * 320;
            fx.spawnTelegraph('line', e.x, e.y, e.aiTargetX, e.aiTargetY, 5, '#FF2E63', 0.5);
          }
        } else {
          e.vx *= 0.7;
          e.vy *= 0.7;
          if (e.aiTimer <= 0) {
            const adx = e.aiTargetX - e.x;
            const ady = e.aiTargetY - e.y;
            const ad = Math.hypot(adx, ady) || 1;
            const spd = 290;
            hooks.onSpawnHostileProjectile(
              'enemy_dart',
              e.x + (adx / ad) * e.radius,
              e.y + (ady / ad) * e.radius,
              (adx / ad) * spd,
              (ady / ad) * spd,
              6,
              e.damage,
              '#FF2E63',
            );
            e.aiState = 0;
            e.aiTimer = 2.25;
          }
        }
        break;
      }

      case 'pendulum_brute': {
        e.aiTimer -= effDt;
        e.angle = Math.atan2(ny, nx);
        if (e.aiState === 0) {
          e.vx = nx * effSpeed;
          e.vy = ny * effSpeed;
          if (dist < 155 && e.aiTimer <= 0) {
            e.aiState = 1;
            e.aiTimer = 0.75;
            fx.spawnTelegraph('circle', e.x, e.y, 0, 0, 120, '#F59E0B', 0.75);
          }
        } else {
          e.vx *= 0.72;
          e.vy *= 0.72;
          if (e.aiTimer <= 0) {
            fx.spawnShockwave(false, e.x, e.y, 120, '#F59E0B', e.damage * 1.2, 5, 0.36);
            hooks.onExplosionTriggered(false);
            e.aiState = 0;
            e.aiTimer = 3.0;
          }
        }
        break;
      }

      case 'overwound_coil': {
        if (e.aiState === 0) {
          e.vx = nx * effSpeed;
          e.vy = ny * effSpeed;
          e.spin += effDt * 8;
          if (dist <= 95) {
            e.aiState = 1;
            e.aiTimer = 0.72;
            fx.spawnTelegraph('circle', e.x, e.y, 0, 0, 105, '#FF2E63', 0.72);
          }
        } else {
          e.aiTimer -= effDt;
          e.vx = nx * effSpeed * 0.35;
          e.vy = ny * effSpeed * 0.35;
          e.spin += effDt * 22;
          if (e.aiTimer <= 0) {
            // Detonate: damages player AND nearby enemies!
            const blastR = 105;
            fx.spawnDeathBurst(e.x, e.y, '#FF595E', '#FFCA3A', true);
            const ring = fx.spawnShockwave(false, e.x, e.y, blastR, '#FF2E63', 0, 5, 0.32);
            if (ring) ring.applied = true;
            hooks.onExplosionTriggered(true);

            if (Math.hypot(player.x - e.x, player.y - e.y) <= blastR + player.radius * 0.4) {
              hooks.onPlayerHit(e.damage * 1.25, e.x, e.y);
            }

            spatialHash.query(e.x, e.y, blastR, this.blastScratch);
            const targets = this.blastScratch.slice();
            e.active = false;
            for (let j = 0; j < targets.length; j++) {
              const t = targets[j];
              if (!t.active || t === e) continue;
              const tdx = t.x - e.x;
              const tdy = t.y - e.y;
              const td = Math.hypot(tdx, tdy);
              if (td <= blastR + t.radius) {
                const inv = td > 0.001 ? 1 / td : 0;
                const blastDmg = e.damage * (t.isBoss ? 1.5 : 2.6);
                this.damageEnemy(
                  t,
                  blastDmg,
                  false,
                  tdx * inv * 180,
                  tdy * inv * 180,
                  player,
                  fx,
                  sound,
                  spatialHash,
                  hooks,
                  rng,
                  modifier,
                );
              }
            }
          }
        }
        break;
      }
    }
  }

  private updateBossAi(
    e: EnemyEntity,
    effDt: number,
    effSpeed: number,
    _dx: number,
    _dy: number,
    dist: number,
    nx: number,
    ny: number,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    e.spin += effDt * (e.phase >= 2 ? 2.6 : 1.5);
    e.angle = Math.atan2(ny, nx);

    // Phase 2 transition at 50% HP
    if (e.phase === 1 && e.hp <= e.maxHp * 0.5) {
      e.phase = 2;
      const ring = fx.spawnShockwave(false, e.x, e.y, 190, '#FF5400', 0, 6, 0.45);
      if (ring) ring.applied = true;
      fx.spawnTextPopup(
        e.x,
        e.y - e.radius - 16,
        e.bossType === 'grand_tourbillon' ? 'OVERDRIVE!' : 'GREAT DIAL UNWOUND!',
        '#FF5400',
        1.4,
      );
      sound.playBossSpawn();
      e.aiState = 0;
      e.aiTimer = 0.7;
    }

    if (e.bossType === 'grand_tourbillon') {
      e.aiTimer -= effDt;
      if (e.phase === 1) {
        e.vx = nx * effSpeed;
        e.vy = ny * effSpeed;
        if (e.aiTimer <= 0) {
          // Rotating 8-orb radial curtain
          const baseA = e.spin;
          const count = 8;
          for (let k = 0; k < count; k++) {
            const a = baseA + (k * TWO_PI) / count;
            hooks.onSpawnHostileProjectile(
              'boss_orb',
              e.x + Math.cos(a) * e.radius,
              e.y + Math.sin(a) * e.radius,
              Math.cos(a) * 205,
              Math.sin(a) * 205,
              7.5,
              e.damage * 0.85,
              '#FF2E63',
            );
          }
          e.aiTimer = 1.65;
        }
      } else {
        // Phase 2: spiral bullet streams + telegraphed dash charge lanes
        if (e.aiState === 0) {
          e.vx = nx * effSpeed * 1.15;
          e.vy = ny * effSpeed * 1.15;
          if (e.aiTimer <= 0) {
            // Fire 3-stream spiral burst
            const spiralAngle = e.spin * 1.6;
            for (let k = 0; k < 3; k++) {
              const a = spiralAngle + (k * TWO_PI) / 3;
              hooks.onSpawnHostileProjectile(
                'boss_orb',
                e.x + Math.cos(a) * e.radius,
                e.y + Math.sin(a) * e.radius,
                Math.cos(a) * 235,
                Math.sin(a) * 235,
                8,
                e.damage * 0.9,
                '#FF5400',
              );
            }
            e.phase = 2;
            // Use aiTargetX as spiral burst counter
            e.aiTargetX += 1;
            if (e.aiTargetX >= 6) {
              e.aiTargetX = 0;
              e.aiState = 1;
              e.aiTimer = 0.65;
              const dashLen = Math.min(420, dist + 170);
              e.aiTargetX = e.x + nx * dashLen;
              e.aiTargetY = e.y + ny * dashLen;
              fx.spawnTelegraph('line', e.x, e.y, e.aiTargetX, e.aiTargetY, e.radius * 0.72, '#FF5400', 0.65);
            } else {
              e.aiTimer = 0.25;
            }
          }
        } else if (e.aiState === 1) {
          e.vx *= 0.75;
          e.vy *= 0.75;
          if (e.aiTimer <= 0) {
            e.aiState = 2;
            e.aiTimer = 0.5;
            const ddx = e.aiTargetX - e.x;
            const ddy = e.aiTargetY - e.y;
            const dd = Math.hypot(ddx, ddy) || 1;
            e.vx = (ddx / dd) * effSpeed * 3.4;
            e.vy = (ddy / dd) * effSpeed * 3.4;
          }
        } else {
          if (e.aiTimer <= 0) {
            e.aiState = 0;
            e.aiTimer = 0.85;
            e.aiTargetX = 0;
          }
        }
      }
      return;
    }

    // Boss 2: Mainspring Leviathan
    e.aiTimer -= effDt;
    if (e.aiState === 0) {
      e.vx = nx * effSpeed * (e.phase >= 2 ? 1.15 : 1.0);
      e.vy = ny * effSpeed * (e.phase >= 2 ? 1.15 : 1.0);
      if (e.aiTimer <= 0) {
        // Rotate between Beam (1), Chime Ring (2), Summon (3)
        const nextMove = ((Math.floor(e.aiTargetY) % 3) + 1) as 1 | 2 | 3;
        e.aiTargetY = nextMove;
        e.aiState = nextMove;
        if (nextMove === 1) {
          e.aiTimer = 0.85;
          e.aiTargetX = Math.atan2(ny, nx);
          const handCount = e.phase >= 2 ? 4 : 2;
          for (let h = 0; h < handCount; h++) {
            const a = e.aiTargetX + (h * TWO_PI) / handCount;
            fx.spawnTelegraph(
              'line',
              e.x,
              e.y,
              e.x + Math.cos(a) * 440,
              e.y + Math.sin(a) * 440,
              14,
              '#FF2E63',
              0.85,
            );
          }
        } else if (nextMove === 2) {
          e.aiTimer = 0.75;
          fx.spawnTelegraph('circle', e.x, e.y, 0, 0, 195, '#F5C542', 0.75);
        } else {
          e.aiTimer = 0.45;
        }
      }
    } else if (e.aiState === 1) {
      // Clock-hand beam windup
      e.vx *= 0.8;
      e.vy *= 0.8;
      if (e.aiTimer <= 0) {
        const handCount = e.phase >= 2 ? 4 : 2;
        const baseA = e.aiTargetX;
        let hitPlayer = false;
        for (let h = 0; h < handCount; h++) {
          const a = baseA + (h * TWO_PI) / handCount;
          const bx = e.x + Math.cos(a) * 440;
          const by = e.y + Math.sin(a) * 440;
          fx.spawnTelegraph('beam', e.x, e.y, bx, by, 18, '#FF2E63', 0.28);
          if (!hitPlayer && pointToSegmentDistSq(player.x, player.y, e.x, e.y, bx, by) <= (18 + player.radius) ** 2) {
            hitPlayer = true;
          }
          // Also launch fast orbs along each hand
          hooks.onSpawnHostileProjectile(
            'boss_orb',
            e.x + Math.cos(a) * e.radius,
            e.y + Math.sin(a) * e.radius,
            Math.cos(a) * 265,
            Math.sin(a) * 265,
            8,
            e.damage * 0.85,
            '#FF2E63',
          );
        }
        if (hitPlayer) {
          hooks.onPlayerHit(e.damage * 1.15, e.x, e.y);
        }
        hooks.onExplosionTriggered(true);
        e.aiState = 0;
        e.aiTimer = e.phase >= 2 ? 1.1 : 1.5;
      }
    } else if (e.aiState === 2) {
      // Hostile chime ring windup
      e.vx *= 0.75;
      e.vy *= 0.75;
      if (e.aiTimer <= 0) {
        fx.spawnShockwave(false, e.x, e.y, 195, '#FF2E63', e.damage * 1.25, 6, 0.42);
        const orbCount = e.phase >= 2 ? 12 : 8;
        for (let k = 0; k < orbCount; k++) {
          const a = e.spin + (k * TWO_PI) / orbCount;
          hooks.onSpawnHostileProjectile(
            'boss_orb',
            e.x + Math.cos(a) * e.radius,
            e.y + Math.sin(a) * e.radius,
            Math.cos(a) * 210,
            Math.sin(a) * 210,
            7.5,
            e.damage * 0.85,
            '#F5C542',
          );
        }
        hooks.onExplosionTriggered(true);
        e.aiState = 0;
        e.aiTimer = e.phase >= 2 ? 1.0 : 1.4;
      }
    } else {
      // Summon 2 overwound_coil minions
      e.vx *= 0.8;
      e.vy *= 0.8;
      if (e.aiTimer <= 0) {
        for (let m = 0; m < 2; m++) {
          const offsetAngle = e.angle + (m === 0 ? 1.2 : -1.2);
          const sx = e.x + Math.cos(offsetAngle) * (e.radius + 32);
          const sy = e.y + Math.sin(offsetAngle) * (e.radius + 32);
          this.spawnEnemy('overwound_coil', sx, sy, 10, 'none', modifier, rng);
          fx.spawnBurst(sx, sy, '#FF595E', 8, 50, 140, 2.5, 4.5, 'spark');
        }
        fx.spawnTextPopup(e.x, e.y - e.radius - 10, 'COILS DEPLOYED!', '#FFCA3A', 1.1);
        e.aiState = 0;
        e.aiTimer = e.phase >= 2 ? 1.15 : 1.6;
      }
    }
  }

  public updatePickups(
    dt: number,
    player: PlayerState,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
  ): void {
    if (this.pickupStreakTimer > 0) {
      this.pickupStreakTimer -= dt;
      if (this.pickupStreakTimer <= 0) {
        this.pickupStreak = 0;
      }
    }

    const items = this.pickups.items;
    const magR = player.magnetRadius;
    const magRSq = magR * magR;
    const drag = Math.exp(-5.5 * dt);

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;

      p.age += dt;
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      const dSq = dx * dx + dy * dy;

      if (!p.magnetized && p.kind !== 'relic_chest' && dSq <= magRSq) {
        p.magnetized = true;
      }
      if (!p.magnetized && p.kind === 'relic_chest' && dSq <= (magR * 0.65) ** 2) {
        p.magnetized = true;
      }

      if (p.magnetized) {
        const d = Math.sqrt(dSq) || 1;
        const pullSpeed = Math.min(720, 320 + p.age * 160);
        p.vx = (dx / d) * pullSpeed;
        p.vy = (dy / d) * pullSpeed;
      } else {
        p.vx *= drag;
        p.vy *= drag;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Clamp within arena
      const rCenter = Math.hypot(p.x, p.y);
      if (rCenter > ARENA_RADIUS - 16) {
        const s = (ARENA_RADIUS - 16) / rCenter;
        p.x *= s;
        p.y *= s;
      }

      const collectR = player.radius + p.radius + 8;
      if (dSq <= collectR * collectR) {
        p.active = false;
        if (p.kind === 'ruby' || p.kind === 'ruby_large') {
          this.pickupStreak = Math.min(15, this.pickupStreak + 1);
          this.pickupStreakTimer = PICKUP_STREAK_WINDOW;
          sound.playPickup(p.kind, this.pickupStreak);
          hooks.onPickupXp(p.value * player.xpMult);
        } else if (p.kind === 'gilt') {
          sound.playPickup('gilt', 0);
          const gain = Math.max(1, Math.round(p.value * player.giltMult));
          hooks.onPickupGilt(gain);
          fx.spawnTextPopup(p.x, p.y - 10, `+${gain} Gilt`, '#F5C542', 0.92);
        } else if (p.kind === 'heal') {
          sound.playPickup('heal', 0);
          hooks.onPlayerHeal(p.value);
          fx.spawnTextPopup(p.x, p.y - 12, `+${Math.round(p.value)} HP`, '#2EC4B6', 1.05);
        } else if (p.kind === 'relic_chest') {
          sound.playPickup('relic_chest', 0);
          fx.spawnBurst(p.x, p.y, '#F5C542', 18, 70, 220, 3, 5.5, 'diamond');
          fx.spawnTextPopup(p.x, p.y - 16, 'RELIC CHEST!', '#FFD166', 1.25);
          hooks.onRelicChest();
        }
      }
    }
  }
}
