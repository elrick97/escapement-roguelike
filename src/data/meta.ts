import type { MetaUpgradeDef } from '../types';

export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  {
    id: 'hardened_mainspring',
    name: 'Hardened Mainspring',
    description: 'Permanently increases all Complication damage output.',
    icon: '▲',
    maxRank: 5,
    baseCost: 25,
    costStep: 25,
    effectPerRank: '+8% Global Damage',
  },
  {
    id: 'tempered_case',
    name: 'Tempered Case',
    description: 'Reinforces your Balance Wheel frame with extra Max HP.',
    icon: '✚',
    maxRank: 5,
    baseCost: 20,
    costStep: 20,
    effectPerRank: '+15 Max HP',
  },
  {
    id: 'jewel_bearings',
    name: 'Jewel Bearings',
    description: 'Reduces friction for faster glide speed and wider Ruby pickup pull.',
    icon: '◆',
    maxRank: 5,
    baseCost: 25,
    costStep: 25,
    effectPerRank: '+5% Move Speed & +18px Magnet',
  },
  {
    id: 'precision_escapement',
    name: 'Precision Escapement',
    description: 'Tunes escapement teeth for sharper cadence and critical strikes.',
    icon: '⌖',
    maxRank: 5,
    baseCost: 30,
    costStep: 30,
    effectPerRank: '+5% Fire Rate & +3% Crit Chance',
  },
  {
    id: 'gilded_reserve',
    name: 'Gilded Reserve',
    description: 'Boosts Gilt filings harvested and grants bonus Draft Rerolls.',
    icon: '⚙',
    maxRank: 4,
    baseCost: 35,
    costStep: 35,
    effectPerRank: '+15% Gilt Gain (+1 Reroll at Ranks 2 & 4)',
  },
  {
    id: 'calibrated_start',
    name: 'Calibrated Start',
    description: 'Begin every run with a bonus Lv-1 Passive Complication bolted on.',
    icon: '✦',
    maxRank: 2,
    baseCost: 60,
    costStep: 90,
    effectPerRank: '+1 Starting Passive Complication',
  },
] as const;

export function getMetaUpgradeCost(def: MetaUpgradeDef, currentRank: number): number {
  const rank = Math.max(0, Math.floor(currentRank));
  return def.baseCost + def.costStep * rank;
}
