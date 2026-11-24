import type { BossType, EnemyType, WaveConfig, WaveModifier } from '../types';
import { SeededRNG } from '../utils/rng';

export const ENDLESS_MODIFIERS: readonly WaveModifier[] = [
  {
    id: 'overclocked',
    name: 'Overclocked',
    description: 'Mechanisms surge faster (+20% Speed, +25% XP).',
    speedMult: 1.2,
    hpMult: 1.0,
    spawnMult: 1.1,
    giltMult: 1.1,
    xpMult: 1.25,
    eliteBonus: 0,
  },
  {
    id: 'rust_storm',
    name: 'Rust Storm',
    description: 'Relentless swarms (+35% Spawn Rate, -12% Enemy HP).',
    speedMult: 1.12,
    hpMult: 0.88,
    spawnMult: 1.35,
    giltMult: 1.05,
    xpMult: 1.1,
    eliteBonus: 0,
  },
  {
    id: 'magnetic_surge',
    name: 'Magnetic Surge',
    description: 'Charged ranged needles & coils (+15% Speed, +15% XP, +1 Elite).',
    speedMult: 1.15,
    hpMult: 1.05,
    spawnMult: 1.15,
    giltMult: 1.2,
    xpMult: 1.15,
    eliteBonus: 1,
  },
  {
    id: 'gilded_tide',
    name: 'Gilded Tide',
    description: '2× Gilt drops & fortified Elites (+20% HP, +2 Elites).',
    speedMult: 1.0,
    hpMult: 1.2,
    spawnMult: 1.05,
    giltMult: 2.0,
    xpMult: 1.15,
    eliteBonus: 2,
  },
  {
    id: 'twin_chime',
    name: 'Twin Chime',
    description: 'Rapid Elite reinforcements (+25% Spawn Rate, +2 Elites).',
    speedMult: 1.08,
    hpMult: 1.1,
    spawnMult: 1.25,
    giltMult: 1.35,
    xpMult: 1.2,
    eliteBonus: 2,
  },
] as const;

export function getWaveScaling(wave: number): {
  hpMult: number;
  dmgMult: number;
  speedMult: number;
  spawnMult: number;
  cycle: number;
} {
  const w = Math.max(1, Math.floor(wave));
  const cycle = Math.floor((w - 1) / 10);
  const endlessWaves = Math.max(0, w - 10);

  const hpMult = (1 + 0.19 * (w - 1)) * Math.pow(1.18, endlessWaves);
  const dmgMult = (1 + 0.1 * (w - 1)) * Math.pow(1.07, endlessWaves);
  const speedMult = Math.min(1.85, 1 + 0.025 * (w - 1));
  const spawnMult = Math.min(2.8, 1 + 0.09 * (w - 1));

  return {
    hpMult,
    dmgMult,
    speedMult,
    spawnMult,
    cycle,
  };
}

const AUTHORED_WAVES: readonly WaveConfig[] = [
  {
    wave: 1,
    duration: 22,
    spawnInterval: 0.85,
    maxEnemies: 24,
    weights: { rust_mite: 100 },
    eliteCount: 0,
    title: 'Chime I • First Tick',
  },
  {
    wave: 2,
    duration: 24,
    spawnInterval: 0.76,
    maxEnemies: 32,
    weights: { rust_mite: 72, burr_sprocket: 28 },
    eliteCount: 0,
    title: 'Chime II • Corroded Pinions',
  },
  {
    wave: 3,
    duration: 25,
    spawnInterval: 0.68,
    maxEnemies: 40,
    weights: { rust_mite: 56, burr_sprocket: 26, magnet_needle: 18 },
    eliteCount: 1,
    title: 'Chime III • Stray Magnetism',
  },
  {
    wave: 4,
    duration: 26,
    spawnInterval: 0.62,
    maxEnemies: 48,
    weights: { rust_mite: 44, burr_sprocket: 24, magnet_needle: 18, tarnish_globule: 14 },
    eliteCount: 1,
    title: 'Chime IV • Verdigris Flood',
  },
  {
    wave: 5,
    duration: 32,
    spawnInterval: 0.72,
    maxEnemies: 44,
    weights: { rust_mite: 45, burr_sprocket: 30, magnet_needle: 25 },
    eliteCount: 1,
    boss: 'grand_tourbillon',
    title: 'Chime V • The Grand Tourbillon',
  },
  {
    wave: 6,
    duration: 28,
    spawnInterval: 0.56,
    maxEnemies: 56,
    weights: {
      rust_mite: 36,
      burr_sprocket: 22,
      magnet_needle: 18,
      tarnish_globule: 14,
      pendulum_brute: 10,
    },
    eliteCount: 2,
    title: 'Chime VI • Heavy Pendulum',
  },
  {
    wave: 7,
    duration: 29,
    spawnInterval: 0.52,
    maxEnemies: 64,
    weights: {
      rust_mite: 30,
      burr_sprocket: 20,
      magnet_needle: 18,
      tarnish_globule: 14,
      pendulum_brute: 8,
      overwound_coil: 10,
    },
    eliteCount: 2,
    title: 'Chime VII • Spring Tension',
  },
  {
    wave: 8,
    duration: 30,
    spawnInterval: 0.47,
    maxEnemies: 74,
    weights: {
      rust_mite: 26,
      burr_sprocket: 20,
      magnet_needle: 18,
      tarnish_globule: 14,
      pendulum_brute: 10,
      overwound_coil: 12,
    },
    eliteCount: 2,
    title: 'Chime VIII • Gearlock Surge',
  },
  {
    wave: 9,
    duration: 32,
    spawnInterval: 0.43,
    maxEnemies: 84,
    weights: {
      rust_mite: 24,
      burr_sprocket: 18,
      magnet_needle: 18,
      tarnish_globule: 14,
      pendulum_brute: 12,
      overwound_coil: 14,
    },
    eliteCount: 3,
    title: 'Chime IX • Eleventh Hour',
  },
  {
    wave: 10,
    duration: 34,
    spawnInterval: 0.54,
    maxEnemies: 72,
    weights: {
      rust_mite: 25,
      burr_sprocket: 20,
      magnet_needle: 20,
      tarnish_globule: 13,
      pendulum_brute: 10,
      overwound_coil: 12,
    },
    eliteCount: 2,
    boss: 'mainspring_leviathan',
    title: 'Chime X • Mainspring Leviathan',
  },
];

function toRoman(num: number): string {
  const numerals: Array<[number, string]> = [
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let n = Math.max(1, Math.floor(num));
  let out = '';
  for (const [val, sym] of numerals) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

export function getWaveConfig(wave: number, rng: SeededRNG): WaveConfig {
  const w = Math.max(1, Math.floor(wave));
  if (w <= AUTHORED_WAVES.length) {
    return AUTHORED_WAVES[w - 1];
  }

  const scaling = getWaveScaling(w);
  const cycleRoman = toRoman(scaling.cycle + 1);
  const modifier = rng.pick(ENDLESS_MODIFIERS);

  let boss: BossType | undefined;
  if (w % 10 === 5) {
    boss = 'grand_tourbillon';
  } else if (w % 10 === 0) {
    boss = 'mainspring_leviathan';
  }

  const weights: Partial<Record<EnemyType, number>> = {
    rust_mite: 24,
    burr_sprocket: 18,
    magnet_needle: 18,
    tarnish_globule: 14,
    pendulum_brute: 12,
    overwound_coil: 14,
  };

  if (modifier.id === 'rust_storm') {
    weights.rust_mite = 46;
    weights.burr_sprocket = 24;
  } else if (modifier.id === 'magnetic_surge') {
    weights.magnet_needle = 32;
    weights.overwound_coil = 24;
  } else if (modifier.id === 'gilded_tide') {
    weights.pendulum_brute = 20;
    weights.tarnish_globule = 20;
  }

  const baseSpawn = boss ? 0.56 : 0.48;
  const spawnInterval = Math.max(0.18, baseSpawn / (scaling.spawnMult * modifier.spawnMult));
  const maxEnemies = Math.min(
    220,
    Math.round((78 + (w - 10) * 6) * Math.min(1.4, modifier.spawnMult)),
  );
  const duration = boss ? 36 : Math.min(36, 29 + Math.floor((w - 10) / 4));
  const eliteCount = Math.min(12, 2 + Math.floor((w - 8) / 3) + modifier.eliteBonus);

  const title =
    boss === 'grand_tourbillon'
      ? `Cycle ${cycleRoman} • Empowered Tourbillon`
      : boss === 'mainspring_leviathan'
        ? `Cycle ${cycleRoman} • Empowered Leviathan`
        : `Cycle ${cycleRoman} • Chime ${w}`;

  return {
    wave: w,
    duration,
    spawnInterval,
    maxEnemies,
    weights,
    eliteCount,
    boss,
    title,
    modifier,
  };
}
