import type { PickupKind, SoundEngine } from '../types.ts';

type ShotKind = 'bolt' | 'prism' | 'scythe' | 'lightning' | 'chime' | 'gilded';

interface WindowWithWebkitAudio extends Window {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

const MASTER_GAIN_LEVEL = 0.78;
const SFX_BUS_LEVEL = 0.9;
const MUSIC_BUS_LEVEL = 0.34;

// Cooldowns in milliseconds for dense mobile combat
const COOLDOWN_SHOT_MS = 45;
const COOLDOWN_HIT_MS = 32;
const COOLDOWN_PICKUP_MS = 28;
const COOLDOWN_KILL_MS = 36;
const COOLDOWN_EXPLOSION_MS = 52;
const COOLDOWN_EXPLOSION_BIG_MS = 32;
const COOLDOWN_UI_MS = 24;

// D-minor pentatonic crystal bell ladder (16 steps: A4 .. A7)
const RUBY_PENTATONIC_HZ: readonly number[] = [
  440.0,
  523.25,
  587.33,
  698.46,
  783.99,
  880.0,
  1046.5,
  1174.66,
  1396.91,
  1567.98,
  1760.0,
  2093.0,
  2349.32,
  2793.83,
  3135.96,
  3520.0,
];

// 32-step (2-bar, 16th-note) D-minor horological bass & celesta patterns
const BASS_PATTERN_NORMAL: readonly number[] = [
  73.42, 0, 0, 0, 73.42, 0, 110.0, 0, 73.42, 0, 0, 0, 87.31, 0, 98.0, 0,
  58.27, 0, 0, 0, 58.27, 0, 65.41, 0, 55.0, 0, 0, 0, 65.41, 0, 82.41, 0,
];

const BASS_PATTERN_BOSS: readonly number[] = [
  73.42, 0, 73.42, 0, 110.0, 0, 73.42, 0, 87.31, 0, 73.42, 0, 98.0, 0, 82.41, 0,
  58.27, 0, 58.27, 0, 65.41, 0, 58.27, 0, 55.0, 0, 69.3, 0, 55.0, 0, 82.41, 0,
];

const CELESTA_PATTERN_NORMAL: readonly number[] = [
  587.33, 0, 0, 698.46, 0, 0, 880.0, 0, 0, 1046.5, 0, 0, 880.0, 0, 783.99, 0,
  466.16, 0, 0, 587.33, 0, 0, 698.46, 0, 0, 659.25, 0, 523.25, 0, 440.0, 0, 0,
];

const CELESTA_PATTERN_BOSS: readonly number[] = [
  587.33, 0, 880.0, 0, 698.46, 0, 1046.5, 0, 830.61, 0, 880.0, 0, 698.46, 0, 554.37, 0,
  466.16, 0, 698.46, 0, 523.25, 0, 783.99, 0, 554.37, 0, 659.25, 0, 440.0, 0, 554.37, 0,
];

const MUSIC_LOOKAHEAD_SEC = 0.14;
const MUSIC_INTERVAL_MS = 45;
const TEMPO_NORMAL_BPM = 112;
const TEMPO_BOSS_BPM = 134;

export class HorologySynth implements SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private shortNoiseBuffer: AudioBuffer | null = null;
  private longNoiseBuffer: AudioBuffer | null = null;
  private silentUnlockPlayed = false;

  private unsupported = false;
  private unlocked = false;
  private isSuspended = false;
  private soundEnabled = true;
  private musicEnabled = true;
  private bossMode = false;

  // Music scheduler state
  private musicTimerId: number | null = null;
  private nextNoteTime = 0;
  private musicStep = 0;

  // Cooldown timestamps (ms)
  private readonly lastShotTime: Record<ShotKind, number> = {
    bolt: -1000,
    gilded: -1000,
    prism: -1000,
    scythe: -1000,
    lightning: -1000,
    chime: -1000,
  };
  private lastHitTime = -1000;
  private lastKillTime = -1000;
  private lastEliteKillTime = -1000;
  private lastExplosionTime = -1000;
  private lastPickupTime = -1000;
  private lastUiTime = -1000;

  unlock(): void {
    if (this.unsupported) return;

    try {
      if (!this.ctx) {
        const win = window as WindowWithWebkitAudio;
        const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
        if (!AudioCtx) {
          this.unsupported = true;
          return;
        }
        this.ctx = new AudioCtx({ latencyHint: 'interactive' });
        this.initGraph(this.ctx);
      }

      if (this.ctx.state === 'closed') {
        this.unsupported = true;
        return;
      }

      this.unlocked = true;

      if (this.ctx.state === 'suspended' && !this.isSuspended) {
        void this.ctx
          .resume()
          .then(() => {
            this.syncBusGains();
            this.syncMusicScheduler();
          })
          .catch(() => {});
      }

      // Play a silent 1-sample buffer to unlock iOS Safari WebAudio hardware output
      if (!this.silentUnlockPlayed) {
        this.playSilentUnlockSample(this.ctx);
        this.silentUnlockPlayed = true;
      }

      this.syncBusGains();
      this.syncMusicScheduler();
    } catch {
      this.unsupported = true;
    }
  }

  setSettings(soundEnabled: boolean, musicEnabled: boolean): void {
    this.soundEnabled = soundEnabled;
    this.musicEnabled = musicEnabled;
    this.syncBusGains();
    this.syncMusicScheduler();
  }

  suspend(): void {
    this.isSuspended = true;
    this.stopMusicScheduler();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'running') {
        void this.ctx.suspend().catch(() => {});
      }
    } catch {
      // Ignore suspend failures on unsupported browsers
    }
  }

  resume(): void {
    this.isSuspended = false;
    if (!this.ctx || !this.unlocked || this.unsupported) return;
    try {
      if (this.ctx.state === 'suspended') {
        void this.ctx
          .resume()
          .then(() => {
            this.syncBusGains();
            this.syncMusicScheduler();
          })
          .catch(() => {});
      } else {
        this.syncBusGains();
        this.syncMusicScheduler();
      }
    } catch {
      // Ignore resume failures
    }
  }

  setBossMode(active: boolean): void {
    this.bossMode = active;
  }

  playShot(kind: ShotKind): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const nowMs = this.nowMs();
    if (nowMs - this.lastShotTime[kind] < COOLDOWN_SHOT_MS) return;
    this.lastShotTime[kind] = nowMs;

    const t = ctx.currentTime;
    switch (kind) {
      case 'bolt': {
        // Crisp blued-steel watch escapement tick-snap
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'triangle',
          freqStart: 1680,
          freqEnd: 410,
          start: t,
          attack: 0.002,
          duration: 0.048,
          gain: 0.17,
        });
        this.scheduleNoise(ctx, this.sfxBus!, {
          start: t,
          attack: 0.001,
          duration: 0.024,
          gain: 0.14,
          filterType: 'bandpass',
          freqStart: 2900,
          q: 2.8,
        });
        break;
      }
      case 'gilded': {
        // Richer harmonic double-tick
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'triangle',
          freqStart: 1920,
          freqEnd: 560,
          start: t,
          attack: 0.002,
          duration: 0.05,
          gain: 0.15,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: 2880,
          freqEnd: 880,
          start: t + 0.022,
          attack: 0.002,
          duration: 0.055,
          gain: 0.13,
        });
        this.scheduleNoise(ctx, this.sfxBus!, {
          start: t,
          attack: 0.001,
          duration: 0.032,
          gain: 0.13,
          filterType: 'highpass',
          freqStart: 2400,
          q: 1.2,
        });
        break;
      }
      case 'prism': {
        // Sparkling crystalline ping
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: 1760,
          freqEnd: 1740,
          start: t,
          attack: 0.003,
          duration: 0.15,
          gain: 0.14,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: 2637,
          freqEnd: 2655,
          start: t + 0.008,
          attack: 0.003,
          duration: 0.13,
          gain: 0.09,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'triangle',
          freqStart: 3520,
          freqEnd: 3100,
          start: t,
          attack: 0.002,
          duration: 0.075,
          gain: 0.06,
        });
        break;
      }
      case 'scythe': {
        // Resonant brass whoosh
        this.scheduleNoise(ctx, this.sfxBus!, {
          start: t,
          attack: 0.025,
          duration: 0.18,
          gain: 0.22,
          filterType: 'bandpass',
          freqStart: 340,
          freqMid: 1380,
          freqEnd: 460,
          q: 3.2,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sawtooth',
          freqStart: 240,
          freqEnd: 135,
          start: t,
          attack: 0.012,
          duration: 0.16,
          gain: 0.11,
          filterFreq: 850,
        });
        break;
      }
      case 'lightning': {
        // Snappy electric crackle
        this.scheduleNoise(ctx, this.sfxBus!, {
          start: t,
          attack: 0.002,
          duration: 0.085,
          gain: 0.2,
          filterType: 'highpass',
          freqStart: 4200,
          freqEnd: 1200,
          q: 1.5,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sawtooth',
          freqStart: 1080,
          freqEnd: 190,
          start: t,
          attack: 0.002,
          duration: 0.075,
          gain: 0.11,
          filterFreq: 2600,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'square',
          freqStart: 2500,
          freqEnd: 620,
          start: t + 0.016,
          attack: 0.001,
          duration: 0.042,
          gain: 0.07,
        });
        break;
      }
      case 'chime': {
        // Deep cathedral bronze bell strike
        this.scheduleBellStrike(ctx, this.sfxBus!, t, 146.83, 0.56, 0.26);
        this.scheduleNoise(ctx, this.sfxBus!, {
          start: t,
          attack: 0.001,
          duration: 0.02,
          gain: 0.14,
          filterType: 'bandpass',
          freqStart: 1400,
          q: 2.0,
        });
        break;
      }
    }
  }

  playHit(crit: boolean): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const nowMs = this.nowMs();
    if (nowMs - this.lastHitTime < COOLDOWN_HIT_MS) return;
    this.lastHitTime = nowMs;

    const t = ctx.currentTime;
    if (!crit) {
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'triangle',
        freqStart: 920,
        freqEnd: 310,
        start: t,
        attack: 0.002,
        duration: 0.038,
        gain: 0.13,
      });
      this.scheduleNoise(ctx, this.sfxBus!, {
        start: t,
        attack: 0.001,
        duration: 0.018,
        gain: 0.09,
        filterType: 'bandpass',
        freqStart: 3200,
        q: 2.2,
      });
    } else {
      // Layered bright harmonic crunch + higher bell overtone
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'triangle',
        freqStart: 760,
        freqEnd: 230,
        start: t,
        attack: 0.002,
        duration: 0.065,
        gain: 0.18,
      });
      this.scheduleNoise(ctx, this.sfxBus!, {
        start: t,
        attack: 0.001,
        duration: 0.062,
        gain: 0.18,
        filterType: 'bandpass',
        freqStart: 2500,
        freqEnd: 1400,
        q: 1.8,
      });
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'sine',
        freqStart: 1760,
        freqEnd: 1750,
        start: t,
        attack: 0.002,
        duration: 0.16,
        gain: 0.12,
      });
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'sine',
        freqStart: 2349.32,
        freqEnd: 2330,
        start: t + 0.005,
        attack: 0.002,
        duration: 0.14,
        gain: 0.09,
      });
    }
  }

  playKill(elite: boolean): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const nowMs = this.nowMs();
    if (elite) {
      if (nowMs - this.lastEliteKillTime < COOLDOWN_KILL_MS) return;
      this.lastEliteKillTime = nowMs;
    } else {
      if (nowMs - this.lastKillTime < COOLDOWN_KILL_MS) return;
      this.lastKillTime = nowMs;
    }

    const t = ctx.currentTime;
    // Crisp gear shatter
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'triangle',
      freqStart: 1320,
      freqEnd: 480,
      start: t,
      attack: 0.002,
      duration: 0.075,
      gain: 0.15,
    });
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'triangle',
      freqStart: 1860,
      freqEnd: 740,
      start: t + 0.02,
      attack: 0.002,
      duration: 0.07,
      gain: 0.12,
    });
    this.scheduleNoise(ctx, this.sfxBus!, {
      start: t,
      attack: 0.002,
      duration: 0.085,
      gain: 0.16,
      filterType: 'highpass',
      freqStart: 2200,
      freqEnd: 1100,
      q: 1.4,
    });

    if (elite) {
      // Dramatic resonant chord burst
      const chord = [293.66, 440.0, 587.33, 698.46];
      for (let i = 0; i < chord.length; i++) {
        this.scheduleTone(ctx, this.sfxBus!, {
          type: i < 2 ? 'triangle' : 'sine',
          freqStart: chord[i],
          freqEnd: chord[i] * 0.996,
          start: t + i * 0.012,
          attack: 0.005,
          duration: 0.36,
          gain: 0.11,
        });
      }
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'sine',
        freqStart: 146.83,
        freqEnd: 55,
        start: t,
        attack: 0.003,
        duration: 0.22,
        gain: 0.22,
      });
    }
  }

  playExplosion(big: boolean): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const nowMs = this.nowMs();
    const minInterval = big ? COOLDOWN_EXPLOSION_BIG_MS : COOLDOWN_EXPLOSION_MS;
    if (nowMs - this.lastExplosionTime < minInterval) return;
    this.lastExplosionTime = nowMs;

    const t = ctx.currentTime;
    const dur = big ? 0.42 : 0.24;

    // Punchy low-end spring boom
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: big ? 135 : 145,
      freqEnd: 34,
      start: t,
      attack: 0.004,
      duration: dur,
      gain: big ? 0.34 : 0.24,
    });
    // Spring metallic resonance
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'triangle',
      freqStart: big ? 480 : 540,
      freqEnd: 150,
      start: t,
      attack: 0.002,
      duration: dur * 0.72,
      gain: big ? 0.16 : 0.11,
    });
    // Filtered metallic noise burst
    this.scheduleNoise(ctx, this.sfxBus!, {
      start: t,
      attack: 0.003,
      duration: dur,
      gain: big ? 0.28 : 0.2,
      filterType: 'lowpass',
      freqStart: big ? 1800 : 1400,
      freqEnd: 180,
      q: 1.6,
      useLongBuffer: big,
    });
  }

  playPickup(kind: PickupKind, streak: number): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const nowMs = this.nowMs();
    // Relic chests & heals should not be dropped by rapid ruby collection
    if (kind !== 'relic_chest' && kind !== 'heal') {
      if (nowMs - this.lastPickupTime < COOLDOWN_PICKUP_MS) return;
      this.lastPickupTime = nowMs;
    }

    const t = ctx.currentTime;
    switch (kind) {
      case 'ruby':
      case 'ruby_large': {
        const clamped = Math.max(0, Math.min(15, Math.floor(streak)));
        const freq = RUBY_PENTATONIC_HZ[clamped];
        const isLarge = kind === 'ruby_large';

        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: freq,
          freqEnd: freq * 1.003,
          start: t,
          attack: 0.003,
          duration: isLarge ? 0.24 : 0.15,
          gain: isLarge ? 0.18 : 0.14,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: freq * 2.0,
          freqEnd: freq * 2.0,
          start: t,
          attack: 0.002,
          duration: isLarge ? 0.16 : 0.09,
          gain: isLarge ? 0.08 : 0.055,
        });
        if (isLarge) {
          this.scheduleTone(ctx, this.sfxBus!, {
            type: 'triangle',
            freqStart: freq * 0.5,
            freqEnd: freq * 0.5,
            start: t,
            attack: 0.004,
            duration: 0.22,
            gain: 0.11,
          });
        }
        break;
      }
      case 'gilt': {
        // Bright brass coin clink
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: 1975.53,
          freqEnd: 1975.53,
          start: t,
          attack: 0.002,
          duration: 0.1,
          gain: 0.12,
        });
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: 2959.96,
          freqEnd: 2959.96,
          start: t + 0.026,
          attack: 0.002,
          duration: 0.13,
          gain: 0.13,
        });
        break;
      }
      case 'heal': {
        // Warm rising triad (D4 - F#4 - A4 - D5)
        const notes = [293.66, 369.99, 440.0, 587.33];
        for (let i = 0; i < notes.length; i++) {
          const onset = t + i * 0.052;
          this.scheduleTone(ctx, this.sfxBus!, {
            type: 'triangle',
            freqStart: notes[i],
            freqEnd: notes[i],
            start: onset,
            attack: 0.01,
            duration: 0.22,
            gain: 0.12,
            filterFreq: 1900,
          });
        }
        break;
      }
      case 'relic_chest': {
        // Majestic golden arpeggio
        const arp = [293.66, 440.0, 587.33, 659.25, 698.46, 880.0, 1174.66];
        for (let i = 0; i < arp.length; i++) {
          const onset = t + i * 0.046;
          this.scheduleTone(ctx, this.sfxBus!, {
            type: i < 3 ? 'triangle' : 'sine',
            freqStart: arp[i],
            freqEnd: arp[i],
            start: onset,
            attack: 0.005,
            duration: i === arp.length - 1 ? 0.55 : 0.24,
            gain: 0.14,
          });
          if (i >= 3) {
            this.scheduleTone(ctx, this.sfxBus!, {
              type: 'sine',
              freqStart: arp[i] * 2,
              freqEnd: arp[i] * 2,
              start: onset,
              attack: 0.004,
              duration: 0.22,
              gain: 0.05,
            });
          }
        }
        break;
      }
    }
  }

  playLevelUp(isEvolution: boolean): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    if (!isEvolution) {
      // Dramatic resonant brass bell chord
      const notes = [293.66, 440.0, 587.33, 698.46, 880.0];
      for (let i = 0; i < notes.length; i++) {
        const onset = t + i * 0.024;
        this.scheduleTone(ctx, this.sfxBus!, {
          type: i < 2 ? 'triangle' : 'sine',
          freqStart: notes[i],
          freqEnd: notes[i],
          start: onset,
          attack: 0.008,
          duration: 0.58,
          gain: 0.14,
          filterFreq: 2800,
        });
      }
      this.scheduleBellStrike(ctx, this.sfxBus!, t, 293.66, 0.55, 0.16);
    } else {
      // Sweeping harmonic fanfare with shimmer
      const fanfare = [293.66, 349.23, 440.0, 587.33, 739.99, 880.0, 1174.66];
      for (let i = 0; i < fanfare.length; i++) {
        const onset = t + i * 0.055;
        const hold = i === fanfare.length - 1 ? 0.95 : 0.42;
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'triangle',
          freqStart: fanfare[i],
          freqEnd: fanfare[i] * 1.003,
          start: onset,
          attack: 0.008,
          duration: hold,
          gain: 0.14,
          filterFreq: 3400,
        });
        // Detuned shimmer chorus
        this.scheduleTone(ctx, this.sfxBus!, {
          type: 'sine',
          freqStart: fanfare[i] * 2.004,
          freqEnd: fanfare[i] * 1.996,
          start: onset + 0.01,
          attack: 0.01,
          duration: hold * 0.85,
          gain: 0.06,
        });
      }
      this.scheduleBellStrike(ctx, this.sfxBus!, t, 146.83, 0.9, 0.22);
      this.scheduleNoise(ctx, this.sfxBus!, {
        start: t + 0.12,
        attack: 0.08,
        duration: 0.55,
        gain: 0.08,
        filterType: 'bandpass',
        freqStart: 1800,
        freqEnd: 4600,
        q: 2.5,
        useLongBuffer: true,
      });
    }
  }

  playPlayerHurt(): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    // Low resonant spring twang
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sawtooth',
      freqStart: 215,
      freqEnd: 68,
      start: t,
      attack: 0.004,
      duration: 0.24,
      gain: 0.2,
      filterFreq: 560,
    });
    // Dull thud
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: 118,
      freqEnd: 38,
      start: t,
      attack: 0.002,
      duration: 0.18,
      gain: 0.28,
    });
    this.scheduleNoise(ctx, this.sfxBus!, {
      start: t,
      attack: 0.002,
      duration: 0.09,
      gain: 0.18,
      filterType: 'lowpass',
      freqStart: 640,
      freqEnd: 140,
      q: 1.5,
    });
  }

  playBossSpawn(): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    // Ominous deep clocktower chime
    this.scheduleBellStrike(ctx, this.sfxBus!, t, 73.42, 1.35, 0.3);
    this.scheduleBellStrike(ctx, this.sfxBus!, t + 0.04, 110.0, 1.15, 0.18);

    // Descending tension pulses
    const pulses = [174.61, 164.81, 146.83];
    for (let i = 0; i < pulses.length; i++) {
      const onset = t + 0.24 + i * 0.22;
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'sawtooth',
        freqStart: pulses[i],
        freqEnd: pulses[i] * 0.94,
        start: onset,
        attack: 0.01,
        duration: 0.2,
        gain: 0.15,
        filterFreq: 680,
      });
      this.scheduleNoise(ctx, this.sfxBus!, {
        start: onset,
        attack: 0.001,
        duration: 0.032,
        gain: 0.12,
        filterType: 'bandpass',
        freqStart: 1900,
        q: 3.0,
      });
    }
  }

  playWaveClear(): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    // Crisp double watch-chime cadence
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: 440.0,
      freqEnd: 440.0,
      start: t,
      attack: 0.004,
      duration: 0.26,
      gain: 0.15,
    });
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: 659.25,
      freqEnd: 659.25,
      start: t,
      attack: 0.004,
      duration: 0.26,
      gain: 0.12,
    });
    this.scheduleNoise(ctx, this.sfxBus!, {
      start: t,
      attack: 0.001,
      duration: 0.018,
      gain: 0.09,
      filterType: 'bandpass',
      freqStart: 3100,
      q: 2.5,
    });

    const t2 = t + 0.15;
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: 587.33,
      freqEnd: 587.33,
      start: t2,
      attack: 0.004,
      duration: 0.4,
      gain: 0.16,
    });
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: 880.0,
      freqEnd: 880.0,
      start: t2,
      attack: 0.004,
      duration: 0.4,
      gain: 0.13,
    });
    this.scheduleNoise(ctx, this.sfxBus!, {
      start: t2,
      attack: 0.001,
      duration: 0.018,
      gain: 0.09,
      filterType: 'bandpass',
      freqStart: 3400,
      q: 2.5,
    });
  }

  playUiClick(): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const nowMs = this.nowMs();
    if (nowMs - this.lastUiTime < COOLDOWN_UI_MS) return;
    this.lastUiTime = nowMs;

    const t = ctx.currentTime;
    // Subtle mechanical watch-crown click
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'triangle',
      freqStart: 1450,
      freqEnd: 880,
      start: t,
      attack: 0.001,
      duration: 0.022,
      gain: 0.1,
    });
    this.scheduleNoise(ctx, this.sfxBus!, {
      start: t,
      attack: 0.001,
      duration: 0.014,
      gain: 0.08,
      filterType: 'bandpass',
      freqStart: 3600,
      q: 3.0,
    });
  }

  playGameOver(): void {
    const ctx = this.readySfxContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    // Unwinding spring descent (6 ratchet ticks stepping down in pitch)
    const tickTimes = [0, 0.07, 0.15, 0.25, 0.38, 0.54];
    const tickFreqs = [680, 540, 420, 320, 230, 155];
    for (let i = 0; i < tickTimes.length; i++) {
      const onset = t + tickTimes[i];
      this.scheduleTone(ctx, this.sfxBus!, {
        type: 'triangle',
        freqStart: tickFreqs[i],
        freqEnd: tickFreqs[i] * 0.72,
        start: onset,
        attack: 0.002,
        duration: 0.065,
        gain: 0.14,
      });
      this.scheduleNoise(ctx, this.sfxBus!, {
        start: onset,
        attack: 0.001,
        duration: 0.022,
        gain: 0.09,
        filterType: 'bandpass',
        freqStart: 1600 - i * 180,
        q: 2.2,
      });
    }

    // Low melancholic bronze gong
    this.scheduleBellStrike(ctx, this.sfxBus!, t + 0.08, 73.42, 1.45, 0.28);
    this.scheduleTone(ctx, this.sfxBus!, {
      type: 'sine',
      freqStart: 87.31,
      freqEnd: 82.41,
      start: t + 0.12,
      attack: 0.03,
      duration: 1.25,
      gain: 0.12,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal graph & scheduling helpers
  // ---------------------------------------------------------------------------

  private initGraph(ctx: AudioContext): void {
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.soundEnabled ? MASTER_GAIN_LEVEL : 0;
    masterGain.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_BUS_LEVEL;

    const musicBus = ctx.createGain();
    musicBus.gain.value = this.soundEnabled && this.musicEnabled ? MUSIC_BUS_LEVEL : 0;

    let compressor: DynamicsCompressorNode | null = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 16;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      sfxBus.connect(compressor);
      musicBus.connect(compressor);
      compressor.connect(masterGain);
    } else {
      sfxBus.connect(masterGain);
      musicBus.connect(masterGain);
    }

    this.masterGain = masterGain;
    this.compressor = compressor;
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.shortNoiseBuffer = this.createNoiseBuffer(ctx, 0.45);
    this.longNoiseBuffer = this.createNoiseBuffer(ctx, 1.25);
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private playSilentUnlockSample(ctx: AudioContext): void {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // Ignore if context is not ready
    }
  }

  private syncBusGains(): void {
    if (!this.ctx || !this.masterGain || !this.musicBus) return;
    try {
      const t = this.ctx.currentTime;
      const targetMaster = this.soundEnabled ? MASTER_GAIN_LEVEL : 0;
      const targetMusic = this.soundEnabled && this.musicEnabled ? MUSIC_BUS_LEVEL : 0;

      if (this.ctx.state === 'running') {
        this.masterGain.gain.setTargetAtTime(targetMaster, t, 0.015);
        this.musicBus.gain.setTargetAtTime(targetMusic, t, 0.03);
      } else {
        this.masterGain.gain.value = targetMaster;
        this.musicBus.gain.value = targetMusic;
      }
      // Keep reference used for strict noUnusedLocals compliance
      void this.compressor;
    } catch {
      // Ignore parameter automation errors
    }
  }

  private readySfxContext(): AudioContext | null {
    if (this.unsupported || !this.unlocked || this.isSuspended || !this.soundEnabled) {
      return null;
    }
    if (!this.ctx || !this.sfxBus || this.ctx.state !== 'running') {
      return null;
    }
    return this.ctx;
  }

  private nowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private scheduleTone(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      type: OscillatorType;
      freqStart: number;
      freqEnd: number;
      start: number;
      attack: number;
      duration: number;
      gain: number;
      filterFreq?: number;
    },
  ): void {
    try {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      const start = Math.max(ctx.currentTime, opts.start);
      const duration = Math.max(0.012, opts.duration);
      const attack = Math.min(duration * 0.45, Math.max(0.001, opts.attack));
      const end = start + duration;
      const peakGain = Math.max(0.0002, opts.gain);
      const fStart = Math.max(20, opts.freqStart);
      const fEnd = Math.max(20, opts.freqEnd);

      osc.type = opts.type;
      osc.frequency.setValueAtTime(fStart, start);
      if (Math.abs(fEnd - fStart) > 0.01) {
        osc.frequency.exponentialRampToValueAtTime(fEnd, end);
      }

      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.linearRampToValueAtTime(peakGain, start + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

      if (opts.filterFreq !== undefined) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.max(80, opts.filterFreq), start);
        osc.connect(filter);
        filter.connect(gainNode);
      } else {
        osc.connect(gainNode);
      }

      gainNode.connect(dest);
      osc.start(start);
      osc.stop(end + 0.015);
    } catch {
      // Fail silently on transient audio errors
    }
  }

  private scheduleNoise(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      start: number;
      attack: number;
      duration: number;
      gain: number;
      filterType: BiquadFilterType;
      freqStart: number;
      freqMid?: number;
      freqEnd?: number;
      q: number;
      useLongBuffer?: boolean;
    },
  ): void {
    const buffer = opts.useLongBuffer ? this.longNoiseBuffer : this.shortNoiseBuffer;
    if (!buffer) return;

    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = opts.filterType;
      filter.Q.value = Math.max(0.2, opts.q);

      const gainNode = ctx.createGain();
      const start = Math.max(ctx.currentTime, opts.start);
      const duration = Math.min(buffer.duration - 0.01, Math.max(0.01, opts.duration));
      const attack = Math.min(duration * 0.45, Math.max(0.001, opts.attack));
      const end = start + duration;
      const peakGain = Math.max(0.0002, opts.gain);

      filter.frequency.setValueAtTime(Math.max(60, opts.freqStart), start);
      if (opts.freqMid !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(60, opts.freqMid),
          start + duration * 0.45,
        );
      }
      if (opts.freqEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.freqEnd), end);
      }

      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.linearRampToValueAtTime(peakGain, start + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

      src.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(dest);

      src.start(start);
      src.stop(end + 0.01);
    } catch {
      // Fail silently on transient audio errors
    }
  }

  private scheduleBellStrike(
    ctx: AudioContext,
    dest: AudioNode,
    start: number,
    fundamentalHz: number,
    duration: number,
    gain: number,
  ): void {
    // Bronze bell partial ratios: hum (1x), minor 3rd (1.2x), 5th (1.5x), octave (2x), metallic (2.41x)
    const ratios = [1.0, 1.2, 1.5, 2.0, 2.41];
    const weights = [1.0, 0.42, 0.5, 0.45, 0.28];
    const decays = [1.0, 0.85, 0.78, 0.68, 0.48];

    for (let i = 0; i < ratios.length; i++) {
      this.scheduleTone(ctx, dest, {
        type: i === 0 ? 'triangle' : 'sine',
        freqStart: fundamentalHz * ratios[i],
        freqEnd: fundamentalHz * ratios[i] * 0.998,
        start,
        attack: 0.003,
        duration: duration * decays[i],
        gain: gain * weights[i],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Procedural background music scheduler
  // ---------------------------------------------------------------------------

  private shouldRunMusic(): boolean {
    return (
      !this.unsupported &&
      this.unlocked &&
      !this.isSuspended &&
      this.soundEnabled &&
      this.musicEnabled &&
      this.ctx !== null &&
      this.musicBus !== null &&
      this.ctx.state === 'running'
    );
  }

  private syncMusicScheduler(): void {
    if (!this.shouldRunMusic()) {
      this.stopMusicScheduler();
      return;
    }

    if (this.musicTimerId !== null || !this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.04;
    this.musicTimerId = window.setInterval(() => {
      this.scheduleMusicAhead();
    }, MUSIC_INTERVAL_MS);
  }

  private stopMusicScheduler(): void {
    if (this.musicTimerId !== null) {
      window.clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }
  }

  private scheduleMusicAhead(): void {
    if (!this.shouldRunMusic() || !this.ctx || !this.musicBus) {
      this.stopMusicScheduler();
      return;
    }

    const ctx = this.ctx;
    // If tab stalled and nextNoteTime fell far behind, jump forward cleanly
    if (this.nextNoteTime < ctx.currentTime - 0.1) {
      this.nextNoteTime = ctx.currentTime + 0.03;
    }

    const bpm = this.bossMode ? TEMPO_BOSS_BPM : TEMPO_NORMAL_BPM;
    const stepDuration = 60 / bpm / 4; // 16th note

    while (this.nextNoteTime < ctx.currentTime + MUSIC_LOOKAHEAD_SEC) {
      this.scheduleMusicStep(ctx, this.musicBus, this.musicStep, this.nextNoteTime, stepDuration);
      this.nextNoteTime += stepDuration;
      this.musicStep = (this.musicStep + 1) & 31;
    }
  }

  private scheduleMusicStep(
    ctx: AudioContext,
    bus: GainNode,
    step: number,
    time: number,
    stepDuration: number,
  ): void {
    // 1. Atmospheric horological tick-tock pulse
    if (step % 4 === 0) {
      // Crisp high tick
      this.scheduleNoise(ctx, bus, {
        start: time,
        attack: 0.001,
        duration: 0.018,
        gain: 0.11,
        filterType: 'bandpass',
        freqStart: 4200,
        q: 3.4,
      });
      this.scheduleTone(ctx, bus, {
        type: 'sine',
        freqStart: 2200,
        freqEnd: 1650,
        start: time,
        attack: 0.001,
        duration: 0.016,
        gain: 0.04,
      });
    } else if (step % 4 === 2) {
      // Slightly lower tock
      this.scheduleNoise(ctx, bus, {
        start: time,
        attack: 0.001,
        duration: 0.02,
        gain: 0.085,
        filterType: 'bandpass',
        freqStart: 2800,
        q: 3.0,
      });
      this.scheduleTone(ctx, bus, {
        type: 'sine',
        freqStart: 1480,
        freqEnd: 1100,
        start: time,
        attack: 0.001,
        duration: 0.018,
        gain: 0.035,
      });
    } else if (this.bossMode) {
      // Tense 16th-note clockwork ratchet ticks during boss fights
      this.scheduleNoise(ctx, bus, {
        start: time,
        attack: 0.001,
        duration: 0.012,
        gain: 0.055,
        filterType: 'highpass',
        freqStart: 4800,
        q: 1.5,
      });
    }

    // 2. Boss mode percussive clock-gear hits
    if (this.bossMode && (step % 8 === 3 || step % 8 === 6)) {
      this.scheduleTone(ctx, bus, {
        type: 'triangle',
        freqStart: step % 8 === 3 ? 310 : 255,
        freqEnd: 115,
        start: time,
        attack: 0.002,
        duration: 0.08,
        gain: 0.13,
      });
      this.scheduleNoise(ctx, bus, {
        start: time,
        attack: 0.001,
        duration: 0.045,
        gain: 0.11,
        filterType: 'bandpass',
        freqStart: 1650,
        q: 2.6,
      });
    }

    // 3. Warm dark synth bass
    const bassFreq = this.bossMode ? BASS_PATTERN_BOSS[step] : BASS_PATTERN_NORMAL[step];
    if (bassFreq > 0) {
      const bassLen = stepDuration * (this.bossMode ? 1.7 : 2.6);
      this.scheduleTone(ctx, bus, {
        type: 'triangle',
        freqStart: bassFreq,
        freqEnd: bassFreq,
        start: time,
        attack: 0.012,
        duration: bassLen,
        gain: 0.24,
        filterFreq: this.bossMode ? 320 : 240,
      });
      // Octave upper warmth for tiny mobile speakers
      this.scheduleTone(ctx, bus, {
        type: 'sine',
        freqStart: bassFreq * 2,
        freqEnd: bassFreq * 2,
        start: time,
        attack: 0.015,
        duration: bassLen * 0.8,
        gain: 0.08,
      });
    }

    // 4. Sparse glass-celesta arpeggio in D minor
    const celestaFreq = this.bossMode
      ? CELESTA_PATTERN_BOSS[step]
      : CELESTA_PATTERN_NORMAL[step];
    if (celestaFreq > 0) {
      this.scheduleTone(ctx, bus, {
        type: 'sine',
        freqStart: celestaFreq,
        freqEnd: celestaFreq,
        start: time,
        attack: 0.006,
        duration: this.bossMode ? 0.22 : 0.34,
        gain: 0.095,
      });
      this.scheduleTone(ctx, bus, {
        type: 'sine',
        freqStart: celestaFreq * 2,
        freqEnd: celestaFreq * 2,
        start: time,
        attack: 0.004,
        duration: 0.15,
        gain: 0.028,
      });
    }
  }
}
