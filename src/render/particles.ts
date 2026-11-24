import { ObjectPool } from '../engine/pool';
import type {
  DamageNumberEntity,
  LightningArcEntity,
  ParticleEntity,
  ShockwaveEntity,
  TelegraphEntity,
} from '../types';

const TWO_PI = Math.PI * 2;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class FxManager {
  public readonly particles: ObjectPool<ParticleEntity>;
  public readonly damageNumbers: ObjectPool<DamageNumberEntity>;
  public readonly shockwaves: ObjectPool<ShockwaveEntity>;
  public readonly lightningArcs: ObjectPool<LightningArcEntity>;
  public readonly telegraphs: ObjectPool<TelegraphEntity>;

  constructor() {
    this.particles = new ObjectPool<ParticleEntity>(260, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 2,
      color: '#F5C542',
      alpha: 1,
      life: 0,
      maxLife: 1,
      shape: 'dot',
      angle: 0,
      vAngle: 0,
      drag: 4,
    }));

    this.damageNumbers = new ObjectPool<DamageNumberEntity>(90, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      text: '',
      color: '#F8FAFC',
      scale: 1,
      life: 0,
      maxLife: 1,
      isCrit: false,
    }));

    this.shockwaves = new ObjectPool<ShockwaveEntity>(28, () => ({
      active: false,
      friendly: true,
      x: 0,
      y: 0,
      radius: 0,
      maxRadius: 100,
      color: '#F5C542',
      lineWidth: 4,
      life: 0,
      maxLife: 1,
      damage: 0,
      applied: false,
    }));

    this.lightningArcs = new ObjectPool<LightningArcEntity>(24, () => ({
      active: false,
      points: [],
      color: '#4CC9F0',
      life: 0,
      maxLife: 0.16,
      width: 2.5,
    }));

    this.telegraphs = new ObjectPool<TelegraphEntity>(32, () => ({
      active: false,
      kind: 'circle',
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
      radius: 40,
      progress: 0,
      color: '#FF2E63',
      life: 0,
      maxLife: 1,
    }));
  }

  public clear(): void {
    this.particles.releaseAll();
    this.damageNumbers.releaseAll();
    this.shockwaves.releaseAll();
    this.lightningArcs.releaseAll();
    this.telegraphs.releaseAll();
  }

  public spawnBurst(
    x: number,
    y: number,
    color: string,
    count: number,
    speedMin: number,
    speedMax: number,
    sizeMin: number,
    sizeMax: number,
    shape: ParticleEntity['shape'] = 'dot'
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles.acquire();
      if (!p) break;

      const angle = Math.random() * TWO_PI;
      const speed = randRange(speedMin, speedMax);
      const maxLife = randRange(0.24, 0.54);

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = randRange(sizeMin, sizeMax);
      p.color = color;
      p.alpha = 1;
      p.life = maxLife;
      p.maxLife = maxLife;
      p.shape = shape;
      p.angle = angle;
      p.vAngle = shape === 'gear' || shape === 'diamond' ? randRange(-10, 10) : 0;
      p.drag = shape === 'spark' ? 5.5 : 4.2;
    }
  }

  public spawnHitSparks(x: number, y: number, color: string, crit: boolean): void {
    const count = crit ? 7 : 4;
    this.spawnBurst(
      x,
      y,
      color,
      count,
      crit ? 95 : 65,
      crit ? 240 : 170,
      crit ? 2.6 : 1.8,
      crit ? 4.4 : 3.2,
      'spark'
    );

    if (crit) {
      this.spawnBurst(x, y, '#FFF3B0', 3, 45, 130, 3.2, 5.2, 'diamond');
    }
  }

  public spawnDeathBurst(
    x: number,
    y: number,
    color: string,
    accent: string,
    big: boolean
  ): void {
    const primaryCount = big ? 14 : 7;
    const gearCount = big ? 6 : 2;
    const sparkCount = big ? 12 : 5;

    this.spawnBurst(
      x,
      y,
      color,
      primaryCount,
      big ? 75 : 50,
      big ? 270 : 175,
      big ? 3 : 2,
      big ? 6 : 4,
      'diamond'
    );

    this.spawnBurst(
      x,
      y,
      accent,
      sparkCount,
      big ? 110 : 75,
      big ? 310 : 210,
      big ? 2.4 : 1.8,
      big ? 4.5 : 3.4,
      'spark'
    );

    this.spawnBurst(
      x,
      y,
      accent,
      gearCount,
      big ? 65 : 40,
      big ? 190 : 120,
      big ? 4.5 : 3.2,
      big ? 7.5 : 5,
      'gear'
    );

    const ring = this.particles.acquire();
    if (ring) {
      const maxLife = big ? 0.36 : 0.24;
      ring.x = x;
      ring.y = y;
      ring.vx = 0;
      ring.vy = 0;
      ring.size = big ? 26 : 13;
      ring.color = accent;
      ring.alpha = 0.9;
      ring.life = maxLife;
      ring.maxLife = maxLife;
      ring.shape = 'ring';
      ring.angle = 0;
      ring.vAngle = 0;
      ring.drag = 0;
    }
  }

  public spawnDamageNumber(
    x: number,
    y: number,
    amount: number,
    crit: boolean,
    color?: string
  ): void {
    const d = this.damageNumbers.acquire();
    if (!d) return;

    const val = Math.max(1, Math.round(amount));
    const maxLife = crit ? 0.72 : 0.56;

    d.x = x + randRange(-8, 8);
    d.y = y + randRange(-6, 4);
    d.vx = randRange(-26, 26);
    d.vy = crit ? randRange(-92, -72) : randRange(-72, -52);
    d.text = crit ? `${val}!` : `${val}`;
    d.color = color ?? (crit ? '#FFE066' : '#F8FAFC');
    d.scale = crit ? 1.28 : 0.96;
    d.life = maxLife;
    d.maxLife = maxLife;
    d.isCrit = crit;
  }

  public spawnTextPopup(
    x: number,
    y: number,
    text: string,
    color: string,
    scale = 1.15
  ): void {
    const d = this.damageNumbers.acquire();
    if (!d) return;

    const maxLife = 0.95;
    d.x = x;
    d.y = y - 6;
    d.vx = 0;
    d.vy = -54;
    d.text = text;
    d.color = color;
    d.scale = scale;
    d.life = maxLife;
    d.maxLife = maxLife;
    d.isCrit = false;
  }

  public spawnShockwave(
    friendly: boolean,
    x: number,
    y: number,
    maxRadius: number,
    color: string,
    damage: number,
    lineWidth = 4,
    duration = 0.36
  ): ShockwaveEntity | null {
    const s = this.shockwaves.acquire();
    if (!s) return null;

    const life = Math.max(0.05, duration);
    s.friendly = friendly;
    s.x = x;
    s.y = y;
    s.radius = 6;
    s.maxRadius = maxRadius;
    s.color = color;
    s.lineWidth = lineWidth;
    s.life = life;
    s.maxLife = life;
    s.damage = damage;
    s.applied = false;
    return s;
  }

  public spawnLightningArc(
    points: Array<{ x: number; y: number }>,
    color: string,
    width = 2.6,
    duration = 0.16
  ): void {
    if (points.length < 2) return;
    const arc = this.lightningArcs.acquire();
    if (!arc) return;

    const life = Math.max(0.04, duration);
    arc.color = color;
    arc.width = width;
    arc.life = life;
    arc.maxLife = life;

    // Reuse existing point objects when possible to avoid GC churn
    const existing = arc.points;
    for (let i = 0; i < points.length; i++) {
      const src = points[i];
      if (i < existing.length) {
        existing[i].x = src.x;
        existing[i].y = src.y;
      } else {
        existing.push({ x: src.x, y: src.y });
      }
    }
    existing.length = points.length;
  }

  public spawnTelegraph(
    kind: TelegraphEntity['kind'],
    x: number,
    y: number,
    x2: number,
    y2: number,
    radius: number,
    color: string,
    duration: number
  ): void {
    const t = this.telegraphs.acquire();
    if (!t) return;

    const life = Math.max(0.05, duration);
    t.kind = kind;
    t.x = x;
    t.y = y;
    t.x2 = x2;
    t.y2 = y2;
    t.radius = radius;
    t.progress = 0;
    t.color = color;
    t.life = life;
    t.maxLife = life;
  }

  public update(dt: number): void {
    if (dt <= 0) return;

    const particles = this.particles.items;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (p.drag > 0) {
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vy *= damp;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.vAngle * dt;
      p.alpha = p.life / p.maxLife;
    }

    const numbers = this.damageNumbers.items;
    const numDrag = Math.exp(-3 * dt);
    for (let i = 0; i < numbers.length; i++) {
      const d = numbers[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        continue;
      }
      d.vx *= numDrag;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 125 * dt;
    }

    const shockwaves = this.shockwaves.items;
    for (let i = 0; i < shockwaves.length; i++) {
      const s = shockwaves[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      const p = 1 - s.life / s.maxLife;
      const eased = 1 - (1 - p) * (1 - p);
      s.radius = 6 + (s.maxRadius - 6) * eased;
    }

    const arcs = this.lightningArcs.items;
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) {
        a.active = false;
      }
    }

    const telegraphs = this.telegraphs.items;
    for (let i = 0; i < telegraphs.length; i++) {
      const t = telegraphs[i];
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        continue;
      }
      t.progress = Math.min(1, 1 - t.life / t.maxLife);
    }
  }
}
