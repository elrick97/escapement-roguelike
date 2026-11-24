import { ObjectPool } from '../engine/pool';
import type { SpatialHash } from '../engine/spatialHash';
import type { FxManager } from '../render/particles';
import type { OrbitalVisual } from '../render/renderer';
import {
  ARENA_RADIUS,
  type EnemyEntity,
  type PlayerState,
  type ProjectileEntity,
  type ProjectileKind,
  type SoundEngine,
  type WaveModifier,
  type WeaponId,
} from '../types';
import type { SeededRNG } from '../utils/rng';
import type { EnemyEventHooks, EnemySystem } from './enemies';
import {
  getEvolutionRarityMult,
  getProjectileDamageMult,
  getProjectileSpeedMult,
  getWeaponRarityMult,
} from './upgrades';

const TWO_PI = Math.PI * 2;

interface DelayedShockwave {
  delay: number;
  x: number;
  y: number;
  maxRadius: number;
  damage: number;
  color: string;
  lineWidth: number;
  duration: number;
}

export class CombatSystem {
  public readonly projectiles: ObjectPool<ProjectileEntity>;
  public readonly orbitals: OrbitalVisual[] = [];

  private readonly orbitalPool: OrbitalVisual[] = [];
  private readonly cooldowns: Record<WeaponId, number> = {
    escapement_bolt: 0.1,
    ruby_prism: 0.4,
    tourbillon_orbit: 0,
    chime_hammer: 0.8,
    hairspring_arc: 0.5,
    pendulum_scythe: 0.6,
  };

  private orbitAngleInner = 0;
  private orbitAngleOuter = 0;
  private orrerySparkTimer = 0.45;
  private readonly orbitalHitCooldowns = new Map<number, number>();
  private readonly pendingShockwaves: DelayedShockwave[] = [];

  // Reusable scratch arrays
  private readonly queryScratch: EnemyEntity[] = [];
  private readonly aoEScratch: EnemyEntity[] = [];
  private readonly chainedIdsScratch: number[] = [];
  private readonly arcPointsScratch: Array<{ x: number; y: number }> = [];

  constructor() {
    this.projectiles = new ObjectPool<ProjectileEntity>(280, () => ({
      active: false,
      friendly: true,
      kind: 'bolt',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 5,
      damage: 18,
      isCrit: false,
      pierce: 1,
      bounces: 0,
      life: 1,
      maxLife: 1,
      color: '#4CC9F0',
      accent: '#FFFFFF',
      angle: 0,
      spin: 0,
      explosiveRadius: 0,
      knockback: 100,
      hitIds: [],
      originX: 0,
      originY: 0,
      returnPhase: false,
      orbitAngle: 0,
      orbitRadius: 0,
      orbitSpeed: 0,
    }));

    for (let i = 0; i < 10; i++) {
      this.orbitalPool.push({
        x: 0,
        y: 0,
        radius: 14,
        angle: 0,
        evolved: false,
        ring: 0,
      });
    }
  }

  public clear(): void {
    this.projectiles.releaseAll();
    this.orbitals.length = 0;
    this.orbitalHitCooldowns.clear();
    this.pendingShockwaves.length = 0;
    this.cooldowns.escapement_bolt = 0.1;
    this.cooldowns.ruby_prism = 0.4;
    this.cooldowns.tourbillon_orbit = 0;
    this.cooldowns.chime_hammer = 0.8;
    this.cooldowns.hairspring_arc = 0.5;
    this.cooldowns.pendulum_scythe = 0.6;
    this.orbitAngleInner = 0;
    this.orbitAngleOuter = 0;
    this.orrerySparkTimer = 0.45;
  }

  public spawnHostileProjectile(
    kind: 'enemy_dart' | 'boss_orb',
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    damage: number,
    color: string,
  ): void {
    const p = this.projectiles.acquire();
    if (!p) return;

    p.friendly = false;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.radius = radius;
    p.damage = damage;
    p.isCrit = false;
    p.pierce = 1;
    p.bounces = 0;
    p.life = 4.2;
    p.maxLife = 4.2;
    p.color = color;
    p.accent = '#FFFFFF';
    p.angle = Math.atan2(vy, vx);
    p.spin = 0;
    p.explosiveRadius = 0;
    p.knockback = 0;
    p.hitIds.length = 0;
    p.returnPhase = false;
  }

  private spawnFriendlyProjectile(
    kind: ProjectileKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    damage: number,
    isCrit: boolean,
    pierce: number,
    bounces: number,
    life: number,
    color: string,
    explosiveRadius: number,
    knockback: number,
    spin = 0,
  ): ProjectileEntity | null {
    const p = this.projectiles.acquire();
    if (!p) return null;

    p.friendly = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.radius = radius;
    p.damage = damage;
    p.isCrit = isCrit;
    p.pierce = Math.max(1, pierce);
    p.bounces = Math.max(0, bounces);
    p.life = life;
    p.maxLife = life;
    p.color = color;
    p.accent = '#FFFFFF';
    p.angle = Math.atan2(vy, vx);
    p.spin = spin;
    p.explosiveRadius = explosiveRadius;
    p.knockback = knockback;
    p.hitIds.length = 0;
    p.originX = x;
    p.originY = y;
    p.returnPhase = false;
    p.orbitAngle = p.angle;
    p.orbitRadius = 0;
    p.orbitSpeed = 0;
    return p;
  }

  private rollCrit(player: PlayerState, rng: SeededRNG, bonusCrit = 0): boolean {
    return rng.chance(Math.min(0.95, player.critChance + bonusCrit));
  }

  public update(
    dt: number,
    player: PlayerState,
    enemySys: EnemySystem,
    spatialHash: SpatialHash<EnemyEntity>,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    const effectiveAttackSpeed =
      player.attackSpeedMult * (player.anchorActive ? 1.3 + player.anchorFireBonus : 1);

    // 1. Decay orbital hit cooldowns
    if (this.orbitalHitCooldowns.size > 0) {
      for (const [eid, cd] of this.orbitalHitCooldowns) {
        const next = cd - dt;
        if (next <= 0) {
          this.orbitalHitCooldowns.delete(eid);
        } else {
          this.orbitalHitCooldowns.set(eid, next);
        }
      }
    }

    // 2. Process delayed cascading shockwaves (Cataclysm Carillon)
    for (let i = this.pendingShockwaves.length - 1; i >= 0; i--) {
      const sw = this.pendingShockwaves[i];
      sw.delay -= dt;
      if (sw.delay <= 0) {
        fx.spawnShockwave(
          true,
          player.x,
          player.y,
          sw.maxRadius,
          sw.color,
          sw.damage,
          sw.lineWidth,
          sw.duration,
        );
        sound.playShot('chime');
        this.pendingShockwaves.splice(i, 1);
      }
    }

    // 3. Fire active weapons
    this.updateWeapons(
      dt,
      effectiveAttackSpeed,
      player,
      enemySys,
      spatialHash,
      fx,
      sound,
      hooks,
      rng,
      modifier,
    );

    // 4. Update orbitals (Tourbillon Orbit / Celestial Orrery)
    this.updateOrbitals(
      dt,
      effectiveAttackSpeed,
      player,
      enemySys,
      spatialHash,
      fx,
      sound,
      hooks,
      rng,
      modifier,
    );

    // 5. Update projectiles & resolve collisions
    this.updateProjectiles(
      dt,
      player,
      enemySys,
      spatialHash,
      fx,
      sound,
      hooks,
      rng,
      modifier,
    );

    // 6. Resolve friendly shockwave rings (Chime Hammer / Cataclysm Carillon)
    this.updateFriendlyShockwaves(
      player,
      enemySys,
      spatialHash,
      fx,
      sound,
      hooks,
      rng,
      modifier,
    );
  }

  private updateWeapons(
    dt: number,
    effAtkSpeed: number,
    player: PlayerState,
    enemySys: EnemySystem,
    spatialHash: SpatialHash<EnemyEntity>,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    const rateDt = dt * effAtkSpeed;
    const projDmgMult = getProjectileDamageMult(player);
    const projSpdMult = getProjectileSpeedMult(player);

    // 1. Escapement Bolt -> Perpetual Barrage
    const boltLv = player.weapons.escapement_bolt ?? 0;
    if (boltLv > 0 || player.evolutions.perpetual_barrage) {
      this.cooldowns.escapement_bolt -= rateDt;
      if (this.cooldowns.escapement_bolt <= 0) {
        const evolved = Boolean(player.evolutions.perpetual_barrage);
        const target = enemySys.findNearestEnemy(player.x, player.y, 620);
        const baseAngle = target
          ? Math.atan2(target.y - player.y, target.x - player.x)
          : player.angle;
        if (target) {
          player.angle = baseAngle;
        }

        if (evolved) {
          this.cooldowns.escapement_bolt = 0.18;
          const count = 5 + player.bonusProjectiles;
          const evoMult = getEvolutionRarityMult(player, 'perpetual_barrage');
          const baseDmg = 34 * evoMult * player.damageMult * projDmgMult;
          const speed = 680 * projSpdMult;
          const spread = 0.105;
          const startA = baseAngle - ((count - 1) * spread) * 0.5;
          for (let i = 0; i < count; i++) {
            const a = startA + i * spread;
            const crit = this.rollCrit(player, rng, 0.08);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            this.spawnFriendlyProjectile(
              'gilded_bolt',
              player.x + Math.cos(a) * 14,
              player.y + Math.sin(a) * 14,
              Math.cos(a) * speed,
              Math.sin(a) * speed,
              6.5 * Math.min(1.4, player.areaMult),
              dmg,
              crit,
              2 + player.bonusBounce,
              0,
              1.1,
              '#FFD166',
              48 * player.areaMult,
              115,
            );
          }
          sound.playShot('gilded');
        } else {
          this.cooldowns.escapement_bolt = 0.42 * Math.pow(0.9, boltLv - 1);
          const count =
            1 +
            (boltLv >= 2 ? 1 : 0) +
            (boltLv >= 4 ? 1 : 0) +
            player.bonusProjectiles;
          const pierce =
            1 +
            (boltLv >= 3 ? 1 : 0) +
            (boltLv >= 5 ? 1 : 0) +
            player.bonusBounce;
          const wMult = getWeaponRarityMult(player, 'escapement_bolt');
          const baseDmg = (18 + boltLv * 5) * wMult * player.damageMult * projDmgMult;
          const speed = 560 * (boltLv >= 4 ? 1.15 : 1) * projSpdMult;
          const spread = 0.085;
          const startA = baseAngle - ((count - 1) * spread) * 0.5;
          for (let i = 0; i < count; i++) {
            const a = startA + i * spread;
            const crit = this.rollCrit(player, rng);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            this.spawnFriendlyProjectile(
              'bolt',
              player.x + Math.cos(a) * 12,
              player.y + Math.sin(a) * 12,
              Math.cos(a) * speed,
              Math.sin(a) * speed,
              5 * Math.min(1.4, player.areaMult),
              dmg,
              crit,
              pierce,
              0,
              1.15,
              '#4CC9F0',
              0,
              95,
            );
          }
          sound.playShot('bolt');
        }
      }
    }

    // 2. Ruby Prism -> Prism Singularity
    const prismLv = player.weapons.ruby_prism ?? 0;
    if (prismLv > 0 || player.evolutions.prism_singularity) {
      this.cooldowns.ruby_prism -= rateDt;
      if (this.cooldowns.ruby_prism <= 0) {
        const evolved = Boolean(player.evolutions.prism_singularity);
        const target = enemySys.findNearestEnemy(player.x, player.y, 640);
        const baseAngle = target
          ? Math.atan2(target.y - player.y, target.x - player.x)
          : player.angle;

        if (evolved) {
          this.cooldowns.ruby_prism = 0.76;
          const count = 2 + player.bonusProjectiles;
          const evoMult = getEvolutionRarityMult(player, 'prism_singularity');
          const baseDmg = 48 * evoMult * player.damageMult * projDmgMult;
          const speed = 490 * projSpdMult;
          const spread = 0.24;
          const startA = baseAngle - ((count - 1) * spread) * 0.5;
          for (let i = 0; i < count; i++) {
            const a = startA + i * spread;
            const crit = this.rollCrit(player, rng, 0.2);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            this.spawnFriendlyProjectile(
              'ruby_prism',
              player.x + Math.cos(a) * 12,
              player.y + Math.sin(a) * 12,
              Math.cos(a) * speed,
              Math.sin(a) * speed,
              9 * Math.min(1.45, player.areaMult),
              dmg,
              crit,
              1 + player.bonusBounce,
              5 + player.bonusBounce,
              2.6,
              '#FF2E63',
              0,
              90,
            );
          }
          sound.playShot('prism');
        } else {
          this.cooldowns.ruby_prism = 1.05 * Math.pow(0.92, prismLv - 1);
          const count =
            1 +
            (prismLv >= 3 ? 1 : 0) +
            (prismLv >= 5 ? 1 : 0) +
            player.bonusProjectiles;
          const bounces = 2 + Math.floor(prismLv / 2) + player.bonusBounce;
          const wMult = getWeaponRarityMult(player, 'ruby_prism');
          const baseDmg = (22 + prismLv * 6) * wMult * player.damageMult * projDmgMult;
          const speed = 440 * (prismLv >= 3 ? 1.12 : 1) * projSpdMult;
          const critBonus = prismLv >= 4 ? 0.2 : 0.05;
          const spread = 0.22;
          const startA = baseAngle - ((count - 1) * spread) * 0.5;
          for (let i = 0; i < count; i++) {
            const a = startA + i * spread;
            const crit = this.rollCrit(player, rng, critBonus);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            this.spawnFriendlyProjectile(
              'ruby_prism',
              player.x + Math.cos(a) * 12,
              player.y + Math.sin(a) * 12,
              Math.cos(a) * speed,
              Math.sin(a) * speed,
              7 * Math.min(1.4, player.areaMult),
              dmg,
              crit,
              1 + player.bonusBounce,
              bounces,
              2.2,
              '#FF2E63',
              0,
              80,
            );
          }
          sound.playShot('prism');
        }
      }
    }

    // 3. Chime Hammer -> Cataclysm Carillon
    const chimeLv = player.weapons.chime_hammer ?? 0;
    if (chimeLv > 0 || player.evolutions.cataclysm_carillon) {
      this.cooldowns.chime_hammer -= rateDt;
      if (this.cooldowns.chime_hammer <= 0) {
        const evolved = Boolean(player.evolutions.cataclysm_carillon);
        if (evolved) {
          this.cooldowns.chime_hammer = 1.55;
          const evoMult = getEvolutionRarityMult(player, 'cataclysm_carillon');
          const dmg = 82 * evoMult * player.damageMult;
          const r1 = 175 * player.areaMult;
          fx.spawnShockwave(true, player.x, player.y, r1, '#FFD166', dmg, 5.5, 0.36);
          sound.playShot('chime');
          this.pendingShockwaves.push(
            {
              delay: 0.14,
              x: player.x,
              y: player.y,
              maxRadius: 225 * player.areaMult,
              damage: dmg * 1.05,
              color: '#FF9F1C',
              lineWidth: 5.5,
              duration: 0.38,
            },
            {
              delay: 0.28,
              x: player.x,
              y: player.y,
              maxRadius: 275 * player.areaMult,
              damage: dmg * 1.15,
              color: '#FF2E63',
              lineWidth: 6,
              duration: 0.42,
            },
          );
        } else {
          this.cooldowns.chime_hammer = 2.1 * Math.pow(0.9, chimeLv - 1);
          const wMult = getWeaponRarityMult(player, 'chime_hammer');
          const dmg = (30 + chimeLv * 9) * wMult * player.damageMult;
          const radius = (125 + chimeLv * 16) * player.areaMult;
          fx.spawnShockwave(true, player.x, player.y, radius, '#FFD166', dmg, 4.5, 0.36);
          sound.playShot('chime');
        }
      }
    }

    // 4. Hairspring Arc -> Tesla Chronometer
    const arcLv = player.weapons.hairspring_arc ?? 0;
    if (arcLv > 0 || player.evolutions.tesla_chronometer) {
      this.cooldowns.hairspring_arc -= rateDt;
      if (this.cooldowns.hairspring_arc <= 0) {
        const evolved = Boolean(player.evolutions.tesla_chronometer);
        const firstTarget = enemySys.findNearestEnemy(
          player.x,
          player.y,
          (evolved ? 430 : 350) * Math.min(1.5, player.areaMult),
        );

        if (firstTarget) {
          if (evolved) {
            this.cooldowns.hairspring_arc = 0.68;
          } else {
            this.cooldowns.hairspring_arc = 1.35 * Math.pow(0.91, arcLv - 1);
          }

          const maxChains = evolved
            ? 10 + player.bonusProjectiles
            : 2 + arcLv + Math.floor(player.bonusProjectiles * 0.5);
          const jumpRange = (evolved ? 255 : 205) * player.areaMult;
          const baseDmg = evolved
            ? 46 * getEvolutionRarityMult(player, 'tesla_chronometer') * player.damageMult
            : (20 + arcLv * 6) * getWeaponRarityMult(player, 'hairspring_arc') * player.damageMult;

          this.chainedIdsScratch.length = 0;
          this.arcPointsScratch.length = 0;
          this.arcPointsScratch.push({ x: player.x, y: player.y });

          let curr: EnemyEntity | null = firstTarget;
          let prevX = player.x;
          let prevY = player.y;

          for (let c = 0; c < maxChains && curr !== null; c++) {
            this.chainedIdsScratch.push(curr.id);

            // Add jagged midpoint vertex + target vertex for crisp electric look
            const midX = (prevX + curr.x) * 0.5 + rng.range(-14, 14);
            const midY = (prevY + curr.y) * 0.5 + rng.range(-14, 14);
            this.arcPointsScratch.push({ x: midX, y: midY });
            this.arcPointsScratch.push({ x: curr.x, y: curr.y });

            const crit = evolved ? true : this.rollCrit(player, rng);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            const targetX = curr.x;
            const targetY = curr.y;

            fx.spawnHitSparks(targetX, targetY, evolved ? '#4CC9F0' : '#64DFDF', crit);
            enemySys.damageEnemy(
              curr,
              dmg,
              crit,
              0,
              0,
              player,
              fx,
              sound,
              spatialHash,
              hooks,
              rng,
              modifier,
              { slowSec: evolved ? 0.7 : 0 },
            );

            prevX = targetX;
            prevY = targetY;
            curr = enemySys.findNearestEnemy(
              prevX,
              prevY,
              jumpRange,
              this.chainedIdsScratch,
            );
          }

          fx.spawnLightningArc(
            this.arcPointsScratch,
            evolved ? '#4CC9F0' : '#64DFDF',
            evolved ? 3.2 : 2.5,
            evolved ? 0.2 : 0.16,
          );
          sound.playShot('lightning');
        } else {
          // Retry quickly if no enemy in range
          this.cooldowns.hairspring_arc = 0.18;
        }
      }
    }

    // 5. Pendulum Scythe -> Eclipse Regulator
    const scytheLv = player.weapons.pendulum_scythe ?? 0;
    if (scytheLv > 0 || player.evolutions.eclipse_regulator) {
      this.cooldowns.pendulum_scythe -= rateDt;
      if (this.cooldowns.pendulum_scythe <= 0) {
        const evolved = Boolean(player.evolutions.eclipse_regulator);
        if (evolved) {
          this.cooldowns.pendulum_scythe = 1.35;
          const count = 4 + player.bonusProjectiles;
          const evoMult = getEvolutionRarityMult(player, 'eclipse_regulator');
          const baseDmg = 58 * evoMult * player.damageMult * projDmgMult;
          const baseA = player.angle;
          for (let i = 0; i < count; i++) {
            const a = baseA + (i * TWO_PI) / count;
            const crit = this.rollCrit(player, rng, 0.15);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            const p = this.spawnFriendlyProjectile(
              'eclipse_scythe',
              player.x + Math.cos(a) * 18,
              player.y + Math.sin(a) * 18,
              Math.cos(a) * 410 * projSpdMult,
              Math.sin(a) * 410 * projSpdMult,
              34 * player.areaMult,
              dmg,
              crit,
              999,
              0,
              1.55,
              '#C77DFF',
              0,
              140,
              13,
            );
            if (p) {
              p.orbitSpeed = 2.4;
            }
          }
          sound.playShot('scythe');
        } else {
          this.cooldowns.pendulum_scythe = 1.65 * Math.pow(0.92, scytheLv - 1);
          const count =
            (scytheLv >= 4 ? 3 : scytheLv >= 2 ? 2 : 1) + player.bonusProjectiles;
          const wMult = getWeaponRarityMult(player, 'pendulum_scythe');
          const baseDmg = (26 + scytheLv * 7) * wMult * player.damageMult * projDmgMult;
          const target = enemySys.findNearestEnemy(player.x, player.y, 520);
          const baseA = target
            ? Math.atan2(target.y - player.y, target.x - player.x)
            : player.angle;
          const spread = count > 1 ? 0.55 : 0;
          const startA = baseA - ((count - 1) * spread) * 0.5;
          for (let i = 0; i < count; i++) {
            const a = startA + i * spread;
            const crit = this.rollCrit(player, rng);
            const dmg = crit ? baseDmg * player.critMult : baseDmg;
            const p = this.spawnFriendlyProjectile(
              'scythe',
              player.x + Math.cos(a) * 14,
              player.y + Math.sin(a) * 14,
              Math.cos(a) * 390 * projSpdMult,
              Math.sin(a) * 390 * projSpdMult,
              (22 + scytheLv * 2) * player.areaMult,
              dmg,
              crit,
              999,
              0,
              1.35,
              '#2EC4B6',
              0,
              110,
              11,
            );
            if (p) {
              p.orbitSpeed = 1.15;
            }
          }
          sound.playShot('scythe');
        }
      }
    }
  }

  private updateOrbitals(
    dt: number,
    effAtkSpeed: number,
    player: PlayerState,
    enemySys: EnemySystem,
    spatialHash: SpatialHash<EnemyEntity>,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    this.orbitals.length = 0;
    const orbitLv = player.weapons.tourbillon_orbit ?? 0;
    const evolved = Boolean(player.evolutions.celestial_orrery);
    if (orbitLv <= 0 && !evolved) return;

    if (evolved) {
      this.orbitAngleInner += dt * 3.4 * effAtkSpeed;
      this.orbitAngleOuter -= dt * 2.4 * effAtkSpeed;

      const innerR = 66 * player.areaMult;
      const outerR = 114 * player.areaMult;
      const sawR = 17 * Math.min(1.5, player.areaMult);

      for (let i = 0; i < 4; i++) {
        const a = this.orbitAngleInner + (i * TWO_PI) / 4;
        const o = this.orbitalPool[i];
        o.x = player.x + Math.cos(a) * innerR;
        o.y = player.y + Math.sin(a) * innerR;
        o.radius = sawR;
        o.angle = a * 2.5;
        o.evolved = true;
        o.ring = 0;
        this.orbitals.push(o);
      }
      for (let i = 0; i < 4; i++) {
        const a = this.orbitAngleOuter + (i * TWO_PI) / 4;
        const o = this.orbitalPool[4 + i];
        o.x = player.x + Math.cos(a) * outerR;
        o.y = player.y + Math.sin(a) * outerR;
        o.radius = sawR * 1.1;
        o.angle = -a * 2.2;
        o.evolved = true;
        o.ring = 1;
        this.orbitals.push(o);
      }

      // Periodically emit radial orrery_spark bolts from the outer planetary ring
      this.orrerySparkTimer -= dt * effAtkSpeed;
      if (this.orrerySparkTimer <= 0) {
        this.orrerySparkTimer = 0.48;
        const evoMult = getEvolutionRarityMult(player, 'celestial_orrery');
        const sparkDmg = 28 * evoMult * player.damageMult * getProjectileDamageMult(player);
        for (let i = 4; i < 8; i++) {
          const o = this.orbitals[i];
          const outA = Math.atan2(o.y - player.y, o.x - player.x);
          const crit = this.rollCrit(player, rng);
          this.spawnFriendlyProjectile(
            'orrery_spark',
            o.x,
            o.y,
            Math.cos(outA) * 460,
            Math.sin(outA) * 460,
            6,
            crit ? sparkDmg * player.critMult : sparkDmg,
            crit,
            1 + player.bonusBounce,
            0,
            0.85,
            '#FFF3B0',
            0,
            75,
          );
        }
      }

      // Celestial Orrery saws vaporize enemy projectiles!
      const projs = this.projectiles.items;
      for (let pi = 0; pi < projs.length; pi++) {
        const p = projs[pi];
        if (!p.active || p.friendly) continue;
        for (let oi = 0; oi < this.orbitals.length; oi++) {
          const o = this.orbitals[oi];
          const dx = p.x - o.x;
          const dy = p.y - o.y;
          const hitR = o.radius + p.radius;
          if (dx * dx + dy * dy <= hitR * hitR) {
            p.active = false;
            fx.spawnBurst(p.x, p.y, '#4CC9F0', 4, 40, 130, 1.8, 3.2, 'spark');
            break;
          }
        }
      }
    } else {
      const count = Math.min(
        8,
        1 + orbitLv + Math.floor(player.bonusProjectiles * 0.5),
      );
      const spinSpeed = (2.6 + orbitLv * 0.32) * effAtkSpeed;
      this.orbitAngleInner += dt * spinSpeed;
      const orbitR = (68 + orbitLv * 6) * player.areaMult;
      const sawR = (13 + orbitLv * 0.8) * Math.min(1.45, player.areaMult);

      for (let i = 0; i < count; i++) {
        const a = this.orbitAngleInner + (i * TWO_PI) / count;
        const o = this.orbitalPool[i];
        o.x = player.x + Math.cos(a) * orbitR;
        o.y = player.y + Math.sin(a) * orbitR;
        o.radius = sawR;
        o.angle = a * 2.5;
        o.evolved = false;
        o.ring = 0;
        this.orbitals.push(o);
      }
    }

    // Orbital damage collisions
    const baseDmg = evolved
      ? 38 * getEvolutionRarityMult(player, 'celestial_orrery') * player.damageMult
      : (14 + orbitLv * 4) * getWeaponRarityMult(player, 'tourbillon_orbit') * player.damageMult;
    const kbStrength = evolved ? 150 : 95 + orbitLv * 12;

    for (let i = 0; i < this.orbitals.length; i++) {
      const o = this.orbitals[i];
      spatialHash.query(o.x, o.y, o.radius + 32, this.queryScratch);
      for (let j = 0; j < this.queryScratch.length; j++) {
        const e = this.queryScratch[j];
        if (!e.active) continue;
        if (this.orbitalHitCooldowns.has(e.id)) continue;

        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const hitR = o.radius + e.radius;
        if (dx * dx + dy * dy <= hitR * hitR) {
          this.orbitalHitCooldowns.set(e.id, evolved ? 0.2 : 0.28);
          const crit = this.rollCrit(player, rng);
          const dmg = crit ? baseDmg * player.critMult : baseDmg;
          const dist = Math.hypot(dx, dy) || 1;
          fx.spawnHitSparks(
            e.x - (dx / dist) * e.radius * 0.4,
            e.y - (dy / dist) * e.radius * 0.4,
            evolved ? '#4CC9F0' : '#F5C542',
            crit,
          );
          enemySys.damageEnemy(
            e,
            dmg,
            crit,
            (dx / dist) * kbStrength,
            (dy / dist) * kbStrength,
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

  private updateProjectiles(
    dt: number,
    player: PlayerState,
    enemySys: EnemySystem,
    spatialHash: SpatialHash<EnemyEntity>,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    const items = this.projectiles.items;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      // Boomerang scythe motion
      if (p.kind === 'scythe' || p.kind === 'eclipse_scythe') {
        p.angle += p.spin * dt;
        if (!p.returnPhase && p.life <= p.maxLife * 0.52) {
          p.returnPhase = true;
          p.hitIds.length = 0; // Hits again on the return sweep!
        }

        if (p.returnPhase) {
          const dx = player.x - p.x;
          const dy = player.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 26) {
            p.active = false;
            continue;
          }
          const spd = p.kind === 'eclipse_scythe' ? 540 : 480;
          const targetVx = (dx / d) * spd;
          const targetVy = (dy / d) * spd;
          const steer = Math.min(1, dt * 8.5);
          p.vx += (targetVx - p.vx) * steer;
          p.vy += (targetVy - p.vy) * steer;
        } else if (p.orbitSpeed !== 0) {
          // Gentle curved sweep outward
          const rot = p.orbitSpeed * dt;
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          const nvx = p.vx * cosR - p.vy * sinR;
          const nvy = p.vx * sinR + p.vy * cosR;
          p.vx = nvx;
          p.vy = nvy;
        }
      } else {
        p.angle = Math.atan2(p.vy, p.vx);
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Arena perimeter check
      const rSq = p.x * p.x + p.y * p.y;
      if (rSq > (ARENA_RADIUS + 40) * (ARENA_RADIUS + 40)) {
        p.active = false;
        continue;
      }

      // Hostile projectile vs Player
      if (!p.friendly) {
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        const hitR = player.radius + p.radius * 0.78;
        if (dx * dx + dy * dy <= hitR * hitR) {
          p.active = false;
          hooks.onPlayerHit(p.damage, p.x, p.y);
        }
        continue;
      }

      // Friendly projectile vs Enemies via spatial hash
      spatialHash.query(p.x, p.y, p.radius + 36, this.queryScratch);
      for (let j = 0; j < this.queryScratch.length; j++) {
        const e = this.queryScratch[j];
        if (!e.active) continue;
        if (p.hitIds.includes(e.id)) continue;

        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const hitR = p.radius + e.radius;
        if (dx * dx + dy * dy > hitR * hitR) continue;

        p.hitIds.push(e.id);
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const kbX = (p.vx / speed) * p.knockback;
        const kbY = (p.vy / speed) * p.knockback;

        fx.spawnHitSparks(p.x, p.y, p.color, p.isCrit);

        const isEclipse = p.kind === 'eclipse_scythe';
        enemySys.damageEnemy(
          e,
          p.damage,
          p.isCrit,
          kbX,
          kbY,
          player,
          fx,
          sound,
          spatialHash,
          hooks,
          rng,
          modifier,
          isEclipse
            ? { burnSec: 2.5, burnDps: p.damage * 0.45 }
            : undefined,
        );

        // Explosive gilded bolt tips (Perpetual Barrage)
        if (p.explosiveRadius > 0) {
          const exR = p.explosiveRadius;
          const ring = fx.spawnShockwave(true, p.x, p.y, exR, '#FFD166', 0, 3, 0.2);
          if (ring) ring.applied = true;
          fx.spawnBurst(p.x, p.y, '#FFD166', 5, 50, 150, 2, 3.6, 'spark');
          spatialHash.query(p.x, p.y, exR, this.aoEScratch);
          for (let k = 0; k < this.aoEScratch.length; k++) {
            const aoE = this.aoEScratch[k];
            if (!aoE.active || aoE === e) continue;
            const adx = aoE.x - p.x;
            const ady = aoE.y - p.y;
            if (adx * adx + ady * ady <= (exR + aoE.radius) ** 2) {
              enemySys.damageEnemy(
                aoE,
                p.damage * 0.55,
                false,
                0,
                0,
                player,
                fx,
                sound,
                spatialHash,
                hooks,
                rng,
                modifier,
                { suppressDamageNumber: true },
              );
            }
          }
        }

        // Ricochet bounce (Ruby Prism / Prism Singularity)
        if (p.bounces > 0) {
          p.bounces--;
          const nextTarget = enemySys.findNearestEnemy(p.x, p.y, 340, p.hitIds);
          if (nextTarget) {
            const bx = nextTarget.x - p.x;
            const by = nextTarget.y - p.y;
            const bd = Math.hypot(bx, by) || 1;
            p.vx = (bx / bd) * speed;
            p.vy = (by / bd) * speed;
          } else {
            // Reflect slightly if no nearby target
            const refA = Math.atan2(p.vy, p.vx) + rng.range(1.9, 2.8);
            p.vx = Math.cos(refA) * speed;
            p.vy = Math.sin(refA) * speed;
          }

          // Prism Singularity splits into 2 mini-prisms on every bounce!
          if (p.kind === 'ruby_prism' && player.evolutions.prism_singularity) {
            const baseA = Math.atan2(p.vy, p.vx);
            for (let s = 0; s < 2; s++) {
              const splitA = baseA + (s === 0 ? 0.42 : -0.42);
              const mini = this.spawnFriendlyProjectile(
                'mini_prism',
                p.x,
                p.y,
                Math.cos(splitA) * 520,
                Math.sin(splitA) * 520,
                4.8,
                p.damage * 0.52,
                p.isCrit,
                1,
                1,
                0.95,
                '#FF7597',
                0,
                55,
              );
              if (mini) {
                mini.hitIds.push(e.id);
              }
            }
          }
          break;
        }

        p.pierce--;
        if (p.pierce <= 0) {
          p.active = false;
          break;
        }
      }
    }
  }

  private updateFriendlyShockwaves(
    player: PlayerState,
    enemySys: EnemySystem,
    spatialHash: SpatialHash<EnemyEntity>,
    fx: FxManager,
    sound: SoundEngine,
    hooks: EnemyEventHooks,
    rng: SeededRNG,
    modifier?: WaveModifier,
  ): void {
    const items = fx.shockwaves.items;
    const hasCataclysm = Boolean(player.evolutions.cataclysm_carillon);

    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s.active || !s.friendly || s.applied || s.damage <= 0) continue;
      if (s.radius >= s.maxRadius * 0.4) {
        s.applied = true;
        spatialHash.query(s.x, s.y, s.maxRadius + 30, this.queryScratch);
        // Copy snapshot in case kills trigger volatile explosions that reuse queryScratch
        const targets = this.queryScratch.slice();
        for (let j = 0; j < targets.length; j++) {
          const e = targets[j];
          if (!e.active) continue;
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          const d = Math.hypot(dx, dy);
          if (d <= s.maxRadius + e.radius) {
            const inv = d > 0.001 ? 1 / d : 0;
            const crit = this.rollCrit(player, rng, hasCataclysm ? 0.15 : 0);
            const dmg = crit ? s.damage * player.critMult : s.damage;
            fx.spawnHitSparks(e.x, e.y, s.color, crit);
            enemySys.damageEnemy(
              e,
              dmg,
              crit,
              dx * inv * 195,
              dy * inv * 195,
              player,
              fx,
              sound,
              spatialHash,
              hooks,
              rng,
              modifier,
              {
                slowSec: 1.5,
                fromCataclysm: hasCataclysm,
              },
            );
          }
        }
      }
    }
  }
}
