import { HorologySynth } from '../audio/synth';
import { BOSS_DEFS } from '../data/enemies';
import { getMetaUpgradeCost, META_UPGRADES } from '../data/meta';
import { UPGRADES, WEAPON_IDS, WEAPON_TO_EVOLUTION } from '../data/upgrades';
import { InputController } from '../engine/input';
import { SpatialHash } from '../engine/spatialHash';
import { loadSave, resetSave, writeSave } from '../engine/storage';
import { FxManager } from '../render/particles';
import { GameRenderer, type RenderWorldView } from '../render/renderer';
import {
  ARENA_RADIUS,
  type DraftChoice,
  type EnemyEntity,
  type EvolutionId,
  type HudSnapshot,
  type MetaUpgradeId,
  type PlayerState,
  type RunSummary,
  type SaveData,
  type ScreenState,
  type SettingsData,
} from '../types';
import { clamp, SeededRNG } from '../utils/rng';
import { CombatSystem } from './combat';
import type { GameCallbacks, IGameEngine } from './contracts';
import { WaveDirector } from './director';
import { EnemySystem, type EnemyEventHooks } from './enemies';
import {
  applyDraftChoice,
  createInitialPlayerState,
  rollDraftChoices,
} from './upgrades';

export class GameEngine implements IGameEngine {
  private readonly callbacks: GameCallbacks;
  private readonly renderer: GameRenderer;
  private readonly input: InputController;
  private readonly sound: HorologySynth;
  private readonly fx: FxManager;
  private readonly spatialHash: SpatialHash<EnemyEntity>;
  private readonly combat: CombatSystem;
  private readonly enemies: EnemySystem;

  private save: SaveData;
  private rng: SeededRNG;
  private director: WaveDirector;
  private player: PlayerState;

  private screen: ScreenState = 'title';
  private destroyed = false;
  private rafId: number | null = null;
  private lastFrameMs = 0;
  private fps = 60;
  private hudSyncTimer = 0;

  // Run state
  private runTime = 0;
  private score = 0;
  private kills = 0;
  private giltRun = 0;
  private evolutionsUnlocked: EvolutionId[] = [];

  // Camera & juice
  private cameraX = 0;
  private cameraY = 0;
  private trauma = 0;
  private shakeX = 0;
  private shakeY = 0;
  private hitStopTimer = 0;
  private hurtFlash = 0;
  private levelUpFlash = 0;
  private chronoSlowAlpha = 0;

  // Draft state
  private currentChoices: DraftChoice[] = [];
  private draftTitle = '';
  private draftSubtitle = '';
  private draftIsRelicChest = false;
  private pendingStartDrafts = 0;
  private pendingChestDrafts = 0;

  // Reusable scratch objects for zero-alloc rendering & spatial queries
  private readonly worldView: RenderWorldView;
  private readonly pushQueryScratch: EnemyEntity[] = [];
  private readonly enemyHooks: EnemyEventHooks;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.callbacks = callbacks;
    this.save = loadSave();
    this.rng = new SeededRNG();

    this.renderer = new GameRenderer(canvas);
    this.sound = new HorologySynth();
    this.sound.setSettings(
      this.save.settings.soundEnabled,
      this.save.settings.musicEnabled,
    );

    this.fx = new FxManager();
    this.spatialHash = new SpatialHash<EnemyEntity>(72);
    this.combat = new CombatSystem();
    this.enemies = new EnemySystem();
    this.director = new WaveDirector(this.rng);
    this.player = createInitialPlayerState(this.save);

    this.input = new InputController(canvas, {
      onFirstInteraction: () => {
        this.sound.unlock();
      },
      onPauseToggle: () => {
        if (this.screen === 'playing') {
          this.pause();
        } else if (this.screen === 'paused') {
          this.resume();
        }
      },
      onSelectChoice: (index) => {
        if (this.screen === 'levelup') {
          this.selectDraftChoice(index);
        }
      },
    });

    this.worldView = {
      player: this.player,
      enemies: this.enemies.enemies.items,
      projectiles: this.combat.projectiles.items,
      pickups: this.enemies.pickups.items,
      fx: this.fx,
      input: this.input.getState(),
      orbitals: this.combat.orbitals,
      cameraX: 0,
      cameraY: 0,
      shakeX: 0,
      shakeY: 0,
      time: 0,
      hurtFlash: 0,
      levelUpFlash: 0,
      chronoSlowAlpha: 0,
      arenaRadius: ARENA_RADIUS,
      bossActive: false,
    };

    this.enemyHooks = {
      onEnemyKilled: (enemy, player) => {
        this.kills++;
        this.score += enemy.scoreValue;

        if (enemy.isBoss) {
          this.addShake(0.7);
          this.triggerHitStop(0.045);
          this.triggerHaptic(45);
        } else if (enemy.elite !== 'none') {
          this.addShake(0.35);
          this.triggerHitStop(0.032);
          this.triggerHaptic(22);
        }

        // Chrono Leech passive trigger
        const chronoLv = player.passives.chrono_leech ?? 0;
        if (chronoLv > 0) {
          player.killsSinceChrono++;
          const threshold = Math.max(8, 22 - chronoLv * 3);
          if (player.killsSinceChrono >= threshold) {
            player.killsSinceChrono = 0;
            player.chronoSlowTimer = 2.5;
            const bonus = player.rarityBonuses.chrono_leech ?? 0;
            const effMult = 1 + bonus / Math.max(1, chronoLv);
            const healAmt = Math.round((2 + chronoLv) * effMult);
            player.hp = Math.min(player.maxHp, player.hp + healAmt);
            const ring = this.fx.spawnShockwave(
              true,
              player.x,
              player.y,
              250,
              '#9D4EDD',
              0,
              4,
              0.42,
            );
            if (ring) ring.applied = true;
            this.fx.spawnTextPopup(
              player.x,
              player.y - 24,
              `CHRONO LEECH +${healAmt}`,
              '#9D4EDD',
              1.1,
            );
          }
        }
      },
      onPlayerHit: (amount) => {
        this.applyPlayerDamage(amount, false);
      },
      onPlayerHeal: (amount) => {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
      },
      onPickupXp: (amount) => {
        this.player.xp += amount;
      },
      onPickupGilt: (amount) => {
        this.giltRun += amount;
      },
      onRelicChest: () => {
        this.pendingChestDrafts++;
      },
      onSpawnHostileProjectile: (kind, x, y, vx, vy, radius, damage, color) => {
        this.combat.spawnHostileProjectile(kind, x, y, vx, vy, radius, damage, color);
      },
      onExplosionTriggered: (big) => {
        this.sound.playExplosion(big);
        if (big) {
          this.addShake(0.28);
        }
      },
    };

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handleBackgrounded);
    window.addEventListener('blur', this.handleBackgrounded);
    window.addEventListener('resize', this.handleResize);

    window.__ESCAPEMENT__ = {
      getScreen: () => this.screen,
      getFps: () => Math.round(this.fps),
      getWave: () => this.director.wave,
      getLevel: () => this.player.level,
      getKills: () => this.kills,
      getHp: () => Math.round(this.player.hp),
      getActiveCounts: () => ({
        enemies: this.enemies.enemies.activeCount(),
        projectiles: this.combat.projectiles.activeCount(),
        pickups: this.enemies.pickups.activeCount(),
        particles: this.fx.particles.activeCount(),
      }),
      grantXp: (amount: number) => {
        if (this.screen !== 'playing' && this.screen !== 'levelup') return;
        this.player.xp += Math.max(0, amount);
        if (this.screen === 'playing' && this.player.xp >= this.player.xpToNext) {
          this.triggerLevelUp();
        }
      },
      advanceWave: () => {
        if (this.screen !== 'playing' && this.screen !== 'levelup') return;
        this.director.forceAdvanceWave(
          this.rng,
          this.enemies,
          this.player,
          this.fx,
          this.sound,
        );
        this.emitHud();
      },
      damagePlayer: (amount: number) => {
        if (this.screen !== 'playing') return;
        this.applyPlayerDamage(Math.max(0, amount), true);
      },
    };

    this.renderFrame();
  }

  private readonly handleResize = (): void => {
    this.renderer.resize();
    if (this.screen !== 'playing') {
      this.renderFrame();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.handleBackgrounded();
    }
  };

  private readonly handleBackgrounded = (): void => {
    if (this.destroyed) return;
    this.input.reset();
    this.sound.suspend();
    this.stopLoop();
    if (this.screen === 'playing') {
      this.setScreen('paused');
    }
  };

  private setScreen(next: ScreenState): void {
    this.screen = next;
    this.callbacks.onScreenChange(next);
  }

  private startLoop(): void {
    if (
      this.destroyed ||
      this.rafId !== null ||
      this.screen !== 'playing' ||
      document.visibilityState === 'hidden'
    ) {
      return;
    }
    this.lastFrameMs = performance.now();
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private readonly tick = (nowMs: number): void => {
    this.rafId = null;
    if (this.destroyed || this.screen !== 'playing') {
      return;
    }

    const rawDt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;

    const instFps = 1 / rawDt;
    this.fps = this.fps * 0.9 + clamp(instFps, 1, 144) * 0.1;

    this.updateFrame(rawDt);
    this.renderFrame();

    if (this.screen === 'playing' && !this.destroyed) {
      this.rafId = window.requestAnimationFrame(this.tick);
    }
  };

  private updateFrame(rawDt: number): void {
    // Decay screen shake & visual flashes even during hit-stop
    this.trauma = Math.max(0, this.trauma - rawDt * 2.5);
    const shakeMag = this.save.settings.shakeEnabled ? this.trauma * this.trauma * 15 : 0;
    this.shakeX = (Math.random() * 2 - 1) * shakeMag;
    this.shakeY = (Math.random() * 2 - 1) * shakeMag;

    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - rawDt * 4.5);
    if (this.levelUpFlash > 0) {
      this.levelUpFlash = Math.max(0, this.levelUpFlash - rawDt * 2.8);
    }

    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - rawDt);
      this.fx.update(rawDt * 0.25);
      return;
    }

    const dt = rawDt;
    this.runTime += dt;

    // 1. Update player movement, Anchor Tempo, Ward & Regen
    this.updatePlayer(dt);

    // 2. Populate spatial hash for this frame
    this.enemies.populateSpatialHash(this.spatialHash);

    // 3. Wave Director spawning & progression
    this.director.update(
      dt,
      this.rng,
      this.enemies,
      this.player,
      this.fx,
      this.sound,
      (bonusGilt) => {
        this.giltRun += bonusGilt;
      },
    );

    // 4. Combat system (weapons, orbitals, projectiles, shockwaves)
    this.combat.update(
      dt,
      this.player,
      this.enemies,
      this.spatialHash,
      this.fx,
      this.sound,
      this.enemyHooks,
      this.rng,
      this.director.currentConfig.modifier,
    );

    // 5. Enemies AI, soft separation & contact checks
    this.enemies.updateEnemies(
      dt,
      this.player,
      this.fx,
      this.sound,
      this.spatialHash,
      this.enemyHooks,
      this.rng,
      this.director.currentConfig.modifier,
    );

    if (this.screen !== 'playing') return;

    // 6. Pickups vacuum & collection
    this.enemies.updatePickups(
      dt,
      this.player,
      this.fx,
      this.sound,
      this.enemyHooks,
    );

    // 7. FX particles, damage numbers, telegraphs
    this.fx.update(dt);

    // 8. Check queued Relic Chest or Level-Up drafts
    if (this.pendingChestDrafts > 0) {
      this.pendingChestDrafts--;
      this.openDraft(
        'Relic Chest Opened',
        'High-rarity Complication discovered inside the bezel!',
        true,
      );
      return;
    }

    if (this.player.xp >= this.player.xpToNext) {
      this.triggerLevelUp();
      return;
    }

    // 9. Throttled HUD updates (~16 Hz)
    this.hudSyncTimer -= dt;
    if (this.hudSyncTimer <= 0) {
      this.hudSyncTimer = 0.06;
      this.emitHud();
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const inp = this.input.getState();

    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    if (p.hitFlashTimer > 0) p.hitFlashTimer = Math.max(0, p.hitFlashTimer - dt);
    if (p.chronoSlowTimer > 0) {
      p.chronoSlowTimer = Math.max(0, p.chronoSlowTimer - dt);
      this.chronoSlowAlpha = Math.min(1, this.chronoSlowAlpha + dt * 6);
    } else {
      this.chronoSlowAlpha = Math.max(0, this.chronoSlowAlpha - dt * 3);
    }

    const moving = inp.magnitude > 0.08;
    const targetVx = inp.moveX * p.moveSpeed;
    const targetVy = inp.moveY * p.moveSpeed;
    const accel = Math.min(1, dt * 18);
    p.vx += (targetVx - p.vx) * accel;
    p.vy += (targetVy - p.vy) * accel;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Clamp to horologium arena perimeter
    const maxR = ARENA_RADIUS - p.radius;
    const distCenter = Math.hypot(p.x, p.y);
    if (distCenter > maxR && distCenter > 0.001) {
      const s = maxR / distCenter;
      p.x *= s;
      p.y *= s;
    }

    if (moving) {
      p.angle = Math.atan2(inp.moveY, inp.moveX);
      p.wheelSpin += dt * (3.0 + inp.magnitude * 4.5);
      p.standStillTime = 0;
      p.anchorActive = false;
    } else {
      p.wheelSpin += dt * 1.35;
      p.standStillTime += dt;
      p.anchorActive = p.standStillTime >= 0.42;
    }

    // HP Regen (Tempered Glass)
    if (p.hpRegen > 0 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
    }

    // Brass Ward recharge (Anchor Tempo)
    if (p.maxWard > 0 && p.ward < p.maxWard) {
      p.wardRegenTimer += dt;
      if (p.wardRegenTimer >= 3.8) {
        p.ward = Math.min(p.maxWard, p.ward + 14 * dt);
      }
    }

    // Smooth camera follow
    const camFollow = Math.min(1, dt * 10);
    this.cameraX += (p.x - this.cameraX) * camFollow;
    this.cameraY += (p.y - this.cameraY) * camFollow;
  }

  private renderFrame(): void {
    const view = this.worldView;
    view.player = this.player;
    view.enemies = this.enemies.enemies.items;
    view.projectiles = this.combat.projectiles.items;
    view.pickups = this.enemies.pickups.items;
    view.input = this.input.getState();
    view.orbitals = this.combat.orbitals;
    view.cameraX = this.cameraX;
    view.cameraY = this.cameraY;
    view.shakeX = this.shakeX;
    view.shakeY = this.shakeY;
    view.time = this.runTime;
    view.hurtFlash = this.hurtFlash;
    view.levelUpFlash = this.levelUpFlash;
    view.chronoSlowAlpha = this.chronoSlowAlpha;
    view.bossActive = this.enemies.hasActiveBoss();
    this.renderer.render(view);
  }

  private addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  private triggerHitStop(seconds: number): void {
    this.hitStopTimer = Math.min(0.045, Math.max(this.hitStopTimer, seconds));
  }

  private triggerHaptic(ms: number): void {
    if (
      this.save.settings.hapticsEnabled &&
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      try {
        navigator.vibrate(ms);
      } catch {
        // Ignore on unsupported browsers / iOS Safari
      }
    }
  }

  private applyPlayerDamage(amount: number, bypassInvuln: boolean): void {
    if (this.screen !== 'playing') return;
    if (!bypassInvuln && this.player.invulnTimer > 0) return;

    let rem = amount;
    if (this.player.ward > 0) {
      const absorbed = Math.min(this.player.ward, rem);
      this.player.ward -= absorbed;
      rem -= absorbed;
    }
    this.player.wardRegenTimer = 0;

    if (rem > 0) {
      this.player.hp = Math.max(0, this.player.hp - rem);
    }

    this.player.invulnTimer = 0.52;
    this.player.hitFlashTimer = 0.22;
    this.hurtFlash = 1.0;
    this.addShake(0.45);
    this.triggerHaptic(32);
    this.sound.playPlayerHurt();
    this.emitHud();

    if (this.player.hp <= 0) {
      this.finishRun();
    }
  }

  private triggerLevelUp(): void {
    const p = this.player;
    p.xp = Math.max(0, p.xp - p.xpToNext);
    p.level++;
    p.xpToNext = Math.round(
      14 + p.level * 10 + Math.pow(p.level, 1.45) * 3,
    );

    // Dramatic level-up shockwave & gentle knockback push
    const ring = this.fx.spawnShockwave(
      true,
      p.x,
      p.y,
      200,
      '#F5C542',
      0,
      5.5,
      0.44,
    );
    if (ring) ring.applied = true;

    this.fx.spawnBurst(p.x, p.y, '#F5C542', 22, 85, 260, 3, 6, 'diamond');
    this.levelUpFlash = 1.0;
    this.triggerHaptic(18);

    this.spatialHash.query(p.x, p.y, 200, this.pushQueryScratch);
    for (let i = 0; i < this.pushQueryScratch.length; i++) {
      const e = this.pushQueryScratch[i];
      if (!e.active || e.isBoss) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      e.kbVx += (dx / d) * 260;
      e.kbVy += (dy / d) * 260;
    }

    this.openDraft(
      `Level ${p.level} Calibration`,
      'Choose a Complication to bolt onto your frame',
      false,
    );
  }

  private openDraft(
    title: string,
    subtitle: string,
    isRelicChest: boolean,
  ): void {
    this.draftTitle = title;
    this.draftSubtitle = subtitle;
    this.draftIsRelicChest = isRelicChest;
    this.currentChoices = rollDraftChoices(this.player, this.rng, isRelicChest);

    if (this.currentChoices.length === 0) {
      // Fallback if every upgrade in the pool is maxed out
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
      this.giltRun += 15;
      this.fx.spawnTextPopup(this.player.x, this.player.y - 20, '+30 HP & +15 GILT', '#F5C542', 1.2);
      return;
    }

    const hasEvo = this.currentChoices.some((c) => c.isEvolution);
    this.sound.playLevelUp(hasEvo);
    this.stopLoop();
    this.input.reset();
    this.setScreen('levelup');
    this.emitHud();
    this.renderFrame();

    this.callbacks.onDraftReady(
      this.currentChoices,
      this.draftTitle,
      this.draftSubtitle,
      this.player.rerollsLeft > 0,
      this.player.rerollsLeft,
    );
  }

  private finishRun(): void {
    this.stopLoop();
    this.input.reset();
    this.sound.setBossMode(false);
    this.sound.playGameOver();

    const isNewBestWave = this.director.wave > this.save.bestWave;
    const isNewBestScore = this.score > this.save.bestScore;

    const milestoneGilt = Math.round(
      ((this.director.wave - 1) * 4 + Math.floor(this.score / 100)) * this.player.giltMult,
    );
    const totalGiltEarned = this.giltRun + milestoneGilt;

    this.save.gilt += totalGiltEarned;
    if (isNewBestWave) this.save.bestWave = this.director.wave;
    if (isNewBestScore) this.save.bestScore = this.score;
    if (this.director.cycle > this.save.bestCycle) {
      this.save.bestCycle = this.director.cycle;
    }
    this.save.totalKills += this.kills;
    writeSave(this.save);
    this.callbacks.onSaveChanged(this.save);

    const summary: RunSummary = {
      wave: this.director.wave,
      cycle: this.director.cycle,
      score: this.score,
      kills: this.kills,
      giltEarned: totalGiltEarned,
      durationSec: Math.round(this.runTime),
      levelReached: this.player.level,
      isNewBestWave,
      isNewBestScore,
      evolutionsUnlocked: this.evolutionsUnlocked.slice(),
      seed: this.rng.seed,
    };

    this.setScreen('gameover');
    this.callbacks.onRunOver(summary);
  }

  private emitHud(): void {
    const boss = this.enemies.getActiveBoss();
    const bossDef = boss?.bossType ? BOSS_DEFS[boss.bossType] : null;

    const weapons: HudSnapshot['weapons'] = [];
    for (let i = 0; i < WEAPON_IDS.length; i++) {
      const wId = WEAPON_IDS[i];
      const lv = this.player.weapons[wId] ?? 0;
      if (lv <= 0) continue;
      const evoId = WEAPON_TO_EVOLUTION[wId];
      const evolved = Boolean(this.player.evolutions[evoId]);
      const def = UPGRADES[evolved ? evoId : wId];
      weapons.push({
        id: wId,
        icon: def.icon,
        level: lv,
        evolved,
        color: def.color,
      });
    }

    const hud: HudSnapshot = {
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      ward: Math.ceil(this.player.ward),
      maxWard: this.player.maxWard,
      xp: this.player.xp,
      xpToNext: this.player.xpToNext,
      level: this.player.level,
      wave: this.director.wave,
      cycle: this.director.cycle,
      waveTimeLeft: Math.ceil(this.director.waveTimer),
      waveDuration: this.director.currentConfig.duration,
      waveTitle: this.director.currentConfig.title,
      waveModifierName: this.director.currentConfig.modifier?.name ?? null,
      score: this.score,
      kills: this.kills,
      giltRun: this.giltRun,
      anchorActive: this.player.anchorActive,
      bossName: bossDef ? bossDef.name : null,
      bossTitle: bossDef ? bossDef.title : null,
      bossHp: boss ? Math.max(0, Math.ceil(boss.hp)) : 0,
      bossMaxHp: boss ? boss.maxHp : 0,
      weapons,
      bannerText: this.director.bannerText,
      bannerSubtext: this.director.bannerSubtext,
      bannerColor: this.director.bannerColor,
      fps: Math.round(this.fps),
    };

    this.callbacks.onHudUpdate(hud);
  }

  // =========================================================================
  // IGameEngine Public API
  // =========================================================================

  public startRun(seed?: number): void {
    this.stopLoop();
    this.sound.unlock();
    this.sound.resume();
    this.sound.setBossMode(false);
    this.input.reset();

    this.rng = new SeededRNG(seed);
    this.fx.clear();
    this.combat.clear();
    this.enemies.clear();
    this.spatialHash.clear();

    this.player = createInitialPlayerState(this.save);
    this.director = new WaveDirector(this.rng);
    this.director.startRun(this.rng, this.sound);

    this.runTime = 0;
    this.score = 0;
    this.kills = 0;
    this.giltRun = 0;
    this.evolutionsUnlocked = [];
    this.cameraX = 0;
    this.cameraY = 0;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.hitStopTimer = 0;
    this.hurtFlash = 0;
    this.levelUpFlash = 0;
    this.chronoSlowAlpha = 0;
    this.hudSyncTimer = 0;
    this.pendingChestDrafts = 0;
    this.pendingStartDrafts = this.save.metaRanks.calibrated_start ?? 0;

    this.save.runsPlayed++;
    writeSave(this.save);
    this.callbacks.onSaveChanged(this.save);

    this.setScreen('playing');
    this.emitHud();
    this.renderFrame();

    if (this.pendingStartDrafts > 0) {
      this.pendingStartDrafts--;
      this.openDraft(
        'Calibrated Start',
        'Bonus Level-1 Complication bolted onto your frame',
        false,
      );
      return;
    }

    this.startLoop();
  }

  public pause(): void {
    if (this.screen !== 'playing') return;
    this.stopLoop();
    this.input.reset();
    this.sound.suspend();
    this.setScreen('paused');
    this.emitHud();
  }

  public resume(): void {
    if (this.screen !== 'paused') return;
    this.sound.resume();
    this.setScreen('playing');
    this.emitHud();
    this.startLoop();
  }

  public quitToTitle(): void {
    this.stopLoop();
    this.input.reset();
    this.sound.setBossMode(false);
    this.fx.clear();
    this.combat.clear();
    this.enemies.clear();
    this.setScreen('title');
    this.renderFrame();
  }

  public selectDraftChoice(index: number): void {
    if (this.screen !== 'levelup') return;
    if (index < 0 || index >= this.currentChoices.length) return;

    const choice = this.currentChoices[index];
    const prevDiscoveredCount = this.save.discoveredEvolutions.length;
    const result = applyDraftChoice(this.player, choice, this.save);

    if (result.evolved && result.evolutionId) {
      this.evolutionsUnlocked.push(result.evolutionId);
      this.sound.playLevelUp(true);
      this.addShake(0.42);
      const ring = this.fx.spawnShockwave(
        true,
        this.player.x,
        this.player.y,
        240,
        '#C77DFF',
        0,
        6,
        0.5,
      );
      if (ring) ring.applied = true;
      this.fx.spawnBurst(this.player.x, this.player.y, '#C77DFF', 28, 90, 290, 3.5, 6.5, 'diamond');
      this.fx.spawnTextPopup(
        this.player.x,
        this.player.y - 26,
        `${choice.name.toUpperCase()}!`,
        '#C77DFF',
        1.35,
      );
      if (this.save.discoveredEvolutions.length > prevDiscoveredCount) {
        writeSave(this.save);
        this.callbacks.onSaveChanged(this.save);
      }
    } else {
      this.sound.playUiClick();
    }

    this.currentChoices = [];

    if (this.pendingStartDrafts > 0) {
      this.pendingStartDrafts--;
      this.openDraft(
        'Calibrated Start',
        'Bonus Level-1 Complication bolted onto your frame',
        false,
      );
      return;
    }

    if (this.pendingChestDrafts > 0) {
      this.pendingChestDrafts--;
      this.openDraft(
        'Relic Chest Opened',
        'High-rarity Complication discovered inside the bezel!',
        true,
      );
      return;
    }

    if (this.player.xp >= this.player.xpToNext) {
      this.triggerLevelUp();
      return;
    }

    this.setScreen('playing');
    this.emitHud();
    this.startLoop();
  }

  public rerollDraft(): void {
    if (this.screen !== 'levelup' || this.player.rerollsLeft <= 0) return;
    this.player.rerollsLeft--;
    this.sound.playUiClick();
    this.currentChoices = rollDraftChoices(
      this.player,
      this.rng,
      this.draftIsRelicChest,
    );
    this.callbacks.onDraftReady(
      this.currentChoices,
      this.draftTitle,
      this.draftSubtitle,
      this.player.rerollsLeft > 0,
      this.player.rerollsLeft,
    );
  }

  public getSave(): SaveData {
    return this.save;
  }

  public updateSettings(partial: Partial<SettingsData>): void {
    this.save.settings = {
      ...this.save.settings,
      ...partial,
    };
    this.sound.setSettings(
      this.save.settings.soundEnabled,
      this.save.settings.musicEnabled,
    );
    writeSave(this.save);
    this.callbacks.onSaveChanged(this.save);
  }

  public buyMetaUpgrade(id: MetaUpgradeId): boolean {
    const def = META_UPGRADES.find((m) => m.id === id);
    if (!def) return false;
    const rank = this.save.metaRanks[id] ?? 0;
    if (rank >= def.maxRank) return false;

    const cost = getMetaUpgradeCost(def, rank);
    if (this.save.gilt < cost) return false;

    this.save.gilt -= cost;
    this.save.metaRanks[id] = rank + 1;
    this.sound.unlock();
    this.sound.playUiClick();
    writeSave(this.save);
    this.callbacks.onSaveChanged(this.save);
    return true;
  }

  public resetProgress(): void {
    this.save = resetSave();
    this.sound.setSettings(
      this.save.settings.soundEnabled,
      this.save.settings.musicEnabled,
    );
    this.callbacks.onSaveChanged(this.save);
  }

  public getScreen(): ScreenState {
    return this.screen;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    this.input.destroy();
    this.sound.suspend();

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handleBackgrounded);
    window.removeEventListener('blur', this.handleBackgrounded);
    window.removeEventListener('resize', this.handleResize);

    if (window.__ESCAPEMENT__) {
      window.__ESCAPEMENT__ = undefined;
    }
  }
}
