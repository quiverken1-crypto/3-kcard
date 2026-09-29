/**
 * terrains.js — Canonical Frontline Terrain Definitions & Spatial Mechanics
 * Implements the 4 frontline terrain types (Plain, Water, Mountain, Pass),
 * dynamic zone capacities, entry rules, and troop-terrain synergies.
 * Conforms to rules_spec.md §2.1 & §6 and explorer_m1_2/analysis.md §5.
 */

// ==========================================
// 1. Terrain Types & Canonical Definitions
// ==========================================

export const TERRAIN_TYPES = Object.freeze({
  PLAIN: 'PLAIN',
  WATER: 'WATER',
  MOUNTAIN: 'MOUNTAIN',
  FOREST: 'FOREST',
  PASS: 'PASS'
});

export const TERRAINS = Object.freeze({
  PLAIN: Object.freeze({
    id: 'PLAIN',
    type: 'PLAIN',
    name: '平原',
    capacity: 3,
    description: '广阔平坦的开阔地带，标准战场。容纳上限3个单位。各兵种遵循常规机动与攻防规则。',
    effects: Object.freeze({
      waterBonus: false,
      mountainBonus: false,
      defenseBonus: 0
    })
  }),
  WATER: Object.freeze({
    id: 'WATER',
    type: 'WATER',
    name: '水域',
    capacity: 4,
    description: '水域：容纳4个单位。只有水军可以同时移动和攻击（水军如鱼得水）。',
    effects: Object.freeze({ waterBonus: true, mountainBonus: false, defenseBonus: 0 })
  }),
  FOREST: Object.freeze({
    id: 'FOREST',
    type: 'FOREST',
    name: '林地',
    capacity: 2,
    description: '林地：容纳2个单位。此处单位获得【先登】；此处单位受到的火攻伤害翻倍（埋伏一手，但是怕火）。',
    effects: Object.freeze({ waterBonus: false, mountainBonus: false, defenseBonus: 0 })
  }),
  MOUNTAIN: Object.freeze({
    id: 'MOUNTAIN',
    type: 'MOUNTAIN',
    name: '山地',
    capacity: 2,
    description: '山地：容纳2个单位。此处所有单位视为步兵，并获得【矢石】（行路艰难，但是居高临下）。',
    effects: Object.freeze({ waterBonus: false, mountainBonus: true, defenseBonus: 0 })
  }),
  PASS: Object.freeze({
    id: 'PASS',
    type: 'PASS',
    name: '险关',
    capacity: 2,
    description: '险关：容纳2个单位。此处单位获得坚阵+1，每回合最多被攻击1次（易守难攻）。',
    effects: Object.freeze({ waterBonus: false, mountainBonus: false, defenseBonus: 0 })
  })
});

/** 主城：每座主城带2张地形牌（见实体卡） */
/** 主城表：内置四家；自定义势力运行时通过 registerHqs 加入 */
export const HQ_CARDS = {
  wei: Object.freeze([
    Object.freeze({ id: 'xuchang', name: '许昌', hp: 20, terrains: ['PLAIN', 'PLAIN'] }),
    Object.freeze({ id: 'luoyang', name: '洛阳', hp: 20, terrains: ['PLAIN', 'PASS'] })
  ]),
  shu: Object.freeze([
    Object.freeze({ id: 'xinye', name: '新野', hp: 20, terrains: ['PLAIN', 'FOREST'] }),
    Object.freeze({ id: 'lingling', name: '零陵', hp: 20, terrains: ['MOUNTAIN', 'FOREST'] })
  ]),
  wu: Object.freeze([
    Object.freeze({ id: 'ruxuwu', name: '濡须坞', hp: 20, terrains: ['WATER', 'WATER'] }),
    Object.freeze({ id: 'jiangling', name: '江陵', hp: 20, terrains: ['WATER', 'PLAIN'] })
  ]),
  lb: Object.freeze([
    Object.freeze({ id: 'xiapi', name: '下邳', hp: 20, terrains: ['WATER', 'PLAIN'] }),
    Object.freeze({ id: 'puyang', name: '濮阳', hp: 20, terrains: ['PLAIN', 'PLAIN'] })
  ]),
  gsz: Object.freeze([
    Object.freeze({ id: 'yijing', name: '易京', hp: 20, terrains: ['PLAIN', 'PASS'] })
  ]),
  // 以下五家官方未公布主城，按史实与兵种推断
  ys: Object.freeze([Object.freeze({ id: 'yecheng', name: '邺城', hp: 20, terrains: ['PLAIN', 'PASS'] })]),
  hj: Object.freeze([Object.freeze({ id: 'julu', name: '巨鹿', hp: 20, terrains: ['MOUNTAIN', 'PLAIN'] })]),
  dz: Object.freeze([Object.freeze({ id: 'meiwu', name: '郿坞', hp: 20, terrains: ['PLAIN', 'PASS'] })]),
  xl: Object.freeze([Object.freeze({ id: 'wuwei', name: '武威', hp: 20, terrains: ['PLAIN', 'PLAIN'] })]),
  lbiao: Object.freeze([Object.freeze({ id: 'xiangyang', name: '襄阳', hp: 20, terrains: ['WATER', 'WATER'] })]),
  yshu: Object.freeze([Object.freeze({ id: 'shouchun', name: '寿春', hp: 20, terrains: ['PLAIN', 'WATER'] })])
};
const BUILTIN_HQ_KEYS = Object.freeze(Object.keys(HQ_CARDS));
export function registerHqs(kingdom, hqs = []) {
  if (BUILTIN_HQ_KEYS.includes(kingdom)) return;
  HQ_CARDS[kingdom] = Object.freeze(hqs.map(h => Object.freeze({ id: h.id, name: h.name, hp: 20, terrains: [...h.terrains] })));
}
export function unregisterHqs(kingdom) { if (!BUILTIN_HQ_KEYS.includes(kingdom)) delete HQ_CARDS[kingdom]; }
export function getHqCard(kingdom, hqId) {
  const list = HQ_CARDS[String(kingdom).toLowerCase()] || [];
  return list.find(h => h.id === hqId) || null;
}

/** 双方主城的4张地形洗混，随机3张置于前线，余1张备用 */
export function setupTerrainsFromHqs(hqA, hqB, randomFn = Math.random) {
  const pool = [...hqA.terrains, ...hqB.terrains].map(t => ({ ...TERRAINS[t] }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { frontline: { LEFT: pool[0], CENTER: pool[1], RIGHT: pool[2] }, reserve: pool[3] };
}


export const DEFAULT_TERRAIN_POOL = Object.freeze([
  TERRAINS.PLAIN,
  TERRAINS.WATER,
  TERRAINS.MOUNTAIN,
  TERRAINS.FOREST
]);

// ==========================================
// 2. Terrain Setup & Allocation
// ==========================================

/**
 * Shuffles the 4 canonical terrain cards and allocates 3 to frontline zones (LEFT, CENTER, RIGHT),
 * reserving the 4th card in reserve.
 * @param {Function} [randomFn=Math.random] - Seeded PRNG or random generator returning [0, 1)
 * @returns {{ frontline: { LEFT: object, CENTER: object, RIGHT: object }, reserve: object }}
 */
export function setupFrontlineTerrains(randomFn = Math.random) {
  const pool = [...DEFAULT_TERRAIN_POOL];
  // Deterministic Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return {
    frontline: {
      LEFT: { ...pool[0] },
      CENTER: { ...pool[1] },
      RIGHT: { ...pool[2] }
    },
    reserve: { ...pool[3] }
  };
}

// ==========================================
// 3. Troop Mobility & Combat Synergies
// ==========================================

/**
 * Evaluates whether a unit possesses Cavalry-level mobility (move AND attack in any order)
 * on the target terrain.
 * - Cavalry always has Cavalry mobility regardless of terrain.
 * - Navy (and units with Navy affinity, e.g. Guan Yu) gains Cavalry mobility on Water.
 * - On other terrains or Support Line (null terrain), Navy acts like Infantry (Move OR Attack).
 * @param {object|null} unit
 * @param {object|null} terrain
 * @returns {boolean}
 */
export function actsLikeCavalryOnTerrain(unit, terrain) {
  if (!unit) return false;
  const troopType = (unit.troopType || unit.troop_type || '').toUpperCase();
  if (troopType === 'CAVALRY') return true;

  const isNavy = troopType === 'NAVY' ||
    unit.cardId === 'shu_guan_yu' ||
    unit.id === 'shu_guan_yu' ||
    unit.name === '关羽' ||
    Boolean(unit.hasNavyAffinity);

  const isWater = Boolean(terrain && (terrain.type === 'WATER' || terrain.id === 'WATER'));
  return isNavy && isWater;
}

/**
 * Calculates effective action cost considering terrain modifiers.
 * e.g. 无当飞军 in Mountain receives a 1 provision discount (action cost -1, floored at 0).
 * @param {object|null} unit
 * @param {object|null} terrain
 * @returns {number}
 */
export function getEffectiveActionCost(unit, terrain) {
  if (!unit) return 0;
  let cost = unit.actionCost ?? unit.action_cost ?? 1;
  const isMountain = Boolean(terrain && (terrain.type === 'MOUNTAIN' || terrain.id === 'MOUNTAIN'));
  if (isMountain) {
    const cardId = unit.cardId || unit.id || '';
    if (
      cardId === 'shu_wu_dang_fei_jun_1' ||
      cardId === 'shu_wu_dang_fei_jun_2' ||
      cardId === 'shu_wu_dang_fei_jun' ||
      unit.name === '无当飞军'
    ) {
      cost = Math.max(0, cost - 1);
    }
  }
  return cost;
}

/**
 * Calculates effective attack power considering terrain modifiers.
 * e.g. 黄忠 in Mountain receives +2 ATK (Sniper trait).
 * @param {object|null} unit
 * @param {object|null} terrain
 * @returns {number}
 */
export function getEffectiveAtk(unit, terrain) {
  if (!unit) return 0;
  let atk = unit.atk ?? unit.attack ?? 0;
  const isMountain = Boolean(terrain && (terrain.type === 'MOUNTAIN' || terrain.id === 'MOUNTAIN'));
  if (isMountain) {
    const cardId = unit.cardId || unit.id || '';
    if (cardId === 'shu_huang_zhong' || unit.name === '黄忠') {
      atk += 2;
    }
  }
  return atk;
}

/**
 * Returns dynamic keywords list including terrain-granted traits.
 * e.g. 黄忠 in Mountain dynamically gains 【先登】 (Vanguard).
 * @param {object|null} unit
 * @param {object|null} terrain
 * @returns {string[]}
 */
export function getEffectiveKeywords(unit, terrain) {
  if (!unit) return [];
  const keywords = [...(unit.keywords || [])];
  const isMountain = Boolean(terrain && (terrain.type === 'MOUNTAIN' || terrain.id === 'MOUNTAIN'));
  if (isMountain) {
    const cardId = unit.cardId || unit.id || '';
    if (cardId === 'shu_huang_zhong' || unit.name === '黄忠') {
      if (!keywords.includes('先登')) {
        keywords.push('先登');
      }
    }
  }
  return keywords;
}

// ==========================================
// 4. Spatial Capacity & Entry Helpers
// ==========================================

/**
 * Returns the maximum unit capacity for a given terrain or zone.
 * @param {object|null} terrain
 * @returns {number}
 */
export function getZoneCapacity(terrain) {
  return terrain?.capacity ?? 3;
}

/**
 * Checks whether a frontline zone has reached its capacity.
 * @param {object} zone - Frontline zone object containing units array
 * @param {object|null} [terrain=null] - Active terrain (defaults to zone.terrain)
 * @returns {boolean}
 */
export function isZoneAtCapacity(zone, terrain = null) {
  if (!zone) return false;
  const activeTerrain = terrain || zone.terrain;
  const capacity = getZoneCapacity(activeTerrain);
  const currentUnits = Array.isArray(zone.units) ? zone.units.length : 0;
  return currentUnits >= capacity;
}

/**
 * Checks if a unit can enter a frontline zone based on exclusive occupation and capacity.
 * @param {object} unit
 * @param {object} zone
 * @param {string} playerFaction - 'WEI' or 'SHU'
 * @param {object|null} [terrain=null]
 * @returns {boolean}
 */
export function canUnitEnterZone(unit, zone, playerFaction, terrain = null) {
  if (!unit || !zone || !playerFaction) return false;
  if (Boolean(zone.occupant) && zone.occupant !== playerFaction) {
    return false; // Exclusive occupation violation
  }
  return !isZoneAtCapacity(zone, terrain);
}

export default TERRAINS;
