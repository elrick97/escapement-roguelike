import type {
  EnemyEntity,
  InputState,
  PickupEntity,
  PlayerState,
  ProjectileEntity,
} from '../types';
import type { FxManager } from './particles';

export interface OrbitalVisual {
  x: number;
  y: number;
  radius: number;
  angle: number;
  evolved: boolean;
  ring: number;
}

export interface RenderWorldView {
  player: PlayerState;
  enemies: readonly EnemyEntity[];
  projectiles: readonly ProjectileEntity[];
  pickups: readonly PickupEntity[];
  fx: FxManager;
  input: InputState;
  orbitals: readonly OrbitalVisual[];
  cameraX: number;
  cameraY: number;
  shakeX: number;
  shakeY: number;
  time: number;
  hurtFlash: number;
  levelUpFlash: number;
  chronoSlowAlpha: number;
  arenaRadius: number;
  bossActive: boolean;
}

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const DMG_FONT = '800 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function traceGearPath(
  ctx: CanvasRenderingContext2D,
  teeth: number,
  outerR: number,
  innerR: number
): void {
  const step = TWO_PI / teeth;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const a1 = a + step * 0.16;
    const a2 = a + step * 0.52;
    const a3 = a + step * 0.68;
    const x0 = Math.cos(a) * innerR;
    const y0 = Math.sin(a) * innerR;
    if (i === 0) {
      ctx.moveTo(x0, y0);
    } else {
      ctx.lineTo(x0, y0);
    }
    ctx.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
    ctx.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    ctx.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
  }
  ctx.closePath();
}

function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  sides: number,
  radius: number,
  offsetAngle = 0
): void {
  const step = TWO_PI / sides;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = offsetAngle + i * step;
    const px = Math.cos(a) * radius;
    const py = Math.sin(a) * radius;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

export class GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 360;
  private height = 640;
  private dpr = 1;
  private bgGrad: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D rendering context');
    }
    this.ctx = ctx;
    this.resize();
  }

  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(
      1,
      Math.round(rect.width || this.canvas.clientWidth || window.innerWidth || 360)
    );
    const h = Math.max(
      1,
      Math.round(rect.height || this.canvas.clientHeight || window.innerHeight || 640)
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.width = w;
    this.height = h;
    this.dpr = dpr;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const outerR = Math.hypot(cx, cy);
    const grad = this.ctx.createRadialGradient(cx, cy, 10, cx, cy, outerR);
    grad.addColorStop(0, '#0F1830');
    grad.addColorStop(0.58, '#090E1C');
    grad.addColorStop(1, '#050812');
    this.bgGrad = grad;
  }

  public getViewport(): { width: number; height: number; dpr: number } {
    return {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
    };
  }

  public render(world: RenderWorldView): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const halfW = w * 0.5;
    const halfH = h * 0.5;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Watchface enamel background
    ctx.fillStyle = this.bgGrad ?? '#090E1C';
    ctx.fillRect(0, 0, w, h);

    if (world.bossActive) {
      const pulse = 0.045 + Math.sin(world.time * 3.2) * 0.02;
      ctx.fillStyle = `rgba(255, 46, 99, ${pulse.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    const camX = world.cameraX + world.shakeX;
    const camY = world.cameraY + world.shakeY;

    const cullLeft = camX - halfW;
    const cullRight = camX + halfW;
    const cullTop = camY - halfH;
    const cullBottom = camY + halfH;

    ctx.save();
    ctx.translate(halfW - camX, halfH - camY);

    // 1. Watchface dial markings & perimeter
    this.drawWatchfaceDial(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    // 2. Danger telegraphs (underneath entities)
    this.drawTelegraphs(ctx, world);

    // 3. Shockwave rings
    this.drawShockwaves(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    // 4. Pickups
    this.drawPickups(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    // 5. Enemies (regular/elites first, bosses on top)
    this.drawEnemies(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    // 6. Player & Tourbillon Orbitals
    this.drawOrbitals(ctx, world);
    this.drawPlayer(ctx, world.player, world.time);

    // 7. Projectiles
    this.drawProjectiles(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    // 8. Lightning arcs
    this.drawLightningArcs(ctx, world);

    // 9. Pooled particles
    this.drawParticles(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    // 10. Floating damage numbers & popups
    this.drawDamageNumbers(ctx, world, cullLeft, cullRight, cullTop, cullBottom);

    ctx.restore();

    // 11. Screen-space vignettes & floating virtual joystick
    this.drawScreenOverlays(ctx, world, w, h);
  }

  private drawWatchfaceDial(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const rArena = world.arenaRadius;
    const t = world.time;

    // Darken exterior void outside the horologium dial
    ctx.beginPath();
    ctx.arc(0, 0, rArena + 450, 0, TWO_PI);
    ctx.lineWidth = 900;
    ctx.strokeStyle = 'rgba(3, 5, 11, 0.66)';
    ctx.stroke();

    // Subtle concentric brass hairlines
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(245, 197, 66, 0.065)';
    const step = 220;
    for (let ringR = step; ringR < rArena - 40; ringR += step) {
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, TWO_PI);
      ctx.stroke();
    }

    // Center astrolabe rose (visible when center is near screen)
    if (cullRight > -220 && cullLeft < 220 && cullBottom > -220 && cullTop < 220) {
      ctx.save();
      ctx.rotate(t * 0.05);
      ctx.strokeStyle = 'rgba(245, 197, 66, 0.1)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 128, 0, TWO_PI);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i * TWO_PI) / 12;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.moveTo(cos * 108, sin * 108);
        ctx.lineTo(cos * 128, sin * 128);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(76, 201, 240, 0.07)';
      ctx.beginPath();
      ctx.moveTo(-165, 0);
      ctx.lineTo(165, 0);
      ctx.moveTo(0, -165);
      ctx.lineTo(0, 165);
      ctx.stroke();
      ctx.restore();
    }

    // Rotating subtle inner bezel filigree near perimeter
    ctx.save();
    ctx.rotate(-t * 0.025);
    ctx.strokeStyle = 'rgba(76, 201, 240, 0.09)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([12, 18]);
    ctx.beginPath();
    ctx.arc(0, 0, rArena - 34, 0, TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Main perimeter bezel rings
    ctx.strokeStyle = 'rgba(245, 197, 66, 0.34)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, rArena, 0, TWO_PI);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(245, 197, 66, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, rArena - 14, 0, TWO_PI);
    ctx.stroke();

    // Batched 60 minute ticks (48 minor + 12 major)
    ctx.strokeStyle = 'rgba(245, 197, 66, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const a = (i * TWO_PI) / 60;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.moveTo(cos * (rArena - 11), sin * (rArena - 11));
      ctx.lineTo(cos * rArena, sin * rArena);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(245, 197, 66, 0.62)';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i * TWO_PI) / 12;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.moveTo(cos * (rArena - 22), sin * (rArena - 22));
      ctx.lineTo(cos * (rArena + 2), sin * (rArena + 2));
    }
    ctx.stroke();

    // Arena edge proximity warning glow
    const playerDist = Math.hypot(world.player.x, world.player.y);
    const warnStart = rArena - 190;
    if (playerDist > warnStart) {
      const ratio = Math.min(1, (playerDist - warnStart) / 165);
      const pulse = 0.65 + Math.sin(t * 9) * 0.35;
      const pAngle = Math.atan2(world.player.y, world.player.x);
      const span = 0.36 + ratio * 0.22;

      ctx.strokeStyle = `rgba(255, 46, 99, ${(0.22 * ratio * pulse).toFixed(3)})`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(0, 0, rArena, pAngle - span, pAngle + span);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 159, 28, ${(0.78 * ratio * pulse).toFixed(3)})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, rArena, pAngle - span * 0.85, pAngle + span * 0.85);
      ctx.stroke();
    }
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D, world: RenderWorldView): void {
    const items = world.fx.telegraphs.items;
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      if (!t.active) continue;

      const fade = Math.min(1, t.life / Math.min(0.15, t.maxLife * 0.3));
      const p = t.progress;

      if (t.kind === 'circle') {
        ctx.save();
        ctx.globalAlpha = (0.14 + p * 0.22) * fade;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * Math.max(0.12, p), 0, TWO_PI);
        ctx.fill();

        ctx.globalAlpha = (0.55 + p * 0.4) * fade;
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (t.kind === 'line') {
        ctx.save();
        ctx.globalAlpha = (0.18 + p * 0.25) * fade;
        ctx.strokeStyle = t.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = t.radius * 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();

        ctx.globalAlpha = (0.65 + p * 0.35) * fade;
        ctx.lineWidth = 2.2 + p * 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();
        ctx.restore();
      } else {
        // 'beam'
        ctx.save();
        const beamW = Math.max(4, t.radius * (0.45 + p * 0.65));
        ctx.globalAlpha = 0.28 * fade;
        ctx.strokeStyle = t.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = beamW * 2.1;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();

        ctx.globalAlpha = 0.92 * fade;
        ctx.strokeStyle = '#FFF7E6';
        ctx.lineWidth = beamW * 0.55;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawShockwaves(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const items = world.fx.shockwaves.items;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s.active) continue;
      if (
        s.x + s.radius < cullLeft ||
        s.x - s.radius > cullRight ||
        s.y + s.radius < cullTop ||
        s.y - s.radius > cullBottom
      ) {
        continue;
      }

      const alpha = Math.max(0, s.life / s.maxLife);
      ctx.save();
      // Soft outer halo ring
      ctx.globalAlpha = alpha * 0.3;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth * 2.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, TWO_PI);
      ctx.stroke();

      // Crisp inner ring
      ctx.globalAlpha = alpha * 0.92;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, TWO_PI);
      ctx.stroke();

      // Bright inner filament
      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1, s.lineWidth * 0.35);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(2, s.radius - s.lineWidth * 0.35), 0, TWO_PI);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawPickups(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const items = world.pickups;
    const t = world.time;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;

      const margin = p.radius + 26;
      if (
        p.x + margin < cullLeft ||
        p.x - margin > cullRight ||
        p.y + margin < cullTop ||
        p.y - margin > cullBottom
      ) {
        continue;
      }

      const bob = Math.sin(t * 4.5 + p.x * 0.04) * 2.2;
      const py = p.y + bob;

      switch (p.kind) {
        case 'ruby': {
          const r = p.radius;
          ctx.fillStyle = 'rgba(255, 46, 99, 0.22)';
          ctx.beginPath();
          ctx.arc(p.x, py, r * 1.75, 0, TWO_PI);
          ctx.fill();

          ctx.fillStyle = '#FF2E63';
          ctx.beginPath();
          ctx.moveTo(p.x, py - r * 1.25);
          ctx.lineTo(p.x + r * 0.95, py);
          ctx.lineTo(p.x, py + r * 1.25);
          ctx.lineTo(p.x - r * 0.95, py);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#FFB3C6';
          ctx.beginPath();
          ctx.moveTo(p.x, py - r * 0.85);
          ctx.lineTo(p.x + r * 0.42, py - r * 0.1);
          ctx.lineTo(p.x, py + r * 0.25);
          ctx.lineTo(p.x - r * 0.42, py - r * 0.1);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'ruby_large': {
          const r = p.radius * 1.15;
          const pulse = 1 + Math.sin(t * 6 + p.y * 0.05) * 0.12;
          ctx.fillStyle = 'rgba(255, 46, 99, 0.28)';
          ctx.beginPath();
          ctx.arc(p.x, py, r * 1.9 * pulse, 0, TWO_PI);
          ctx.fill();

          ctx.fillStyle = '#FF2E63';
          ctx.strokeStyle = '#FFD6E0';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(p.x, py - r * 1.3);
          ctx.lineTo(p.x + r, py - r * 0.35);
          ctx.lineTo(p.x + r * 0.72, py + r * 0.95);
          ctx.lineTo(p.x - r * 0.72, py + r * 0.95);
          ctx.lineTo(p.x - r, py - r * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(p.x - r * 0.24, py - r * 0.35, r * 0.24, 0, TWO_PI);
          ctx.fill();
          break;
        }
        case 'gilt': {
          const r = p.radius;
          const spinScale = Math.max(0.28, Math.abs(Math.cos(t * 5.2 + p.x * 0.05)));
          ctx.fillStyle = 'rgba(245, 197, 66, 0.22)';
          ctx.beginPath();
          ctx.arc(p.x, py, r * 1.65, 0, TWO_PI);
          ctx.fill();

          ctx.save();
          ctx.translate(p.x, py);
          ctx.scale(spinScale, 1);
          ctx.fillStyle = '#F5C542';
          ctx.strokeStyle = '#FFF3B0';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, TWO_PI);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#9A6B11';
          ctx.fillRect(-r * 0.3, -r * 0.3, r * 0.6, r * 0.6);
          ctx.restore();
          break;
        }
        case 'heal': {
          const r = p.radius;
          const pulse = 1 + Math.sin(t * 6) * 0.1;
          ctx.fillStyle = 'rgba(46, 196, 182, 0.26)';
          ctx.beginPath();
          ctx.arc(p.x, py, r * 1.85 * pulse, 0, TWO_PI);
          ctx.fill();

          ctx.save();
          ctx.translate(p.x, py);
          ctx.rotate(t * 1.4);
          traceGearPath(ctx, 6, r * 1.1, r * 0.72);
          ctx.fillStyle = '#2EC4B6';
          ctx.fill();
          ctx.strokeStyle = '#99F6E4';
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.restore();

          // White repair cross
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(p.x - r * 0.45, py - r * 0.15, r * 0.9, r * 0.3);
          ctx.fillRect(p.x - r * 0.15, py - r * 0.45, r * 0.3, r * 0.9);
          break;
        }
        case 'relic_chest': {
          const r = p.radius;
          const pulse = 1 + Math.sin(t * 5) * 0.1;

          // Vertical golden light pillar shimmer
          ctx.fillStyle = 'rgba(245, 197, 66, 0.14)';
          ctx.fillRect(p.x - r * 0.75, py - r * 3.8, r * 1.5, r * 3.8);

          ctx.fillStyle = 'rgba(245, 197, 66, 0.28)';
          ctx.beginPath();
          ctx.arc(p.x, py, r * 1.9 * pulse, 0, TWO_PI);
          ctx.fill();

          // Ornate chest body
          ctx.fillStyle = '#5C3D0E';
          ctx.strokeStyle = '#F5C542';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.roundRect(p.x - r, py - r * 0.78, r * 2, r * 1.56, 4);
          ctx.fill();
          ctx.stroke();

          // Lid seam & golden clasp
          ctx.fillStyle = '#F5C542';
          ctx.fillRect(p.x - r, py - r * 0.15, r * 2, 3);
          ctx.fillStyle = '#FF2E63';
          ctx.beginPath();
          ctx.arc(p.x, py - r * 0.05, r * 0.28, 0, TWO_PI);
          ctx.fill();
          break;
        }
      }
    }
  }

  private drawEnemies(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const enemies = world.enemies;
    let bossIndexA = -1;
    let bossIndexB = -1;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active) continue;
      if (e.isBoss) {
        if (bossIndexA === -1) bossIndexA = i;
        else bossIndexB = i;
        continue;
      }

      const margin = e.radius + 28;
      if (
        e.x + margin < cullLeft ||
        e.x - margin > cullRight ||
        e.y + margin < cullTop ||
        e.y - margin > cullBottom
      ) {
        continue;
      }

      this.drawSingleEnemy(ctx, e, world.time);
    }

    if (bossIndexA !== -1) {
      this.drawSingleEnemy(ctx, enemies[bossIndexA], world.time);
    }
    if (bossIndexB !== -1) {
      this.drawSingleEnemy(ctx, enemies[bossIndexB], world.time);
    }
  }

  private drawSingleEnemy(ctx: CanvasRenderingContext2D, e: EnemyEntity, time: number): void {
    const r = e.radius;

    // Elite halo & orbiting pips
    if (e.elite !== 'none' && !e.isBoss) {
      const eliteColor =
        e.elite === 'gilded'
          ? '#F5C542'
          : e.elite === 'overwound'
            ? '#FF595E'
            : '#C77DFF';

      ctx.strokeStyle = eliteColor;
      ctx.globalAlpha = 0.35 + Math.sin(time * 6 + e.id) * 0.12;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r + 7, 0, TWO_PI);
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = eliteColor;
      for (let p = 0; p < 3; p++) {
        const a = time * 2.8 + (p * TWO_PI) / 3;
        ctx.beginPath();
        ctx.arc(e.x + Math.cos(a) * (r + 9), e.y + Math.sin(a) * (r + 9), 2.5, 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.squash > 0.005) {
      const sx = 1 + e.squash * 0.22;
      const sy = Math.max(0.68, 1 - e.squash * 0.18);
      ctx.scale(sx, sy);
    }

    if (e.isBoss) {
      this.drawBossBody(ctx, e, time);
    } else {
      this.drawEnemyBody(ctx, e, time);
    }

    // Status tints
    if (e.slowTimer > 0) {
      ctx.strokeStyle = 'rgba(76, 201, 240, 0.72)';
      ctx.fillStyle = 'rgba(76, 201, 240, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.05, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
    }

    if (e.burnTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 138, 43, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, 0, TWO_PI);
      ctx.stroke();
    }

    // Bright white hit flash
    if (e.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.88, e.hitFlash * 8.5);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.04, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Non-boss damaged or elite HP micro-bar
    if (!e.isBoss && (e.hp < e.maxHp || e.elite !== 'none')) {
      const barW = Math.max(22, r * 1.7);
      const barH = e.elite !== 'none' ? 4 : 3;
      const bx = e.x - barW * 0.5;
      const by = e.y - r - (e.elite !== 'none' ? 13 : 9);
      const ratio = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)));

      ctx.fillStyle = 'rgba(5, 8, 18, 0.85)';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = e.elite === 'gilded' ? '#F5C542' : '#FF2E63';
      ctx.fillRect(bx, by, barW * ratio, barH);
    }
  }

  private drawEnemyBody(ctx: CanvasRenderingContext2D, e: EnemyEntity, time: number): void {
    const r = e.radius;

    switch (e.type) {
      case 'rust_mite': {
        ctx.save();
        ctx.rotate(e.angle);
        // Jagged 6-spike oxidized burr
        ctx.fillStyle = e.color;
        ctx.strokeStyle = '#4A180D';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i * TWO_PI) / 12;
          const rad = i % 2 === 0 ? r * 1.15 : r * 0.68;
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Dark iron core & single glowing ember eye
        ctx.fillStyle = '#2B110B';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.45, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = e.accent;
        ctx.beginPath();
        ctx.arc(r * 0.26, 0, r * 0.22, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'burr_sprocket': {
        const windingUp = e.aiState === 1;
        if (windingUp) {
          const glow = 0.35 + Math.sin(time * 24) * 0.2;
          ctx.fillStyle = `rgba(255, 159, 28, ${glow.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.55, 0, TWO_PI);
          ctx.fill();
        }

        ctx.save();
        ctx.rotate(e.spin);
        traceGearPath(ctx, 6, r * 1.16, r * 0.72);
        ctx.fillStyle = windingUp ? '#FF9F1C' : e.color;
        ctx.fill();
        ctx.strokeStyle = windingUp ? '#FFF3B0' : '#431407';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.fillStyle = '#1E1B24';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.42, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = windingUp ? '#FFFFFF' : e.accent;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.2, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'magnet_needle': {
        ctx.save();
        ctx.rotate(e.angle);

        // Sleek compass diamond oriented at player
        ctx.fillStyle = e.color;
        ctx.strokeStyle = '#162844';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(r * 1.48, 0);
        ctx.lineTo(0, r * 0.62);
        ctx.lineTo(-r * 1.15, 0);
        ctx.lineTo(0, -r * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Crimson magnetic north tip
        ctx.fillStyle = e.accent;
        ctx.beginPath();
        ctx.moveTo(r * 1.48, 0);
        ctx.lineTo(r * 0.22, r * 0.46);
        ctx.lineTo(r * 0.22, -r * 0.46);
        ctx.closePath();
        ctx.fill();

        // Tip glint when charging shot
        if (e.aiState === 1) {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(r * 1.35, 0, r * 0.24, 0, TWO_PI);
          ctx.fill();
        }
        ctx.restore();
        break;
      }

      case 'tarnish_globule':
      case 'mini_globule': {
        const wobble = 1 + Math.sin(time * 7 + e.id) * 0.08;
        ctx.save();
        ctx.scale(wobble, 2 - wobble);

        // Outer verdigris membrane
        ctx.fillStyle = e.color;
        ctx.strokeStyle = '#99F6E4';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();

        // Embedded cracked gear silhouette
        ctx.save();
        ctx.rotate(e.spin * 0.5);
        traceGearPath(ctx, 5, r * 0.68, r * 0.46);
        ctx.fillStyle = 'rgba(13, 59, 64, 0.72)';
        ctx.fill();
        ctx.restore();

        if (e.type === 'tarnish_globule') {
          // Twin nuclei hinting at split mechanic
          const a = time * 2.2 + e.id;
          const off = r * 0.3;
          ctx.fillStyle = '#CCFBF1';
          ctx.beginPath();
          ctx.arc(Math.cos(a) * off, Math.sin(a) * off, r * 0.18, 0, TWO_PI);
          ctx.arc(-Math.cos(a) * off, -Math.sin(a) * off, r * 0.18, 0, TWO_PI);
          ctx.fill();
        } else {
          ctx.fillStyle = '#CCFBF1';
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.22, 0, TWO_PI);
          ctx.fill();
        }
        ctx.restore();
        break;
      }

      case 'pendulum_brute': {
        const slamming = e.aiState === 1;
        ctx.save();
        ctx.rotate(e.angle * 0.25);

        // Heavy octagonal cast-iron armor plate
        tracePolygonPath(ctx, 8, r * 1.06, Math.PI / 8);
        ctx.fillStyle = slamming ? '#78350F' : '#334155';
        ctx.fill();
        ctx.strokeStyle = slamming ? '#F59E0B' : '#94A3B8';
        ctx.lineWidth = 2.8;
        ctx.stroke();

        // Inner iron core
        tracePolygonPath(ctx, 8, r * 0.66, Math.PI / 8);
        ctx.fillStyle = '#0F172A';
        ctx.fill();

        // 4 brass rivets
        ctx.fillStyle = '#F5C542';
        for (let k = 0; k < 4; k++) {
          const a = (k * TWO_PI) / 4 + Math.PI / 4;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 2.6, 0, TWO_PI);
          ctx.fill();
        }

        // Core pendulum crest
        ctx.fillStyle = slamming ? '#FDE047' : e.accent;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.28, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'overwound_coil': {
        const detonating = e.aiState === 1;
        const flashOn = detonating && Math.floor(time * 18) % 2 === 0;

        if (detonating) {
          ctx.fillStyle = flashOn ? 'rgba(255, 255, 255, 0.34)' : 'rgba(255, 46, 99, 0.32)';
          ctx.beginPath();
          ctx.arc(0, 0, r * 1.6, 0, TWO_PI);
          ctx.fill();
        }

        ctx.fillStyle = '#1E293B';
        ctx.strokeStyle = flashOn ? '#FFFFFF' : e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();

        // Spiral mainspring turns
        ctx.save();
        ctx.rotate(e.spin * 1.8);
        ctx.strokeStyle = flashOn ? '#FF2E63' : '#E2E8F0';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        const turns = 2.6;
        const steps = 22;
        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          const a = frac * TWO_PI * turns;
          const sr = frac * (r * 0.78);
          const sx = Math.cos(a) * sr;
          const sy = Math.sin(a) * sr;
          if (s === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = flashOn ? '#FFFFFF' : '#FF2E63';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.24, 0, TWO_PI);
        ctx.fill();
        break;
      }
    }
  }

  private drawBossBody(ctx: CanvasRenderingContext2D, e: EnemyEntity, time: number): void {
    const r = e.radius;
    const phase2 = e.phase >= 2;

    if (e.bossType === 'grand_tourbillon') {
      // Outer counter-rotating brass bezel gear
      ctx.save();
      ctx.rotate(e.spin);
      traceGearPath(ctx, 16, r * 1.08, r * 0.9);
      ctx.fillStyle = phase2 ? '#D97706' : '#F5C542';
      ctx.fill();
      ctx.strokeStyle = '#FFF3B0';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Deep dial backing
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.86, 0, TWO_PI);
      ctx.fill();

      // Counter-rotating blued-steel tourbillon cage
      ctx.save();
      ctx.rotate(-e.spin * 1.45);
      ctx.strokeStyle = phase2 ? '#FF595E' : '#4CC9F0';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.68, 0, TWO_PI);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const a = (i * TWO_PI) / 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        ctx.stroke();
      }
      ctx.restore();

      // Twin elliptical gyroscope gimbals
      ctx.save();
      ctx.rotate(time * 1.3);
      ctx.strokeStyle = '#F5C542';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.72, r * 0.34, 0, 0, TWO_PI);
      ctx.stroke();

      ctx.rotate(HALF_PI);
      ctx.strokeStyle = phase2 ? '#FF2E63' : '#4CC9F0';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.72, r * 0.34, 0, 0, TWO_PI);
      ctx.stroke();
      ctx.restore();

      // Radiant ruby/crimson core
      const pulse = 1 + Math.sin(time * 8) * 0.12;
      ctx.fillStyle = phase2 ? 'rgba(255, 84, 0, 0.38)' : 'rgba(255, 46, 99, 0.32)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.42 * pulse, 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = phase2 ? '#FF5400' : '#FF2E63';
      ctx.strokeStyle = '#FFD6E0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
    } else {
      // Boss 2: Mainspring Leviathan — Obsidian & Gold Clockwork Dreadnought
      ctx.save();
      ctx.rotate(e.spin * 0.4);
      tracePolygonPath(ctx, 12, r * 1.06);
      ctx.fillStyle = '#111827';
      ctx.fill();
      ctx.strokeStyle = phase2 ? '#FF2E63' : '#F5C542';
      ctx.lineWidth = 3.2;
      ctx.stroke();

      // 12 gilded dial nodes
      ctx.fillStyle = '#F5C542';
      for (let i = 0; i < 12; i++) {
        const a = (i * TWO_PI) / 12;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88, 3.4, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();

      // Inner mainspring coil spiral
      ctx.save();
      ctx.rotate(-e.spin * 1.2);
      ctx.strokeStyle = phase2 ? '#FF595E' : '#4CC9F0';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      const steps = 36;
      for (let s = 0; s <= steps; s++) {
        const frac = s / steps;
        const a = frac * TWO_PI * 3.2;
        const sr = frac * (r * 0.72);
        const sx = Math.cos(a) * sr;
        const sy = Math.sin(a) * sr;
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();

      // Dual ornate clock-hand crests
      ctx.save();
      ctx.rotate(e.angle);
      ctx.fillStyle = '#F5C542';
      ctx.beginPath();
      ctx.moveTo(r * 0.96, 0);
      ctx.lineTo(0, r * 0.14);
      ctx.lineTo(-r * 0.34, 0);
      ctx.lineTo(0, -r * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.rotate(-e.spin * 0.85);
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.moveTo(r * 0.68, 0);
      ctx.lineTo(0, r * 0.1);
      ctx.lineTo(-r * 0.24, 0);
      ctx.lineTo(0, -r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Leviathan eye core
      ctx.fillStyle = phase2 ? '#FF2E63' : '#4CC9F0';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.24, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawOrbitals(ctx: CanvasRenderingContext2D, world: RenderWorldView): void {
    const orbitals = world.orbitals;
    if (orbitals.length === 0) return;

    for (let i = 0; i < orbitals.length; i++) {
      const o = orbitals[i];
      ctx.save();
      ctx.translate(o.x, o.y);

      if (o.evolved) {
        // Celestial Orrery: luminous dual-tone planetary saw gear
        ctx.fillStyle = o.ring === 0 ? 'rgba(245, 197, 66, 0.24)' : 'rgba(76, 201, 240, 0.24)';
        ctx.beginPath();
        ctx.arc(0, 0, o.radius * 1.45, 0, TWO_PI);
        ctx.fill();

        ctx.rotate(o.angle);
        traceGearPath(ctx, 10, o.radius * 1.12, o.radius * 0.72);
        ctx.fillStyle = o.ring === 0 ? '#F5C542' : '#4CC9F0';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.fillStyle = '#0B1020';
        ctx.beginPath();
        ctx.arc(0, 0, o.radius * 0.42, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = o.ring === 0 ? '#FF2E63' : '#FFF3B0';
        ctx.beginPath();
        ctx.arc(0, 0, o.radius * 0.22, 0, TWO_PI);
        ctx.fill();
      } else {
        // Tourbillon Orbit: sharp 8-tooth spinning brass gear
        ctx.fillStyle = 'rgba(245, 197, 66, 0.18)';
        ctx.beginPath();
        ctx.arc(0, 0, o.radius * 1.35, 0, TWO_PI);
        ctx.fill();

        ctx.rotate(o.angle);
        traceGearPath(ctx, 8, o.radius * 1.1, o.radius * 0.72);
        ctx.fillStyle = '#F5C542';
        ctx.fill();
        ctx.strokeStyle = '#FFF3B0';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.arc(0, 0, o.radius * 0.36, 0, TWO_PI);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, player: PlayerState, time: number): void {
    const r = player.radius;

    // Invulnerability blink
    const blinkAlpha =
      player.invulnTimer > 0 && Math.floor(time * 20) % 2 === 0 ? 0.45 : 1;

    ctx.save();
    ctx.translate(player.x, player.y);

    // Anchor Tempo golden precision reticle
    if (player.anchorActive) {
      const pulse = 1 + Math.sin(time * 8) * 0.06;
      const anchorR = (r + 17) * pulse;

      ctx.fillStyle = 'rgba(245, 197, 66, 0.08)';
      ctx.beginPath();
      ctx.arc(0, 0, anchorR, 0, TWO_PI);
      ctx.fill();

      ctx.save();
      ctx.rotate(time * 0.9);
      ctx.strokeStyle = 'rgba(245, 197, 66, 0.72)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, anchorR, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);

      // 4 inward golden precision ticks
      ctx.strokeStyle = '#FFF3B0';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * TWO_PI) / 4;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.moveTo(c * (anchorR - 5), s * (anchorR - 5));
        ctx.lineTo(c * (anchorR + 4), s * (anchorR + 4));
      }
      ctx.stroke();
      ctx.restore();
    }

    // Ward shield ring
    if (player.ward > 0) {
      const wardRatio = Math.max(0.1, Math.min(1, player.ward / Math.max(1, player.maxWard)));
      ctx.strokeStyle = 'rgba(76, 201, 240, 0.3)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r + 9, 0, TWO_PI);
      ctx.stroke();

      ctx.strokeStyle = '#72EFDD';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, r + 9, -HALF_PI, -HALF_PI + TWO_PI * wardRatio);
      ctx.stroke();
    }

    ctx.globalAlpha = blinkAlpha;

    // Soft ambient halo around the Rogue Balance Wheel
    ctx.fillStyle = 'rgba(245, 197, 66, 0.16)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.45, 0, TWO_PI);
    ctx.fill();

    // Outer rotating brass toothed balance wheel
    ctx.save();
    ctx.rotate(player.wheelSpin);
    traceGearPath(ctx, 12, r * 1.12, r * 0.86);
    ctx.fillStyle = '#F5C542';
    ctx.fill();
    ctx.strokeStyle = '#FFF3B0';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // Blued-steel inner ring & 3 counter-rotating balance spokes
    ctx.save();
    ctx.rotate(-player.wheelSpin * 0.7);
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#4CC9F0';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#4CC9F0';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i * TWO_PI) / 3;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
    }
    ctx.stroke();
    ctx.restore();

    // Forward directional brass pointer nib
    ctx.save();
    ctx.rotate(player.angle);
    ctx.fillStyle = '#FFF3B0';
    ctx.beginPath();
    ctx.moveTo(r * 1.24, 0);
    ctx.lineTo(r * 0.76, r * 0.24);
    ctx.lineTo(r * 0.76, -r * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Gleaming Ruby Center Bearing
    ctx.fillStyle = '#FF2E63';
    ctx.strokeStyle = '#FFD6E0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-r * 0.1, -r * 0.1, r * 0.11, 0, TWO_PI);
    ctx.fill();

    // Hit flash overlay
    if (player.hitFlashTimer > 0) {
      ctx.globalAlpha = Math.min(0.85, player.hitFlashTimer * 6);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15, 0, TWO_PI);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const items = world.projectiles;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;

      const margin = p.radius + 28;
      if (
        p.x + margin < cullLeft ||
        p.x - margin > cullRight ||
        p.y + margin < cullTop ||
        p.y - margin > cullBottom
      ) {
        continue;
      }

      switch (p.kind) {
        case 'bolt':
        case 'gilded_bolt': {
          const isGilded = p.kind === 'gilded_bolt';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);

          // Soft trail
          ctx.fillStyle = isGilded ? 'rgba(245, 197, 66, 0.32)' : 'rgba(76, 201, 240, 0.32)';
          ctx.beginPath();
          ctx.ellipse(-p.radius * 0.6, 0, p.radius * 2.1, p.radius * 0.72, 0, 0, TWO_PI);
          ctx.fill();

          // Sharp needle pin
          ctx.fillStyle = isGilded ? '#F5C542' : p.color;
          ctx.beginPath();
          ctx.moveTo(p.radius * 1.9, 0);
          ctx.lineTo(-p.radius * 1.2, p.radius * 0.55);
          ctx.lineTo(-p.radius * 0.7, 0);
          ctx.lineTo(-p.radius * 1.2, -p.radius * 0.55);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.ellipse(p.radius * 0.35, 0, p.radius * 0.85, p.radius * 0.25, 0, 0, TWO_PI);
          ctx.fill();
          ctx.restore();
          break;
        }

        case 'ruby_prism':
        case 'mini_prism': {
          const isMini = p.kind === 'mini_prism';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);

          // Luminous motion streak
          ctx.strokeStyle = isMini ? 'rgba(255, 117, 151, 0.45)' : 'rgba(255, 46, 99, 0.45)';
          ctx.lineWidth = p.radius * 0.9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-p.radius * 2.6, 0);
          ctx.lineTo(0, 0);
          ctx.stroke();

          // Faceted crimson diamond
          ctx.fillStyle = p.color;
          ctx.strokeStyle = '#FFD6E0';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.radius * 1.45, 0);
          ctx.lineTo(0, p.radius * 0.85);
          ctx.lineTo(-p.radius * 1.25, 0);
          ctx.lineTo(0, -p.radius * 0.85);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(p.radius * 0.2, 0, p.radius * 0.28, 0, TWO_PI);
          ctx.fill();
          ctx.restore();
          break;
        }

        case 'scythe':
        case 'eclipse_scythe': {
          const isEclipse = p.kind === 'eclipse_scythe';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);

          // Outer glow arc
          ctx.strokeStyle = isEclipse ? 'rgba(245, 197, 66, 0.32)' : 'rgba(76, 201, 240, 0.28)';
          ctx.lineWidth = isEclipse ? 9 : 6;
          ctx.beginPath();
          ctx.arc(0, 0, p.radius * 0.86, -1.15, 1.15);
          ctx.stroke();

          // Crescent clock-hand blade
          ctx.fillStyle = isEclipse ? '#1A1423' : '#E2E8F0';
          ctx.strokeStyle = isEclipse ? '#F5C542' : '#4CC9F0';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, -1.25, 1.25);
          ctx.arc(-p.radius * 0.32, 0, p.radius * 0.82, 1.08, -1.08, true);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          if (isEclipse) {
            ctx.strokeStyle = '#FF2E63';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(0, 0, p.radius * 0.78, -0.9, 0.9);
            ctx.stroke();
          }
          ctx.restore();
          break;
        }

        case 'orrery_spark': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = 'rgba(245, 197, 66, 0.3)';
          ctx.beginPath();
          ctx.arc(0, 0, p.radius * 1.5, 0, TWO_PI);
          ctx.fill();

          ctx.fillStyle = '#FFF3B0';
          ctx.beginPath();
          ctx.moveTo(p.radius * 1.3, 0);
          ctx.lineTo(0, p.radius * 0.7);
          ctx.lineTo(-p.radius * 1.3, 0);
          ctx.lineTo(0, -p.radius * 0.7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }

        case 'enemy_dart': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = 'rgba(255, 46, 99, 0.3)';
          ctx.beginPath();
          ctx.arc(0, 0, p.radius * 1.6, 0, TWO_PI);
          ctx.fill();

          ctx.fillStyle = '#FF2E63';
          ctx.beginPath();
          ctx.moveTo(p.radius * 1.65, 0);
          ctx.lineTo(-p.radius, p.radius * 0.8);
          ctx.lineTo(-p.radius * 0.55, 0);
          ctx.lineTo(-p.radius, -p.radius * 0.8);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#FFE4EC';
          ctx.beginPath();
          ctx.arc(p.radius * 0.2, 0, p.radius * 0.38, 0, TWO_PI);
          ctx.fill();
          ctx.restore();
          break;
        }

        case 'boss_orb': {
          ctx.fillStyle = 'rgba(255, 84, 0, 0.34)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 1.65, 0, TWO_PI);
          ctx.fill();

          ctx.fillStyle = p.color || '#FF2E63';
          ctx.strokeStyle = '#FFF3B0';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, TWO_PI);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 0.42, 0, TWO_PI);
          ctx.fill();
          break;
        }
      }
    }
  }

  private drawLightningArcs(ctx: CanvasRenderingContext2D, world: RenderWorldView): void {
    const items = world.fx.lightningArcs.items;
    for (let i = 0; i < items.length; i++) {
      const arc = items[i];
      if (!arc.active || arc.points.length < 2) continue;

      const alpha = Math.max(0, arc.life / arc.maxLife);
      const pts = arc.points;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Colored outer glow pass
      ctx.globalAlpha = alpha * 0.42;
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = arc.width * 2.8;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let j = 1; j < pts.length; j++) {
        ctx.lineTo(pts[j].x, pts[j].y);
      }
      ctx.stroke();

      // Bright high-contrast core pass
      ctx.globalAlpha = alpha * 0.96;
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = Math.max(1.2, arc.width * 0.85);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const items = world.fx.particles.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;

      const margin = p.size * 2.5 + 8;
      if (
        p.x + margin < cullLeft ||
        p.x - margin > cullRight ||
        p.y + margin < cullTop ||
        p.y - margin > cullBottom
      ) {
        continue;
      }

      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));

      switch (p.shape) {
        case 'dot': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.45 + 0.55 * t), 0, TWO_PI);
          ctx.fill();
          break;
        }
        case 'spark': {
          const len = p.size * (1.2 + t * 1.4);
          const cos = Math.cos(p.angle);
          const sin = Math.sin(p.angle);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1.2, p.size * 0.52);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x - cos * len, p.y - sin * len);
          ctx.lineTo(p.x + cos * len, p.y + sin * len);
          ctx.stroke();
          break;
        }
        case 'diamond': {
          const sz = p.size * (0.4 + 0.6 * t);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(sz * 1.2, 0);
          ctx.lineTo(0, sz * 0.72);
          ctx.lineTo(-sz * 1.2, 0);
          ctx.lineTo(0, -sz * 0.72);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'ring': {
          const expand = p.size * (1 + (1 - t) * 1.75);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1.2, 3.2 * t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, expand, 0, TWO_PI);
          ctx.stroke();
          break;
        }
        case 'gear': {
          const sz = p.size * (0.55 + 0.45 * t);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          traceGearPath(ctx, 6, sz, sz * 0.62);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawDamageNumbers(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    cullLeft: number,
    cullRight: number,
    cullTop: number,
    cullBottom: number
  ): void {
    const items = world.fx.damageNumbers.items;
    ctx.font = DMG_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(5, 8, 18, 0.92)';
    ctx.lineWidth = 3.5;

    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      if (!d.active) continue;
      if (
        d.x + 48 < cullLeft ||
        d.x - 48 > cullRight ||
        d.y + 32 < cullTop ||
        d.y - 32 > cullBottom
      ) {
        continue;
      }

      const progress = 1 - d.life / d.maxLife;
      const alpha = progress < 0.68 ? 1 : Math.max(0, (1 - progress) / 0.32);
      const popScale = progress < 0.14 ? 0.85 + (progress / 0.14) * 0.3 : 1;
      const s = d.scale * popScale;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(d.x, d.y);
      if (s !== 1) {
        ctx.scale(s, s);
      }
      ctx.strokeText(d.text, 0, 0);
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
  }

  private drawScreenOverlays(
    ctx: CanvasRenderingContext2D,
    world: RenderWorldView,
    w: number,
    h: number
  ): void {
    // Chrono Leech cool blued-steel vignette
    if (world.chronoSlowAlpha > 0.01) {
      const a = Math.min(0.42, world.chronoSlowAlpha * 0.42);
      ctx.strokeStyle = `rgba(76, 201, 240, ${a.toFixed(3)})`;
      ctx.lineWidth = 22;
      ctx.strokeRect(0, 0, w, h);
    }

    // Hurt vignette flash
    if (world.hurtFlash > 0.01) {
      const a = Math.min(0.45, world.hurtFlash * 0.45);
      ctx.strokeStyle = `rgba(255, 46, 99, ${a.toFixed(3)})`;
      ctx.lineWidth = 28;
      ctx.strokeRect(0, 0, w, h);
    }

    // Level-up golden flash
    if (world.levelUpFlash > 0.01) {
      const a = Math.min(0.28, world.levelUpFlash * 0.28);
      ctx.fillStyle = `rgba(245, 197, 66, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Floating virtual joystick when touch/pointer is active
    const inp = world.input;
    if (inp.pointerActive) {
      const ox = inp.originX;
      const oy = inp.originY;
      const outerR = 46;
      const knobX = ox + inp.moveX * 40;
      const knobY = oy + inp.moveY * 40;

      ctx.save();
      // Outer brass anchor ring
      ctx.fillStyle = 'rgba(13, 21, 43, 0.34)';
      ctx.strokeStyle = 'rgba(245, 197, 66, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, outerR, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();

      // Cardinal ticks on joystick ring
      ctx.strokeStyle = 'rgba(245, 197, 66, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox - outerR + 4, oy);
      ctx.lineTo(ox - outerR + 10, oy);
      ctx.moveTo(ox + outerR - 4, oy);
      ctx.lineTo(ox + outerR - 10, oy);
      ctx.moveTo(ox, oy - outerR + 4);
      ctx.lineTo(ox, oy - outerR + 10);
      ctx.moveTo(ox, oy + outerR - 4);
      ctx.lineTo(ox, oy + outerR - 10);
      ctx.stroke();

      // Tether line
      ctx.strokeStyle = 'rgba(76, 201, 240, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(knobX, knobY);
      ctx.stroke();

      // Thumb knob
      ctx.fillStyle = inp.active ? 'rgba(245, 197, 66, 0.55)' : 'rgba(245, 197, 66, 0.35)';
      ctx.strokeStyle = 'rgba(255, 243, 176, 0.88)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(knobX, knobY, 19, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}
