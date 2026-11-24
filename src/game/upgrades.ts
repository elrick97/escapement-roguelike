import {
  EVOLUTION_IDS,
  PASSIVE_IDS,
  RARITY_META,
  UPGRADES,
  WEAPON_IDS,
  WEAPON_TO_EVOLUTION,
} from '../data/upgrades';
import {
  MAX_WEAPON_SLOTS,
  type DraftChoice,
  type EvolutionId,
  type PassiveId,
  type PlayerState,
  type Rarity,
  type SaveData,
  type UpgradeDef,
  type UpgradeId,
  type WeaponId,
} from '../types';
import type { SeededRNG } from '../utils/rng';

function effectivePassiveRank(player: PlayerState, id: PassiveId): number {
  const lv = player.passives[id] ?? 0;
  if (lv <= 0) return 0;
  return lv + (player.rarityBonuses[id] ?? 0);
}

export function getWeaponRarityMult(player: PlayerState, weaponId: WeaponId): number {
  const bonus = player.rarityBonuses[weaponId] ?? 0;
  return 1 + bonus * 0.25;
}

export function getEvolutionRarityMult(player: PlayerState, evoId: EvolutionId): number {
  const bonus = player.rarityBonuses[evoId] ?? 0;
  return 1 + bonus * 0.2;
}

export function getProjectileDamageMult(player: PlayerState): number {
  const ricRank = effectivePassiveRank(player, 'ricochet_jewel');
  return 1 + 0.07 * ricRank;
}

export function getProjectileSpeedMult(player: PlayerState): number {
  const splitRank = effectivePassiveRank(player, 'split_seconds');
  return 1 + 0.06 * splitRank;
}

export function createInitialPlayerState(save: SaveData): PlayerState {
  const gildedRank = save.metaRanks.gilded_reserve ?? 0;
  const rerolls = 1 + (gildedRank >= 2 ? 1 : 0) + (gildedRank >= 4 ? 1 : 0);

  const player: PlayerState = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI * 0.5,
    wheelSpin: 0,
    radius: 16,
    hp: 100,
    maxHp: 100,
    ward: 0,
    maxWard: 0,
    wardRegenTimer: 0,
    invulnTimer: 0,
    hitFlashTimer: 0,
    xp: 0,
    xpToNext: 16,
    level: 1,
    standStillTime: 0,
    anchorActive: false,
    chronoSlowTimer: 0,
    killsSinceChrono: 0,
    damageMult: 1,
    attackSpeedMult: 1,
    critChance: 0.05,
    critMult: 1.65,
    bonusProjectiles: 0,
    moveSpeed: 205,
    magnetRadius: 92,
    xpMult: 1,
    giltMult: 1,
    knockbackMult: 1,
    areaMult: 1,
    bonusBounce: 0,
    hpRegen: 0,
    explosionPct: 0,
    anchorFireBonus: 0,
    weapons: { escapement_bolt: 1 },
    passives: {},
    evolutions: {},
    rarityBonuses: {},
    rerollsLeft: rerolls,
  };

  recomputePlayerStats(player, save);
  player.hp = player.maxHp;
  player.ward = player.maxWard;
  return player;
}

export function recomputePlayerStats(player: PlayerState, save: SaveData): void {
  const meta = save.metaRanks;
  const prevMaxHp = player.maxHp;
  const prevMaxWard = player.maxWard;

  const mainspring = effectivePassiveRank(player, 'mainspring_tension');
  const jewelCal = effectivePassiveRank(player, 'jewel_calibration');
  const splitLv = player.passives.split_seconds ?? 0;
  const splitEff = effectivePassiveRank(player, 'split_seconds');
  const lubricated = effectivePassiveRank(player, 'lubricated_pivots');
  const magnetic = effectivePassiveRank(player, 'magnetic_coils');
  const bimetallic = effectivePassiveRank(player, 'bimetallic_alloy');
  const tempered = effectivePassiveRank(player, 'tempered_glass');
  const overclock = effectivePassiveRank(player, 'overclock_capacitor');
  const ricochetLv = player.passives.ricochet_jewel ?? 0;
  const volatileLv = player.passives.volatile_spring ?? 0;
  const volatileEff = effectivePassiveRank(player, 'volatile_spring');
  const anchorEff = effectivePassiveRank(player, 'anchor_tempo');

  player.damageMult =
    1 + 0.08 * (meta.hardened_mainspring ?? 0) + 0.13 * bimetallic;

  player.attackSpeedMult =
    1 +
    0.05 * (meta.precision_escapement ?? 0) +
    0.12 * mainspring +
    0.085 * splitEff;

  player.critChance = Math.min(
    0.85,
    0.05 + 0.03 * (meta.precision_escapement ?? 0) + 0.07 * jewelCal,
  );

  player.critMult = 1.65 + 0.18 * jewelCal;

  player.bonusProjectiles =
    (splitLv >= 1 ? 1 : 0) + (splitLv >= 3 ? 1 : 0) + (splitLv >= 5 ? 1 : 0);

  player.moveSpeed =
    205 * (1 + 0.05 * (meta.jewel_bearings ?? 0) + 0.1 * lubricated);

  player.magnetRadius =
    92 + 18 * (meta.jewel_bearings ?? 0) + 42 * magnetic;

  player.xpMult = 1 + 0.08 * magnetic;
  player.giltMult = 1 + 0.15 * (meta.gilded_reserve ?? 0);
  player.knockbackMult = 1 + 0.15 * bimetallic;
  player.areaMult = 1 + 0.14 * overclock;
  player.bonusBounce = ricochetLv;
  player.hpRegen = 0.8 * tempered;

  player.explosionPct =
    volatileLv > 0 ? 0.28 + 0.14 * volatileEff : 0;

  player.anchorFireBonus = 0.14 * anchorEff;

  const newMaxHp = Math.round(
    100 + 15 * (meta.tempered_case ?? 0) + 25 * tempered,
  );
  player.maxHp = Math.max(1, newMaxHp);
  if (player.maxHp > prevMaxHp && prevMaxHp > 0) {
    player.hp = Math.min(player.maxHp, player.hp + (player.maxHp - prevMaxHp));
  } else {
    player.hp = Math.min(player.maxHp, player.hp);
  }

  const newMaxWard = Math.round(15 * anchorEff);
  player.maxWard = Math.max(0, newMaxWard);
  if (player.maxWard > prevMaxWard) {
    player.ward = Math.min(
      player.maxWard,
      player.ward + (player.maxWard - prevMaxWard),
    );
  } else {
    player.ward = Math.min(player.maxWard, player.ward);
  }
}

export function getAvailableEvolutions(player: PlayerState): EvolutionId[] {
  const available: EvolutionId[] = [];
  for (let i = 0; i < EVOLUTION_IDS.length; i++) {
    const evoId = EVOLUTION_IDS[i];
    if (player.evolutions[evoId]) continue;
    const def = UPGRADES[evoId];
    if (!def.requires) continue;
    const [reqWeapon, reqPassive] = def.requires;
    if (
      (player.weapons[reqWeapon] ?? 0) >= 3 &&
      (player.passives[reqPassive] ?? 0) >= 1
    ) {
      available.push(evoId);
    }
  }
  return available;
}

function getEquippedWeaponCount(player: PlayerState): number {
  let count = 0;
  for (let i = 0; i < WEAPON_IDS.length; i++) {
    if ((player.weapons[WEAPON_IDS[i]] ?? 0) > 0) {
      count++;
    }
  }
  return count;
}

function rollRarity(
  playerLevel: number,
  rng: SeededRNG,
  isRelicChest: boolean,
): Rarity {
  const r = rng.next();
  if (isRelicChest) {
    const gildedCut = Math.min(0.32, 0.22 + playerLevel * 0.008);
    const rubyCut = gildedCut + 0.38;
    const bluedCut = rubyCut + 0.3;
    if (r < gildedCut) return 'gilded';
    if (r < rubyCut) return 'ruby';
    if (r < bluedCut) return 'blued';
    return 'brass';
  }

  const lvBonus = Math.min(0.18, (playerLevel - 1) * 0.012);
  const gildedChance = 0.03 + lvBonus * 0.55;
  const rubyChance = 0.11 + lvBonus * 0.7;
  const bluedChance = 0.28 + lvBonus * 0.35;

  if (r < gildedChance) return 'gilded';
  if (r < gildedChance + rubyChance) return 'ruby';
  if (r < gildedChance + rubyChance + bluedChance) return 'blued';
  return 'brass';
}

function buildSynergyHint(player: PlayerState, def: UpgradeDef): string | undefined {
  if (def.category === 'evolution') {
    return 'EVOLUTION READY!';
  }

  if (!def.synergyWith) return undefined;

  if (def.category === 'weapon') {
    const weaponId = def.id as WeaponId;
    const passiveId = def.synergyWith as PassiveId;
    const passiveDef = UPGRADES[passiveId];
    const evoDef = UPGRADES[WEAPON_TO_EVOLUTION[weaponId]];
    if ((player.passives[passiveId] ?? 0) >= 1) {
      return `Synergy Active: ${passiveDef.name} → ${evoDef.name}`;
    }
    return `Pairs with ${passiveDef.name} → ${evoDef.name}`;
  }

  if (def.category === 'passive') {
    const weaponId = def.synergyWith as WeaponId;
    const weaponDef = UPGRADES[weaponId];
    const evoDef = UPGRADES[WEAPON_TO_EVOLUTION[weaponId]];
    if ((player.weapons[weaponId] ?? 0) >= 1) {
      return `Synergy Active: ${weaponDef.name} → ${evoDef.name}`;
    }
    return `Pairs with ${weaponDef.name} → ${evoDef.name}`;
  }

  return undefined;
}

function makeChoice(
  player: PlayerState,
  id: UpgradeId,
  rarity: Rarity,
): DraftChoice {
  const def = UPGRADES[id];
  const rMeta = RARITY_META[rarity];
  const isEvo = def.category === 'evolution';

  const currentLevel =
    def.category === 'weapon'
      ? (player.weapons[id as WeaponId] ?? 0)
      : def.category === 'passive'
        ? (player.passives[id as PassiveId] ?? 0)
        : player.evolutions[id as EvolutionId]
          ? 1
          : 0;

  const nextLevel = Math.min(def.maxLevel, currentLevel + 1);

  return {
    upgradeId: id,
    category: def.category,
    name: def.name,
    icon: def.icon,
    color: isEvo ? rMeta.color : def.color,
    rarity,
    rarityLabel: rMeta.label,
    rarityMult: rMeta.mult,
    currentLevel,
    nextLevel,
    description: def.levelDesc(nextLevel, rMeta.mult),
    synergyHint: buildSynergyHint(player, def),
    isEvolution: isEvo,
  };
}

export function rollDraftChoices(
  player: PlayerState,
  rng: SeededRNG,
  isRelicChest: boolean,
): DraftChoice[] {
  const choices: DraftChoice[] = [];
  const chosenIds = new Set<UpgradeId>();

  // 1. Guarantee at least 1 Mythic Evolution if available
  const availEvos = getAvailableEvolutions(player);
  if (availEvos.length > 0) {
    const pickedEvo = rng.pick(availEvos);
    choices.push(makeChoice(player, pickedEvo, 'mythic'));
    chosenIds.add(pickedEvo);
  }

  // 2. Build weighted candidate pool respecting MAX_WEAPON_SLOTS
  const weaponCount = getEquippedWeaponCount(player);
  const candidates: Array<{ id: UpgradeId; weight: number }> = [];

  for (let i = 0; i < WEAPON_IDS.length; i++) {
    const wId = WEAPON_IDS[i];
    if (chosenIds.has(wId)) continue;
    const evoId = WEAPON_TO_EVOLUTION[wId];
    if (player.evolutions[evoId]) continue;

    const lv = player.weapons[wId] ?? 0;
    const def = UPGRADES[wId];
    if (lv >= def.maxLevel) continue;
    if (lv === 0 && weaponCount >= MAX_WEAPON_SLOTS) continue;

    // Slight preference to level equipped weapons or grab a 2nd/3rd weapon early
    const weight = lv > 0 ? 1.55 : weaponCount < 3 ? 1.25 : 0.9;
    candidates.push({ id: wId, weight });
  }

  for (let i = 0; i < PASSIVE_IDS.length; i++) {
    const pId = PASSIVE_IDS[i];
    if (chosenIds.has(pId)) continue;
    const lv = player.passives[pId] ?? 0;
    const def = UPGRADES[pId];
    if (lv >= def.maxLevel) continue;

    // Slightly boost passives that complete a synergy with an equipped weapon
    let weight = lv > 0 ? 1.2 : 1.0;
    if (def.synergyWith && (player.weapons[def.synergyWith as WeaponId] ?? 0) > 0) {
      weight += 0.45;
    }
    candidates.push({ id: pId, weight });
  }

  // 3. Sample remaining distinct choices up to 3
  while (choices.length < 3 && candidates.length > 0) {
    let totalWeight = 0;
    for (let i = 0; i < candidates.length; i++) {
      totalWeight += candidates[i].weight;
    }
    let roll = rng.next() * totalWeight;
    let pickedIdx = candidates.length - 1;
    for (let i = 0; i < candidates.length; i++) {
      roll -= candidates[i].weight;
      if (roll <= 0) {
        pickedIdx = i;
        break;
      }
    }

    const picked = candidates[pickedIdx];
    candidates.splice(pickedIdx, 1);

    const rarity = rollRarity(player.level, rng, isRelicChest);
    choices.push(makeChoice(player, picked.id, rarity));
    chosenIds.add(picked.id);
  }

  return choices;
}

export function applyDraftChoice(
  player: PlayerState,
  choice: DraftChoice,
  save: SaveData,
): { evolved: boolean; evolutionId?: EvolutionId } {
  const def = UPGRADES[choice.upgradeId];
  let evolved = false;
  let evolutionId: EvolutionId | undefined;

  if (def.category === 'weapon') {
    const wId = choice.upgradeId as WeaponId;
    const cur = player.weapons[wId] ?? 0;
    player.weapons[wId] = Math.min(def.maxLevel, cur + 1);
    if (choice.rarityMult > 1) {
      player.rarityBonuses[wId] =
        (player.rarityBonuses[wId] ?? 0) + (choice.rarityMult - 1);
    }
  } else if (def.category === 'passive') {
    const pId = choice.upgradeId as PassiveId;
    const cur = player.passives[pId] ?? 0;
    player.passives[pId] = Math.min(def.maxLevel, cur + 1);
    if (choice.rarityMult > 1) {
      player.rarityBonuses[pId] =
        (player.rarityBonuses[pId] ?? 0) + (choice.rarityMult - 1);
    }
  } else if (def.category === 'evolution') {
    const eId = choice.upgradeId as EvolutionId;
    player.evolutions[eId] = true;
    evolved = true;
    evolutionId = eId;
    if (choice.rarityMult > 1) {
      player.rarityBonuses[eId] =
        (player.rarityBonuses[eId] ?? 0) + (choice.rarityMult - 1) * 0.4;
    }
    if (!save.discoveredEvolutions.includes(eId)) {
      save.discoveredEvolutions.push(eId);
    }
  }

  recomputePlayerStats(player, save);

  // Tempered Glass explicitly mends HP on selection in addition to Max HP delta
  if (choice.upgradeId === 'tempered_glass') {
    const mend = Math.round(25 * choice.rarityMult);
    player.hp = Math.min(player.maxHp, player.hp + mend);
  }

  return { evolved, evolutionId };
}
