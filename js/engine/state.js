/**
 * state.js — Authoritative Game State Engine, Lifecycle & Resource Management
 * Conforms to rules_spec.md, tech_architecture.md, and testHarness.js.
 */

import {
  FACTIONS,
  TROOP_TYPES,
  PHASES,
  TERRAINS,
  GAME_CONFIG,
  STATUS_TYPES,
  hasKeyword
} from './constants.js';
import { PRNG } from './prng.js';
import { setupFrontlineTerrains, HQ_CARDS, getHqCard, setupTerrainsFromHqs } from '../data/terrains.js';
import { instantiateDeck } from '../data/decks.js';
import { DB_DECKS } from '../data/cardDB.js';
import { CARD_MAP } from '../data/cards.js';

let instanceCounter = 1;

// 回合钩子（由 cardSkills.js 注册，避免循环依赖）
const turnHooks = { beforeRefill: null, afterRefill: null, onTurnEnd: null, onDraw: null };
export function registerTurnHooks(hooks = {}) {
  Object.assign(turnHooks, hooks);
}

/**
 * Resets the instance counter (useful for deterministic test isolation).
 */
export function resetInstanceCounter() {
  instanceCounter = 1;
}

/**
 * Creates a unique runtime card instance from a card definition.
 * Supports both createCard and createCardInstance names.
 * @param {object} def
 * @param {object} [overrides={}]
 * @returns {object}
 */
export function createCard(def = {}, overrides = {}) {
  const id = overrides.instanceId || `inst_${instanceCounter++}`;
  const rawCost = def.cost ?? 1;
  const rawActionCost = def.actionCost ?? def.action_cost ?? 1;
  const rawAtk = def.atk ?? def.attack ?? 1;
  const rawHp = def.hp ?? 1;
  const rawMaxHp = def.maxHp ?? def.max_hp ?? rawHp;

  const rawTroop = (def.troopType || def.troop_type || 'INFANTRY').toUpperCase();
  const troopType = rawTroop === 'ARCHER_SIEGE' ? 'ARCHER' : (TROOP_TYPES[rawTroop] || TROOP_TYPES.INFANTRY);

  const rawType = (def.type || 'UNIT').toUpperCase();
  const type = rawType === 'DEFECTOR' ? 'UNIT' : (rawType === 'TACTIC' ? 'TACTIC' : (rawType === 'COUNTER' ? 'COUNTER' : 'UNIT'));

  const rawFaction = (def.faction || def.kingdom || FACTIONS.WEI).toUpperCase();
  const faction = rawFaction === 'SHU' ? FACTIONS.SHU : FACTIONS.WEI;

  return {
    instanceId: id,
    cardId: def.cardId || def.id || id,
    name: def.name || '无名卡牌',
    faction,
    type,
    troopType,
    cost: rawCost,
    actionCost: rawActionCost,
    atk: rawAtk,
    baseAtk: rawAtk,
    hp: rawHp,
    maxHp: rawMaxHp,
    baseMaxHp: rawMaxHp,
    keywords: Array.isArray(def.keywords) ? [...def.keywords] : [],
    baseKeywords: Array.isArray(def.keywords) ? [...def.keywords] : [],
    baseActionCost: rawActionCost,
    badges: Array.isArray(def.badges) ? [...def.badges] : [],
    status: {
      [STATUS_TYPES.SUPPRESSED]: false,
      suppressedTurnsLeft: 0,
      [STATUS_TYPES.INHIBITED]: false,
      [STATUS_TYPES.IS_FACE_DOWN]: false,
      [STATUS_TYPES.BUFFED_AFTER_INHIBIT]: false,
      [STATUS_TYPES.ACTIONS_USED]: 0,
      [STATUS_TYPES.MOVED_THIS_TURN]: false,
      [STATUS_TYPES.ATTACKED_THIS_TURN]: false,
      [STATUS_TYPES.AMBUSH_USED_THIS_TURN]: false,
      [STATUS_TYPES.CHARGE_USED]: false,
      [STATUS_TYPES.DEPLOYED_THIS_TURN]: false,
      [STATUS_TYPES.DAMAGED]: false,
      attacksThisTurn: 0
    },
    _grantedExtraGranary: false,
    skill: def.skill ? { ...def.skill } : null,
    audioCue: def.audioCue || 'auto',
    abilities: Array.isArray(def.abilities) ? structuredClone(def.abilities) : [],
    ...(def.pending ? { pending: true } : {}),
    ...(def.art ? { art: def.art } : {}),
    onDeploy: def.onDeploy || null,
    onKill: def.onKill || null,
    onDeath: def.onDeath || null,
    ...overrides
  };
}

export const createCardInstance = createCard;

/** 按势力（wei/shu/wu/lb）生成卡组；seat 为对局座位（WEI/SHU），卡牌归属于座位 */
export function createKingdomDeck(kingdom, seat) {
  // 自定义势力没有标准卡组：返回空（卡牌由玩家卡组提供）
  if (kingdom && !DB_DECKS[kingdom] && !['WEI', 'SHU'].includes(String(kingdom).toUpperCase())) return { mainDeck: [], reservePool: [] };
  const deck = DB_DECKS[kingdom] || DB_DECKS.wei;
  const inst = instantiateDeck({ main: deck.main, reserve: deck.reserve }, CARD_MAP, def => createCard(def, { faction: seat, kingdom: def.kingdom || kingdom }));
  return inst;
}

export function createWeiDeck() { return createKingdomDeck('wei', FACTIONS.WEI).mainDeck; }
export function createShuDeck() { return createKingdomDeck('shu', FACTIONS.SHU).mainDeck; }
export function createReservePool(faction) { return createKingdomDeck(faction === FACTIONS.SHU ? 'shu' : 'wei', faction).reservePool; }

/**
 * Creates Initial Game State
 * @param {object} [options={}]
 * @returns {object}
 */
export function createInitialState(options = {}) {
  const seed = options.seed ?? 12345;
  const prng = options.prng instanceof PRNG ? options.prng : new PRNG(seed);

  const p1Faction = options.firstPlayer || FACTIONS.WEI;
  const p2Faction = p1Faction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;

  // Determine HQ HP (default to 20 for backward compatibility with existing tests; allows override)
  const initialHp = options.initialHp ?? options.weiHp ?? GAME_CONFIG.COMPAT_HQ_HP;
  const weiHp = options.weiHp ?? initialHp;
  const shuHp = options.shuHp ?? initialHp;

  // Setup terrains: default canonical layout (PLAIN, WATER, MOUNTAIN; FOREST in reserve),
  // with deterministic PRNG shuffle support when requested
  let frontlineTerrains = {
    LEFT: { ...TERRAINS.PLAIN },
    CENTER: { ...TERRAINS.WATER },
    RIGHT: { ...TERRAINS.MOUNTAIN }
  };
  let reserveTerrain = { ...TERRAINS.FOREST };
  const kingdoms = { [FACTIONS.WEI]: options.weiKingdom || 'wei', [FACTIONS.SHU]: options.shuKingdom || 'shu' };
  const builtDecks = {
    [FACTIONS.WEI]: options.weiDeck ? null : createKingdomDeck(kingdoms.WEI, FACTIONS.WEI),
    [FACTIONS.SHU]: options.shuDeck ? null : createKingdomDeck(kingdoms.SHU, FACTIONS.SHU)
  };
  // 主城：可指定 id，或 'RANDOM'；未指定时取各势力第一座主城
  const pickHq = (faction, wanted) => {
    const list = HQ_CARDS[kingdoms[faction]] || HQ_CARDS[faction];
    if (wanted === 'RANDOM') return list[Math.floor(prng.next() * list.length)];
    return list.find(h => h.id === wanted) || list[0];
  };
  const hqs = { [FACTIONS.WEI]: pickHq(FACTIONS.WEI, options.weiHq), [FACTIONS.SHU]: pickHq(FACTIONS.SHU, options.shuHq) };
  if (options.randomTerrains || options.shuffleTerrains) {
    try {
      const allocated = setupTerrainsFromHqs(hqs.WEI, hqs.SHU, () => prng.next());
      frontlineTerrains = allocated.frontline;
      reserveTerrain = allocated.reserve;
    } catch (_) {}
  }

  const state = {
    matchId: options.matchId || `match_${Date.now()}`,
    seed,
    prng,
    shuffleDecks: options.shuffleDecks === true,
    turnNumber: 1,
    activePlayer: p1Faction,
    firstPlayer: p1Faction,
    phase: options.phase || PHASES.SETUP,
    winner: null,
    firstTurnDrawSkip: true,

    players: {
      [FACTIONS.WEI]: {
        id: FACTIONS.WEI,
        hp: weiHp,
        maxHp: weiHp,
        provisions: 0,
        provisionsCap: 0,
        mainGranaryCap: 0,
        extraGranaryCap: 0,
        prestige: 0,
        prestigeDiscountUsed: false,
        hand: [],
        kingdom: kingdoms.WEI,
        deck: options.weiDeck ? [...options.weiDeck] : builtDecks.WEI.mainDeck,
        discard: [],
        reserve: options.weiReserve ? [...options.weiReserve] : (builtDecks.WEI ? builtDecks.WEI.reservePool : []),
        pendingCapGain: 0,
        provisionPenalty: 0,
        fatigueCount: 0
      },
      [FACTIONS.SHU]: {
        id: FACTIONS.SHU,
        hp: shuHp,
        maxHp: shuHp,
        provisions: 0,
        provisionsCap: 0,
        mainGranaryCap: 0,
        extraGranaryCap: 0,
        prestige: 0,
        prestigeDiscountUsed: false,
        hand: [],
        kingdom: kingdoms.SHU,
        deck: options.shuDeck ? [...options.shuDeck] : builtDecks.SHU.mainDeck,
        discard: [],
        reserve: options.shuReserve ? [...options.shuReserve] : (builtDecks.SHU ? builtDecks.SHU.reservePool : []),
        pendingCapGain: 0,
        provisionPenalty: 0,
        fatigueCount: 0
      }
    },

    battlefield: {
      support: {
        [FACTIONS.WEI]: {
          hq: { id: 'hq_wei', hqId: hqs.WEI.id, name: hqs.WEI.name, terrains: [...hqs.WEI.terrains], hp: weiHp, maxHp: weiHp },
          slots: [] // Max 4 units
        },
        [FACTIONS.SHU]: {
          hq: { id: 'hq_shu', hqId: hqs.SHU.id, name: hqs.SHU.name, terrains: [...hqs.SHU.terrains], hp: shuHp, maxHp: shuHp },
          slots: [] // Max 4 units
        }
      },
      frontline: {
        LEFT: {
          zone: 'LEFT',
          occupant: null,
          terrain: frontlineTerrains.LEFT,
          capacity: frontlineTerrains.LEFT.capacity || 3,
          units: []
        },
        CENTER: {
          zone: 'CENTER',
          occupant: null,
          terrain: frontlineTerrains.CENTER,
          capacity: frontlineTerrains.CENTER.capacity || 3,
          units: []
        },
        RIGHT: {
          zone: 'RIGHT',
          occupant: null,
          terrain: frontlineTerrains.RIGHT,
          capacity: frontlineTerrains.RIGHT.capacity || 2,
          units: []
        }
      },
      reserveTerrain
    },

    activeCounters: [],
    pendingDeaths: [],
    turnEffects: { [FACTIONS.WEI]: {}, [FACTIONS.SHU]: {} },
    combatLog: []
  };

  return state;
}

/**
 * Initializes decks and executes opening hands: P1 draws 4, P2 draws 5.
 * @param {object} state
 * @returns {object}
 */
export function setupGame(state) {
  state.phase = PHASES.SETUP;
  const p1 = state.players[state.firstPlayer];
  const p2 = state.players[state.firstPlayer === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI];

  // Real matches opt in to shuffling; explicit seeds keep replays reproducible.
  if (state.shuffleDecks && state.prng && typeof state.prng.shuffleArray === 'function') {
    state.prng.shuffleArray(p1.deck);
    state.prng.shuffleArray(p2.deck);
  }

  // Draw initial hands: P1 draws 4, P2 draws 5
  for (let i = 0; i < GAME_CONFIG.FIRST_PLAYER_START_HAND; i++) {
    if (p1.deck.length > 0) p1.hand.push(p1.deck.shift());
  }
  for (let i = 0; i < GAME_CONFIG.SECOND_PLAYER_START_HAND; i++) {
    if (p2.deck.length > 0) p2.hand.push(p2.deck.shift());
  }

  state.phase = PHASES.MULLIGAN;
  return state;
}

/**
 * Executes a mulligan for a player.
 * @param {object} state
 * @param {string} playerId
 * @param {number[]} cardIndicesToReturn
 */
export function executeMulligan(state, playerId, cardIndicesToReturn = []) {
  const player = state.players[playerId];
  if (!player || !Array.isArray(cardIndicesToReturn) || cardIndicesToReturn.length === 0) return;

  // Filter valid indices within [0, player.hand.length - 1] and deduplicate
  const validIndices = [...new Set(cardIndicesToReturn)]
    .filter(idx => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < player.hand.length);

  if (validIndices.length === 0) return;

  const redrawCount = validIndices.length;
  const indicesSet = new Set(validIndices);
  const remainingHand = [];
  const returnedCards = [];

  player.hand.forEach((card, idx) => {
    if (indicesSet.has(idx)) {
      returnedCards.push(card);
    } else {
      remainingHand.push(card);
    }
  });

  player.hand = remainingHand;
  player.deck.push(...returnedCards);

  // Reshuffle deck using deterministic PRNG if present
  if (state.prng && typeof state.prng.shuffleArray === 'function') {
    state.prng.shuffleArray(player.deck);
  }

  for (let i = 0; i < redrawCount; i++) {
    if (player.deck.length > 0) {
      player.hand.push(player.deck.shift());
    }
  }
}

/**
 * Draws a card for a player with hand cap 9 overflow burn and empty deck fatigue damage.
 * @param {object} state
 * @param {string} playerId
 * @returns {object|null}
 */
export function drawCard(state, playerId) {
  const player = state.players[playerId];
  if (!player) return null;

  // Empty deck: Fatigue damage scaling (N-th overdraw deals N damage)
  if (player.deck.length === 0) {
    player.fatigueCount += 1;
    const dmg = player.fatigueCount;
    player.hp -= dmg;
    if (state.battlefield.support[playerId]?.hq) {
      state.battlefield.support[playerId].hq.hp = Math.max(0, player.hp);
    }
    state.combatLog.push({ type: 'FATIGUE', playerId, damage: dmg, count: player.fatigueCount });

    if (player.hp <= 0) {
      player.hp = 0;
      state.winner = (playerId === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI);
      state.phase = PHASES.GAME_OVER;
    }
    return null;
  }

  const drawn = player.deck.shift();

  // Hand Cap 9: Overflow Burn
  if (player.hand.length >= GAME_CONFIG.HAND_LIMIT) {
    player.discard.push(drawn);
    state.combatLog.push({ type: 'CARD_BURNED', playerId, card: drawn });
    return drawn;
  }

  player.hand.push(drawn);
  state.combatLog.push({ type: 'CARD_DRAWN', playerId, card: drawn });
  if (turnHooks.onDraw) turnHooks.onDraw(state, playerId);
  return drawn;
}

/**
 * Starts a player's turn: increments natural granary, refills provisions,
 * checks turn-start keywords (聚众), skips Turn 1 P1 draw or draws card.
 * @param {object} state
 * @param {string} playerId
 * @returns {object}
 */
export function startTurn(state, playerId) {
  state.activePlayer = playerId;
  state.phase = PHASES.TURN_START;
  const player = state.players[playerId];

  // 1. Double Granary: Increase natural main granary (0 -> 10 max)
  if (player.mainGranaryCap < GAME_CONFIG.MAX_MAIN_GRANARY) {
    player.mainGranaryCap += 1;
  }
  if (turnHooks.beforeRefill) turnHooks.beforeRefill(state, playerId);
  player.provisionsCap = player.mainGranaryCap + player.extraGranaryCap;
  player.provisions = player.provisionsCap; // Full refill!

  // 2. Reset prestige discount flag
  player.prestigeDiscountUsed = false;

  // 3. Reset units on board
  const allPlayerUnits = getAllUnits(state, playerId);
  for (const unit of allPlayerUnits) {
    unit.status.actionsUsed = 0;
    unit.status.movedThisTurn = false;
    unit.status.attackedThisTurn = false;
    unit.status.ambushUsedThisTurn = false;
    unit.status[STATUS_TYPES.DEPLOYED_THIS_TURN] = false;
    unit.status.attacksThisTurn = 0;

    // 聚众 (Gathering) check: if undamaged, gain +1/+1
    if (hasKeyword(unit, '聚众') && !unit.status.damaged) {
      unit.atk += 1;
      unit.hp += 1;
      unit.maxHp += 1;
      state.combatLog.push({ type: 'JU_ZHONG_BUFF', unitId: unit.instanceId, name: unit.name, newAtk: unit.atk, newHp: unit.hp });
    }
  }

  state.combatLog.push({ type: 'TURN_STARTED', turnNumber: state.turnNumber, activePlayer: playerId, provisions: player.provisions, prestige: player.prestige });
  if (turnHooks.afterRefill) turnHooks.afterRefill(state, playerId);
  if (state.phase === PHASES.GAME_OVER) return state;

  // 4. Draw Phase
  state.phase = PHASES.DRAW;
  // Rule: 1st player on turn 1 skips draw
  if (state.turnNumber === 1 && playerId === state.firstPlayer) {
    state.combatLog.push({ type: 'DRAW_SKIPPED', playerId, reason: 'P1 Turn 1 skip' });
  } else {
    drawCard(state, playerId);
  }

  if (state.phase !== PHASES.GAME_OVER) {
    state.phase = PHASES.ACTION;
  }
  return state;
}

/**
 * Concludes active player's turn, decrements/clears suppression status,
 * advances turn counter, and switches active player.
 * @param {object} state
 * @returns {object}
 */
export function endTurn(state) {
  state.phase = PHASES.TURN_END;
  const currentActive = state.activePlayer;
  if (turnHooks.onTurnEnd) turnHooks.onTurnEnd(state, currentActive);
  if (state.phase === PHASES.GAME_OVER) return state;
  state.phase = PHASES.TURN_END;

  // Suppression status decrements/clears
  const allUnits = getAllUnits(state, currentActive);
  for (const unit of allUnits) {
    if (unit.status.suppressed) {
      unit.status.suppressedTurnsLeft -= 1;
      if (unit.status.suppressedTurnsLeft <= 0) {
        unit.status.suppressed = false;
      }
    }
    unit.status.ambushUsedThisTurn = false;
  }

  // Switch player and advance turn
  const nextPlayer = currentActive === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  state.turnNumber += 1;
  startTurn(state, nextPlayer);
  return state;
}

/**
 * Adjusts prestige according to dynamic theft / depletion logic.
 * @param {object} state
 * @param {string} gainingPlayerId
 * @param {number} [amount=1]
 */
export function adjustPrestige(state, gainingPlayerId, amount = 1) {
  const gainer = state.players[gainingPlayerId];
  const opponentId = gainingPlayerId === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const opponent = state.players[opponentId];

  for (let i = 0; i < amount; i++) {
    if (opponent.prestige > 0) {
      opponent.prestige -= 1; // Steal: deduct opponent
    } else {
      gainer.prestige = Math.min(GAME_CONFIG.MAX_PRESTIGE, gainer.prestige + 1); // Add to self (capped at 2)
    }
  }

  state.combatLog.push({
    type: 'PRESTIGE_ADJUSTED',
    gainer: gainingPlayerId,
    amount,
    gainerPrestige: gainer.prestige,
    opponentPrestige: opponent.prestige
  });
}

/**
 * Returns all units belonging to a player across all battlefield zones.
 * @param {object} state
 * @param {string} playerId
 * @returns {object[]}
 */
export function getAllUnits(state, playerId) {
  const units = [];
  const supportSlots = state.battlefield.support[playerId]?.slots || [];
  units.push(...supportSlots);

  for (const zoneKey of ['LEFT', 'CENTER', 'RIGHT']) {
    const zone = state.battlefield.frontline[zoneKey];
    if (zone && zone.occupant === playerId) {
      units.push(...zone.units);
    }
  }
  return units;
}

/**
 * Locates a unit on the battlefield by its instanceId.
 * @param {object} state
 * @param {string} unitInstanceId
 * @returns {object|null}
 */
export function findUnit(state, unitInstanceId) {
  for (const faction of [FACTIONS.WEI, FACTIONS.SHU]) {
    const supportSlots = state.battlefield.support[faction].slots;
    const idx = supportSlots.findIndex(u => u.instanceId === unitInstanceId);
    if (idx !== -1) {
      return { unit: supportSlots[idx], zoneType: 'SUPPORT', faction, slotIndex: idx };
    }
  }

  for (const zoneKey of ['LEFT', 'CENTER', 'RIGHT']) {
    const zone = state.battlefield.frontline[zoneKey];
    const idx = zone.units.findIndex(u => u.instanceId === unitInstanceId);
    if (idx !== -1) {
      return { unit: zone.units[idx], zoneType: 'FRONTLINE', zoneKey, occupant: zone.occupant, slotIndex: idx };
    }
  }
  return null;
}

/**
 * Removes a unit from the battlefield, handling 补给 capacity reduction and 降将 defector discard routing.
 * @param {object} state
 * @param {string} unitInstanceId
 * @param {boolean} [isBanish=false]
 * @returns {object|null}
 */
export function removeUnitFromBoard(state, unitInstanceId, isBanish = false, opts = {}) {
  const loc = findUnit(state, unitInstanceId);
  if (!loc) return null;

  let removedUnit = null;
  if (loc.zoneType === 'SUPPORT') {
    removedUnit = state.battlefield.support[loc.faction].slots.splice(loc.slotIndex, 1)[0];
  } else {
    const zone = state.battlefield.frontline[loc.zoneKey];
    removedUnit = zone.units.splice(loc.slotIndex, 1)[0];
    if (zone.units.length === 0) {
      zone.occupant = null; // Zone liberated!
    }
  }

  // Handle 补给 (Supply) provision capacity reduction on departure
  if (removedUnit && (hasKeyword(removedUnit, '补给') || removedUnit._grantedExtraGranary)) {
    const owner = state.players[removedUnit.faction];
    if (owner && owner.extraGranaryCap > 0) {
      owner.extraGranaryCap -= 1;
      owner.provisionsCap = owner.mainGranaryCap + owner.extraGranaryCap;
      owner.provisions = Math.min(owner.provisions, owner.provisionsCap);
    }
    removedUnit._grantedExtraGranary = false;
  }

  // 离场队列：供 cardSkills.processDeaths 结算亡计 / 归心 / 迟误
  if (removedUnit && !opts.silent) {
    (state.pendingDeaths ||= []).push({ unit: removedUnit, owner: removedUnit.faction, banish: Boolean(isBanish) });
  }

  // 降将 (Defector): defeated unit goes to opponent's discard
  if (!isBanish && removedUnit && !opts.silent) {
    const owner = state.players[removedUnit.faction];
    if (hasKeyword(removedUnit, '降将')) {
      const oppFaction = removedUnit.faction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
      state.players[oppFaction].discard.push(removedUnit);
    } else {
      owner.discard.push(removedUnit);
    }
  }
  return removedUnit;
}

/**
 * Serializes the complete game state into a JSON string.
 * @param {object} state
 * @returns {string}
 */
export function serializeState(state) {
  const payload = {
    ...state,
    prngState: state.prng ? state.prng.getState() : null
  };
  delete payload.prng;
  return JSON.stringify(payload);
}

/**
 * Deserializes state from a JSON string or POJO.
 * @param {string|object} serialized
 * @returns {object}
 */
export function deserializeState(serialized) {
  const data = typeof serialized === 'string' ? JSON.parse(serialized) : JSON.parse(JSON.stringify(serialized));
  if (data.prngState) {
    const prng = new PRNG(data.prngState.initialSeed || data.seed || 12345);
    prng.setState(data.prngState);
    data.prng = prng;
    delete data.prngState;
  }
  return data;
}

/**
 * Deep clones state for lookahead MCTS and AI simulation.
 * @param {object} state
 * @returns {object}
 */
export function cloneState(state) {
  const clonedPrng = state.prng ? state.prng.clone() : null;
  const cloned = JSON.parse(JSON.stringify(state));
  if (clonedPrng) {
    cloned.prng = clonedPrng;
  }
  return cloned;
}

/**
 * Masks hidden secret information for WebRTC client transmission.
 * @param {object} masterState
 * @param {string} clientFaction
 * @returns {object}
 */
export function projectStateForClient(masterState, clientFaction) {
  const oppFaction = clientFaction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
  const oppPlayer = masterState.players[oppFaction];

  return {
    ...masterState,
    players: {
      [clientFaction]: masterState.players[clientFaction],
      [oppFaction]: {
        ...oppPlayer,
        hand: oppPlayer.hand.map(c => ({
          instanceId: c.instanceId,
          isHidden: true
        })),
        deck: { count: oppPlayer.deck.length },
        pendingPick: oppPlayer.pendingPick ? { source: oppPlayer.pendingPick.source, max: oppPlayer.pendingPick.max, count: oppPlayer.pendingPick.cards?.length || 0, cards: [] } : null
      }
    },
    activeCounters: masterState.activeCounters.map(c =>
      c.owner === clientFaction ? c : { id: c.id, owner: c.owner, isHidden: true }
    )
  };
}

/**
 * GameState Class Wrapper (OOP Interface)
 */
export class GameState {
  constructor(options = {}) {
    const initial = createInitialState(options);
    Object.assign(this, initial);
  }

  setup() {
    return setupGame(this);
  }

  startTurn(playerId) {
    return startTurn(this, playerId);
  }

  endTurn() {
    return endTurn(this);
  }

  drawCard(playerId) {
    return drawCard(this, playerId);
  }

  adjustPrestige(playerId, amount) {
    return adjustPrestige(this, playerId, amount);
  }

  getAllUnits(playerId) {
    return getAllUnits(this, playerId);
  }

  findUnit(unitInstanceId) {
    return findUnit(this, unitInstanceId);
  }

  removeUnit(unitInstanceId, isBanish = false) {
    return removeUnitFromBoard(this, unitInstanceId, isBanish);
  }

  clone() {
    const clonedData = cloneState(this);
    const instance = Object.create(GameState.prototype);
    Object.assign(instance, clonedData);
    return instance;
  }

  serialize() {
    return serializeState(this);
  }

  static deserialize(serialized) {
    const data = deserializeState(serialized);
    const instance = Object.create(GameState.prototype);
    Object.assign(instance, data);
    return instance;
  }

  projectForClient(clientFaction) {
    return projectStateForClient(this, clientFaction);
  }
}

export default GameState;
