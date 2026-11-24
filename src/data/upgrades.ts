import type {
  EvolutionId,
  PassiveId,
  Rarity,
  UpgradeDef,
  UpgradeId,
  WeaponId,
} from '../types';

export const WEAPON_IDS: readonly WeaponId[] = [
  'escapement_bolt',
  'ruby_prism',
  'tourbillon_orbit',
  'chime_hammer',
  'hairspring_arc',
  'pendulum_scythe',
] as const;

export const PASSIVE_IDS: readonly PassiveId[] = [
  'mainspring_tension',
  'jewel_calibration',
  'split_seconds',
  'lubricated_pivots',
  'magnetic_coils',
  'bimetallic_alloy',
  'tempered_glass',
  'overclock_capacitor',
  'ricochet_jewel',
  'chrono_leech',
  'volatile_spring',
  'anchor_tempo',
] as const;

export const EVOLUTION_IDS: readonly EvolutionId[] = [
  'perpetual_barrage',
  'prism_singularity',
  'celestial_orrery',
  'cataclysm_carillon',
  'tesla_chronometer',
  'eclipse_regulator',
] as const;

export const WEAPON_TO_EVOLUTION: Record<WeaponId, EvolutionId> = {
  escapement_bolt: 'perpetual_barrage',
  ruby_prism: 'prism_singularity',
  tourbillon_orbit: 'celestial_orrery',
  chime_hammer: 'cataclysm_carillon',
  hairspring_arc: 'tesla_chronometer',
  pendulum_scythe: 'eclipse_regulator',
};

export const RARITY_META: Record<
  Rarity,
  { label: string; color: string; mult: number; glow: string }
> = {
  brass: {
    label: 'Brass',
    color: '#F5C542',
    mult: 1.0,
    glow: 'rgba(245, 197, 66, 0.35)',
  },
  blued: {
    label: 'Blued Steel',
    color: '#4CC9F0',
    mult: 1.25,
    glow: 'rgba(76, 201, 240, 0.4)',
  },
  ruby: {
    label: 'Ruby',
    color: '#FF2E63',
    mult: 1.5,
    glow: 'rgba(255, 46, 99, 0.45)',
  },
  gilded: {
    label: 'Gilded',
    color: '#FFD166',
    mult: 2.0,
    glow: 'rgba(255, 209, 102, 0.55)',
  },
  mythic: {
    label: 'Mythic',
    color: '#C77DFF',
    mult: 2.5,
    glow: 'rgba(199, 125, 255, 0.65)',
  },
};

function fmtPct(value: number): string {
  return `${Math.round(value)}%`;
}

function fmtNum(value: number, decimals = 0): string {
  return decimals > 0 ? value.toFixed(decimals) : `${Math.round(value)}`;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  // =========================================================================
  // ACTIVE WEAPONS (6)
  // =========================================================================
  escapement_bolt: {
    id: 'escapement_bolt',
    name: 'Escapement Bolt',
    category: 'weapon',
    maxLevel: 5,
    icon: '⌖',
    color: '#4CC9F0',
    shortDesc: 'Rapid blued-steel pins fired at the nearest mechanism.',
    synergyWith: 'split_seconds',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum((18 + nextLevel * 5) * rarityMult);
      if (nextLevel === 1) {
        return `Fires blued-steel pins for ${dmg} DMG every 0.42s.`;
      }
      if (nextLevel === 2) {
        return `+1 Bolt per volley, ${dmg} DMG, +12% fire rate.`;
      }
      if (nextLevel === 3) {
        return `+1 Pierce, ${dmg} DMG, tighter burst cadence.`;
      }
      if (nextLevel === 4) {
        return `+1 Bolt (3 total), ${dmg} DMG, +15% projectile speed.`;
      }
      return `Max Calibration: ${dmg} DMG, +1 Pierce & hyper-cadence.`;
    },
  },

  ruby_prism: {
    id: 'ruby_prism',
    name: 'Ruby Prism',
    category: 'weapon',
    maxLevel: 5,
    icon: '◆',
    color: '#FF2E63',
    shortDesc: 'Faceted crimson shards that ricochet sharply between foes.',
    synergyWith: 'ricochet_jewel',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum((22 + nextLevel * 6) * rarityMult);
      const bounces = 2 + Math.floor(nextLevel / 2);
      if (nextLevel === 1) {
        return `Launches prism shard (${dmg} DMG) with ${bounces} ricochets.`;
      }
      if (nextLevel === 2) {
        return `${dmg} DMG and +1 Ricochet (${bounces} total).`;
      }
      if (nextLevel === 3) {
        return `+1 Prism Shard per cast, ${dmg} DMG, faster refraction.`;
      }
      if (nextLevel === 4) {
        return `${dmg} DMG, ${bounces} ricochets, +20% crit affinity.`;
      }
      return `Max Refraction: +1 Shard, ${dmg} DMG, ${bounces} ricochets.`;
    },
  },

  tourbillon_orbit: {
    id: 'tourbillon_orbit',
    name: 'Tourbillon Orbit',
    category: 'weapon',
    maxLevel: 5,
    icon: '⚙',
    color: '#F5C542',
    shortDesc: 'Spinning brass gears orbiting your core to shred swarmers.',
    synergyWith: 'overclock_capacitor',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum((14 + nextLevel * 4) * rarityMult);
      const count = 1 + nextLevel;
      if (nextLevel === 1) {
        return `Summons ${count} orbiting brass gears (${dmg} DMG/hit).`;
      }
      return `${count} Orbiting Gears, ${dmg} DMG/hit, +12% spin & knockback.`;
    },
  },

  chime_hammer: {
    id: 'chime_hammer',
    name: 'Chime Hammer',
    category: 'weapon',
    maxLevel: 5,
    icon: '◎',
    color: '#FFD166',
    shortDesc: 'Acoustic gold shockwave ring damaging and slowing crowds.',
    synergyWith: 'volatile_spring',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum((30 + nextLevel * 9) * rarityMult);
      const radius = fmtNum((125 + nextLevel * 16) * (1 + (rarityMult - 1) * 0.25));
      if (nextLevel === 1) {
        return `Strikes a ${radius}px chime ring for ${dmg} DMG & 1.5s slow.`;
      }
      return `Expands strike to ${radius}px for ${dmg} DMG & -10% cooldown.`;
    },
  },

  hairspring_arc: {
    id: 'hairspring_arc',
    name: 'Hairspring Arc',
    category: 'weapon',
    maxLevel: 5,
    icon: '⚡',
    color: '#64DFDF',
    shortDesc: 'High-voltage blued-steel lightning arcing across clusters.',
    synergyWith: 'mainspring_tension',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum((20 + nextLevel * 6) * rarityMult);
      const chains = 2 + nextLevel;
      if (nextLevel === 1) {
        return `Zaps up to ${chains} linked enemies for ${dmg} DMG.`;
      }
      return `Chains to ${chains} targets for ${dmg} DMG & faster discharge.`;
    },
  },

  pendulum_scythe: {
    id: 'pendulum_scythe',
    name: 'Pendulum Scythe',
    category: 'weapon',
    maxLevel: 5,
    icon: '☾',
    color: '#2EC4B6',
    shortDesc: 'Wide clock-hand boomerangs sweeping out and returning.',
    synergyWith: 'jewel_calibration',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum((26 + nextLevel * 7) * rarityMult);
      const blades = nextLevel >= 4 ? 3 : nextLevel >= 2 ? 2 : 1;
      if (nextLevel === 1) {
        return `Hurls ${blades} piercing clock-hand blade (${dmg} DMG each way).`;
      }
      return `Sweeps ${blades} blades for ${dmg} DMG each pass & wider arc.`;
    },
  },

  // =========================================================================
  // PASSIVE COMPLICATIONS (12)
  // =========================================================================
  mainspring_tension: {
    id: 'mainspring_tension',
    name: 'Mainspring Tension',
    category: 'passive',
    maxLevel: 5,
    icon: '⟳',
    color: '#4CC9F0',
    shortDesc: 'Tightens spring torque for faster weapon cadence.',
    synergyWith: 'hairspring_arc',
    levelDesc: (nextLevel, rarityMult) => {
      const step = 12 * rarityMult;
      const total = step * nextLevel;
      return `+${fmtPct(step)} Attack Speed (${fmtPct(total)} total).`;
    },
  },

  jewel_calibration: {
    id: 'jewel_calibration',
    name: 'Jewel Calibration',
    category: 'passive',
    maxLevel: 5,
    icon: '✦',
    color: '#FF2E63',
    shortDesc: 'Polishes bearing pivots for lethal critical strikes.',
    synergyWith: 'pendulum_scythe',
    levelDesc: (nextLevel, rarityMult) => {
      const crit = 7 * rarityMult;
      const critDmg = 18 * rarityMult;
      return `+${fmtPct(crit)} Crit Chance & +${fmtPct(critDmg)} Crit DMG (Rank ${nextLevel}).`;
    },
  },

  split_seconds: {
    id: 'split_seconds',
    name: 'Split-Seconds',
    category: 'passive',
    maxLevel: 5,
    icon: '⋮',
    color: '#72EFDD',
    shortDesc: 'Adds extra projectiles and orbital blades to Complications.',
    synergyWith: 'escapement_bolt',
    levelDesc: (nextLevel, rarityMult) => {
      const proj = nextLevel === 1 || nextLevel === 3 || nextLevel === 5 ? 1 : 0;
      const speedBonus = fmtPct(6 * rarityMult);
      return proj > 0
        ? `+1 Bonus Projectile across all weapons & +${speedBonus} Fire Rate.`
        : `+${fmtPct(12 * rarityMult)} Fire Rate & +${speedBonus} Projectile Speed.`;
    },
  },

  lubricated_pivots: {
    id: 'lubricated_pivots',
    name: 'Lubricated Pivots',
    category: 'passive',
    maxLevel: 5,
    icon: '➤',
    color: '#80ED99',
    shortDesc: 'Low-friction bearings boost wheel glide speed.',
    levelDesc: (nextLevel, rarityMult) => {
      const gain = 10 * rarityMult;
      return `+${fmtPct(gain)} Move Speed (${fmtPct(gain * nextLevel)} total) & sharper turn grip.`;
    },
  },

  magnetic_coils: {
    id: 'magnetic_coils',
    name: 'Magnetic Coils',
    category: 'passive',
    maxLevel: 5,
    icon: '🧲',
    color: '#5E60CE',
    shortDesc: 'Draws Ruby Bearings from afar and amplifies XP yield.',
    levelDesc: (nextLevel, rarityMult) => {
      const pull = fmtNum(42 * rarityMult);
      const xp = fmtPct(8 * rarityMult);
      return `+${pull}px Pickup Radius & +${xp} XP Gain (Rank ${nextLevel}).`;
    },
  },

  bimetallic_alloy: {
    id: 'bimetallic_alloy',
    name: 'Bimetallic Alloy',
    category: 'passive',
    maxLevel: 5,
    icon: '▲',
    color: '#E76F51',
    shortDesc: 'Hardened brass-steel plating increases raw impact and knockback.',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtPct(13 * rarityMult);
      const kb = fmtPct(15 * rarityMult);
      return `+${dmg} Global Damage & +${kb} Knockback (Rank ${nextLevel}).`;
    },
  },

  tempered_glass: {
    id: 'tempered_glass',
    name: 'Tempered Glass',
    category: 'passive',
    maxLevel: 5,
    icon: '✚',
    color: '#2EC4B6',
    shortDesc: 'Reinforces watch crystal with Max HP and steady repair.',
    levelDesc: (nextLevel, rarityMult) => {
      const hp = fmtNum(25 * rarityMult);
      const regen = fmtNum(0.8 * rarityMult, 1);
      return `+${hp} Max HP, +${regen} HP/s Regen & heals +${hp} HP (Rank ${nextLevel}).`;
    },
  },

  overclock_capacitor: {
    id: 'overclock_capacitor',
    name: 'Overclock Capacitor',
    category: 'passive',
    maxLevel: 5,
    icon: '◉',
    color: '#F5C542',
    shortDesc: 'Expands shockwaves, orbit radii, and projectile hitboxes.',
    synergyWith: 'tourbillon_orbit',
    levelDesc: (nextLevel, rarityMult) => {
      const area = fmtPct(14 * rarityMult);
      return `+${area} Complication Area & Size (${fmtPct(14 * rarityMult * nextLevel)} total).`;
    },
  },

  ricochet_jewel: {
    id: 'ricochet_jewel',
    name: 'Ricochet Jewel',
    category: 'passive',
    maxLevel: 5,
    icon: '❖',
    color: '#FF4D6D',
    shortDesc: 'Sharpens jewel facets to add bounces and target penetration.',
    synergyWith: 'ruby_prism',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtPct(7 * rarityMult);
      return `+1 Bounce & Pierce (Rank ${nextLevel}) plus +${dmg} Projectile DMG.`;
    },
  },

  chrono_leech: {
    id: 'chrono_leech',
    name: 'Chrono Leech',
    category: 'passive',
    maxLevel: 5,
    icon: '⌛',
    color: '#9D4EDD',
    shortDesc: 'Siphons time on kill streaks to slow enemies and mend hull.',
    levelDesc: (nextLevel, rarityMult) => {
      const heal = fmtNum((2 + nextLevel) * rarityMult);
      const threshold = Math.max(8, 22 - nextLevel * 3);
      return `Every ${threshold} kills: 2.5s Chrono Slow pulse & +${heal} HP mend.`;
    },
  },

  volatile_spring: {
    id: 'volatile_spring',
    name: 'Volatile Spring',
    category: 'passive',
    maxLevel: 5,
    icon: '✹',
    color: '#FF9F1C',
    shortDesc: 'Defeated mechanisms detonate in brass shrapnel bursts.',
    synergyWith: 'chime_hammer',
    levelDesc: (nextLevel, rarityMult) => {
      const pct = fmtPct((28 + nextLevel * 14) * rarityMult);
      return `Kills explode in 78px brass blasts dealing ${pct} of enemy Max HP.`;
    },
  },

  anchor_tempo: {
    id: 'anchor_tempo',
    name: 'Anchor Tempo',
    category: 'passive',
    maxLevel: 5,
    icon: '⚓',
    color: '#FFD166',
    shortDesc: 'Standing still empowers Anchor Fire Rate and brass Ward shield.',
    levelDesc: (nextLevel, rarityMult) => {
      const rate = fmtPct(14 * rarityMult);
      const ward = fmtNum(15 * rarityMult);
      return `While anchored: +${rate} Fire Rate & +${ward} Max Brass Ward (Rank ${nextLevel}).`;
    },
  },

  // =========================================================================
  // GRAND COMPLICATION EVOLUTIONS (6)
  // =========================================================================
  perpetual_barrage: {
    id: 'perpetual_barrage',
    name: 'Perpetual Barrage',
    category: 'evolution',
    maxLevel: 1,
    icon: '✺',
    color: '#FFD166',
    shortDesc: '5-stream gilded gatling fan with explosive impact tips.',
    synergyWith: 'escapement_bolt',
    requires: ['escapement_bolt', 'split_seconds'],
    replacesWeapon: 'escapement_bolt',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum(34 * rarityMult * nextLevel);
      return `EVOLUTION: Fires a 5-stream gilded fan (${dmg} DMG/bolt) with 48px blast tips.`;
    },
  },

  prism_singularity: {
    id: 'prism_singularity',
    name: 'Prism Singularity',
    category: 'evolution',
    maxLevel: 1,
    icon: '✧',
    color: '#FF2E63',
    shortDesc: 'Shards fracture into twin mini-prisms on every ricochet.',
    synergyWith: 'ruby_prism',
    requires: ['ruby_prism', 'ricochet_jewel'],
    replacesWeapon: 'ruby_prism',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum(48 * rarityMult * nextLevel);
      return `EVOLUTION: Hyper-prisms (${dmg} DMG) split into 2 seeker shards per bounce.`;
    },
  },

  celestial_orrery: {
    id: 'celestial_orrery',
    name: 'Celestial Orrery',
    category: 'evolution',
    maxLevel: 1,
    icon: '❂',
    color: '#F5C542',
    shortDesc: 'Twin counter-rotating planetary brass rings vaporize darts.',
    synergyWith: 'tourbillon_orbit',
    requires: ['tourbillon_orbit', 'overclock_capacitor'],
    replacesWeapon: 'tourbillon_orbit',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum(38 * rarityMult * nextLevel);
      return `EVOLUTION: 8 planetary saws (${dmg} DMG) shred enemy darts & emit radial sparks.`;
    },
  },

  cataclysm_carillon: {
    id: 'cataclysm_carillon',
    name: 'Cataclysm Carillon',
    category: 'evolution',
    maxLevel: 1,
    icon: '🔔',
    color: '#FF9F1C',
    shortDesc: 'Triple cascading golden bell rings triggering chain blasts.',
    synergyWith: 'chime_hammer',
    requires: ['chime_hammer', 'volatile_spring'],
    replacesWeapon: 'chime_hammer',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum(82 * rarityMult * nextLevel);
      return `EVOLUTION: Unleashes 3 surging golden chimes (${dmg} DMG) that chain-detonate kills.`;
    },
  },

  tesla_chronometer: {
    id: 'tesla_chronometer',
    name: 'Tesla Chronometer',
    category: 'evolution',
    maxLevel: 1,
    icon: '☍',
    color: '#4CC9F0',
    shortDesc: 'Rapid 10-target guaranteed-crit lightning web with stun.',
    synergyWith: 'hairspring_arc',
    requires: ['hairspring_arc', 'mainspring_tension'],
    replacesWeapon: 'hairspring_arc',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum(46 * rarityMult * nextLevel);
      return `EVOLUTION: 10-target guaranteed-crit arc web (${dmg} DMG) with 0.35s micro-stun.`;
    },
  },

  eclipse_regulator: {
    id: 'eclipse_regulator',
    name: 'Eclipse Regulator',
    category: 'evolution',
    maxLevel: 1,
    icon: '◑',
    color: '#C77DFF',
    shortDesc: '360° obsidian-and-gold twin clock-hand eclipses with burn wakes.',
    synergyWith: 'pendulum_scythe',
    requires: ['pendulum_scythe', 'jewel_calibration'],
    replacesWeapon: 'pendulum_scythe',
    levelDesc: (nextLevel, rarityMult) => {
      const dmg = fmtNum(58 * rarityMult * nextLevel);
      return `EVOLUTION: 4 sweeping eclipse scythes (${dmg} DMG) infusing targets with solar burn.`;
    },
  },
};

export function getUpgradeDef(id: UpgradeId): UpgradeDef {
  return UPGRADES[id];
}
