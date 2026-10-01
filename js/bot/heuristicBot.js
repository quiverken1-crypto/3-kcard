/**
 * heuristicBot.js — Autonomous Heuristic Bot AI Agent
 * Three Kingdoms KARDS (Milestone 3)
 *
 * Implements:
 * 1. Opening curve mulligan filtering (decideMulligan).
 * 2. Immediate lethal fast-path strike detection.
 * 3. High-performance legal candidate action generator (deploy, move, attack, tactic, counter, end turn)
 *    with complete mobility/deploy sickness checks.
 * 4. Fast 1-ply simulation rollout (fastCloneState + dispatch + evaluateBoard).
 * 5. Tactical sequencing bias injection (prestige before deploy, economy, frontline advances, trades).
 * 6. Greedy or softmax temperature action selection policy.
 * 7. Autonomous execution loops: playTurn (synchronous) & executeBotTurnAsync (stepped).
 */

import {
  FACTIONS,
  TROOP_TYPES,
  PHASES,
  ACTION_TYPES,
  KEYWORDS,
  STATUS_TYPES,
  hasKeyword
} from '../engine/constants.js';
import {
  dispatch,
  getAllUnits,
  findUnit
} from '../engine/rulesEngine.js';
import { getValidTargets, validateAttack, getEffectiveAttack } from '../engine/combat.js';
import { getCardPlayCost } from '../engine/cardSkills.js';
import { evaluateBoard, DEFAULT_EVALUATION_WEIGHTS } from './evaluator.js';
import { autoPickCards, autoChoiceTarget, getActiveSkill, getActiveSkills, activeSkillBlockReason, canDeployToFrontline } from '../engine/cardSkills.js';
import { PRNG } from '../engine/prng.js';

/**
 * High-performance state cloning for 1-ply simulation rollouts.
 * Clones mutable game state fields (players, hands, battlefield slots, unit statuses, counters)
 * without expensive deep-stringification of unchanged 40-card decks.
 * @param {object} s
 * @returns {object}
 */
export function fastCloneState(s) {
  if (!s) return null;
  // 深拷贝：之前的浅拷贝会让 AI 的“模拟推演”改到真实对局
  // （turnEffects 回合增益、pendingDeaths、单位 keywords 等共享引用），导致凭空加攻、非法行动卡死。
  try {
    // 战报只增不减（每条还带卡牌对象），推演用不到：不拷贝，只留长度，避免越打越卡
    const { prng, combatLog, ...rest } = s;
    const c = structuredClone(rest);
    c.combatLog = [];
    if (prng) c.prng = typeof prng.clone === 'function' ? prng.clone() : prng;
    return c;
  } catch { /* 含不可克隆字段时退回旧的逐层拷贝 */ }
  const c = { ...s };
  c.turnEffects = s.turnEffects ? JSON.parse(JSON.stringify(s.turnEffects)) : s.turnEffects;
  c.pendingDeaths = Array.isArray(s.pendingDeaths) ? [...s.pendingDeaths] : s.pendingDeaths;

  c.players = {
    WEI: {
      ...s.players.WEI,
      hand: s.players.WEI.hand.map(x => ({ ...x, status: { ...x.status } })),
      deck: [...s.players.WEI.deck],
      discard: [...s.players.WEI.discard]
    },
    SHU: {
      ...s.players.SHU,
      hand: s.players.SHU.hand.map(x => ({ ...x, status: { ...x.status } })),
      deck: [...s.players.SHU.deck],
      discard: [...s.players.SHU.discard]
    }
  };

  c.battlefield = {
    support: {
      WEI: {
        hq: { ...s.battlefield.support.WEI.hq },
        slots: s.battlefield.support.WEI.slots.map(x => ({ ...x, status: { ...x.status } }))
      },
      SHU: {
        hq: { ...s.battlefield.support.SHU.hq },
        slots: s.battlefield.support.SHU.slots.map(x => ({ ...x, status: { ...x.status } }))
      }
    },
    frontline: {
      LEFT: {
        ...s.battlefield.frontline.LEFT,
        terrain: s.battlefield.frontline.LEFT.terrain ? { ...s.battlefield.frontline.LEFT.terrain } : null,
        units: s.battlefield.frontline.LEFT.units.map(x => ({ ...x, status: { ...x.status } }))
      },
      CENTER: {
        ...s.battlefield.frontline.CENTER,
        terrain: s.battlefield.frontline.CENTER.terrain ? { ...s.battlefield.frontline.CENTER.terrain } : null,
        units: s.battlefield.frontline.CENTER.units.map(x => ({ ...x, status: { ...x.status } }))
      },
      RIGHT: {
        ...s.battlefield.frontline.RIGHT,
        terrain: s.battlefield.frontline.RIGHT.terrain ? { ...s.battlefield.frontline.RIGHT.terrain } : null,
        units: s.battlefield.frontline.RIGHT.units.map(x => ({ ...x, status: { ...x.status } }))
      }
    },
    reserveTerrain: s.battlefield.reserveTerrain ? (Array.isArray(s.battlefield.reserveTerrain) ? [...s.battlefield.reserveTerrain] : { ...s.battlefield.reserveTerrain }) : null
  };

  c.activeCounters = s.activeCounters ? s.activeCounters.map(x => ({ ...x })) : [];
  c.combatLog = [];
  if (s.prng && typeof s.prng.clone === 'function') {
    c.prng = s.prng.clone();
  }

  return c;
}

export class HeuristicBot {
  /**
   * @param {string} faction - 'WEI' or 'SHU'
   * @param {object} [options]
   * @param {object} [options.weights=DEFAULT_EVALUATION_WEIGHTS]
   * @param {number} [options.temperature=0.0]
   * @param {PRNG} [options.prng]
   * @param {number} [options.seed=12345]
   * @param {number} [options.turnActionLimit=15]
   * @param {boolean} [options.debug=false]
   */
  constructor(faction, options = {}) {
    this.faction = faction;
    this.weights = options.weights || DEFAULT_EVALUATION_WEIGHTS;
    this.temperature = options.temperature ?? 0.0;
    this.prng = options.prng || new PRNG(options.seed || 12345);
    this.turnActionLimit = options.turnActionLimit || 15;
    this.debug = options.debug || false;
  }

  /**
   * Evaluates opening hand and selects card indices to return for mulligan.
   * Keeps early curve (cost <= 3). If insufficient early curve (< 2), drops expensive cards (cost >= 5).
   * @param {object[]} hand
   * @returns {number[]} Array of 0-based indices
   */
  decideMulligan(hand) {
    if (!Array.isArray(hand) || hand.length === 0) return [];
    const lowCostCount = hand.filter(c => (c.cost ?? 1) <= 3).length;
    const indicesToMulligan = [];

    hand.forEach((card, idx) => {
      const cost = card.cost ?? 1;
      if (cost >= 5 && lowCostCount < 2) {
        indicesToMulligan.push(idx);
      }
    });

    return indicesToMulligan;
  }

  /**
   * Checks for an immediate lethal attack against enemy HQ.
   * @param {object} state
   * @param {string} botFaction
   * @returns {object|null}
   */
  checkImmediateLethal(state, botFaction) {
    const oppFaction = botFaction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
    const oppPlayer = state.players[oppFaction];
    const oppUnits = getAllUnits(state, oppFaction);

    // If enemy has Sun Qian (使节), enemy HQ cannot take damage
    if (oppUnits.some(u => hasKeyword(u, KEYWORDS.SHI_JIE))) {
      return null;
    }

    const selfUnits = getAllUnits(state, botFaction);
    for (const u of selfUnits) {
      if (u.status[STATUS_TYPES.SUPPRESSED]) continue;
      const hasRush = hasKeyword(u, KEYWORDS.TU_XI);
      if (u.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasRush) continue;

      try {
        const validation = validateAttack(state, u.instanceId, 'HQ');
        if (validation && validation.valid) {
          const dmg = getEffectiveAttack(state, u);
          if (dmg >= oppPlayer.hp) {
            return {
              type: ACTION_TYPES.ATTACK,
              playerId: botFaction,
              payload: { attackerId: u.instanceId, targetId: 'HQ' }
            };
          }
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Enumerates all legal candidate actions for botFaction.
   * Pre-filters mobility and deployment sickness constraints.
   * @param {object} state
   * @param {string} botFaction
   * @returns {object[]}
   */
  enumerateLegalActions(state, botFaction) {
    const actions = [];
    const player = state.players[botFaction];
    const selfUnits = getAllUnits(state, botFaction);

    // 1. DEPLOY Actions
    for (const card of player.hand) {
      if (card.type === 'UNIT') {
        const cost = getCardPlayCost(state, botFaction, card);
        if (player.provisions >= cost) {
          // Deploy to Support
          if (state.battlefield.support[botFaction].slots.length < 4) {
            actions.push({
              type: ACTION_TYPES.DEPLOY,
              playerId: botFaction,
              payload: { cardInstanceId: card.instanceId, targetZone: 'SUPPORT' }
            });
          }
          // Deploy to Frontline (奇袭)
          {
            for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
              if (canDeployToFrontline(state, card, botFaction, zk)) {
                actions.push({
                  type: ACTION_TYPES.DEPLOY,
                  playerId: botFaction,
                  payload: { cardInstanceId: card.instanceId, targetZone: zk }
                });
              }
            }
          }
        }
      }
    }

    // 2. MOVE Actions
    for (const u of selfUnits) {
      if (u.status[STATUS_TYPES.SUPPRESSED] || player.provisions < u.actionCost) continue;

      const hasRush = hasKeyword(u, KEYWORDS.TU_XI);
      if (u.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasRush) continue;

      const loc = findUnit(state, u.instanceId);
      if (!loc) continue;

      const isWater = loc.zoneType === 'FRONTLINE' && state.battlefield.frontline[loc.zoneKey]?.terrain?.type === 'WATER';
      const actsLikeCavalry = u.troopType === TROOP_TYPES.CAVALRY || (u.troopType === TROOP_TYPES.NAVY && isWater);

      // Movement restriction check
      if (actsLikeCavalry) {
        if (u.status[STATUS_TYPES.MOVED_THIS_TURN]) continue;
      } else {
        if (u.status[STATUS_TYPES.ACTIONS_USED] > 0 || u.status[STATUS_TYPES.MOVED_THIS_TURN] || u.status[STATUS_TYPES.ATTACKED_THIS_TURN]) {
          continue;
        }
      }

      // Support to Frontline
      if (loc.zoneType === 'SUPPORT') {
        for (const zk of ['LEFT', 'CENTER', 'RIGHT']) {
          const zone = state.battlefield.frontline[zk];
          if ((zone.occupant === null || zone.occupant === botFaction) && zone.units.length < zone.capacity) {
            actions.push({
              type: ACTION_TYPES.MOVE,
              playerId: botFaction,
              payload: { cardInstanceId: u.instanceId, targetZone: `FRONTLINE_${zk}` }
            });
          }
        }
      }
      // Frontline lateral moves & retreat
      else if (loc.zoneType === 'FRONTLINE') {
        const zk = loc.zoneKey;
        const adjacentZones = zk === 'CENTER' ? ['LEFT', 'RIGHT'] : ['CENTER'];
        for (const targetZk of adjacentZones) {
          const targetZone = state.battlefield.frontline[targetZk];
          if ((targetZone.occupant === null || targetZone.occupant === botFaction) && targetZone.units.length < targetZone.capacity) {
            actions.push({
              type: ACTION_TYPES.MOVE,
              playerId: botFaction,
              payload: { cardInstanceId: u.instanceId, targetZone: `FRONTLINE_${targetZk}` }
            });
          }
        }
        // 游击 retreat to support
        if (hasKeyword(u, KEYWORDS.YOU_JI) && state.battlefield.support[botFaction].slots.length < 4) {
          actions.push({
            type: ACTION_TYPES.MOVE,
            playerId: botFaction,
            payload: { cardInstanceId: u.instanceId, targetZone: 'SUPPORT' }
          });
        }
      }
    }

    // 3. ATTACK Actions
    for (const u of selfUnits) {
      if (u.status[STATUS_TYPES.SUPPRESSED] || player.provisions < u.actionCost) continue;

      const hasRush = hasKeyword(u, KEYWORDS.TU_XI);
      if (u.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasRush) continue;

      const loc = findUnit(state, u.instanceId);
      if (!loc) continue;

      const isWater = loc.zoneType === 'FRONTLINE' && state.battlefield.frontline[loc.zoneKey]?.terrain?.type === 'WATER';
      const actsLikeCavalry = u.troopType === TROOP_TYPES.CAVALRY || (u.troopType === TROOP_TYPES.NAVY && isWater);
      const hasDoubleStrike = hasKeyword(u, KEYWORDS.FEN_ZHAN);

      if (actsLikeCavalry) {
        if (u.status[STATUS_TYPES.ATTACKED_THIS_TURN] && (!hasDoubleStrike || (u.status.attacksThisTurn || 0) >= 2)) {
          continue;
        }
      } else {
        if (u.status[STATUS_TYPES.MOVED_THIS_TURN]) continue;
        if (!hasDoubleStrike && u.status[STATUS_TYPES.ACTIONS_USED] > 0) continue;
        if (hasDoubleStrike && (u.status.attacksThisTurn || 0) >= 2) continue;
      }

      const targets = getValidTargets(state, u.instanceId);
      for (const targetId of targets) {
        actions.push({
          type: ACTION_TYPES.ATTACK,
          playerId: botFaction,
          payload: { attackerId: u.instanceId, targetId }
        });
      }
    }

    // 4. PLAY_TACTIC Actions
    for (const card of player.hand) {
      if (card.type === 'TACTIC') {
        let cost = card.cost;
        for (const u of selfUnits) {
          const qm = u.keywords.find(k => typeof k === 'string' && k.startsWith(KEYWORDS.QI_MOU_PREFIX));
          if (qm) {
            cost = Math.max(0, cost - parseInt(qm.replace(KEYWORDS.QI_MOU_PREFIX, '') || '1', 10));
          }
        }
        if (player.provisions >= cost) {
          actions.push({
            type: ACTION_TYPES.PLAY_TACTIC,
            playerId: botFaction,
            payload: { cardInstanceId: card.instanceId }
          });
        }
      }
    }

    // 5. SET_COUNTER Actions
    for (const card of player.hand) {
      if (card.type === 'COUNTER') {
        let cost = card.cost;
        for (const u of selfUnits) {
          const qm = u.keywords.find(k => typeof k === 'string' && k.startsWith(KEYWORDS.QI_MOU_PREFIX));
          if (qm) {
            cost = Math.max(0, cost - parseInt(qm.replace(KEYWORDS.QI_MOU_PREFIX, '') || '1', 10));
          }
        }
        if (player.provisions >= cost) {
          actions.push({
            type: ACTION_TYPES.SET_COUNTER,
            playerId: botFaction,
            payload: { cardInstanceId: card.instanceId }
          });
        }
      }
    }

    // 6. END_TURN Action
    actions.push({ type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} });

    return actions;
  }

  /**
   * Computes tactical sequencing bias for action.
   * @param {object} state
   * @param {object} action
   * @param {string} botFaction
   * @returns {number}
   */
  computeTacticalBias(state, action, botFaction) {
    if (action.type === ACTION_TYPES.END_TURN) return 0;
    let bias = 0;
    const player = state.players[botFaction];

    if (action.type === ACTION_TYPES.PLAY_TACTIC) {
      const card = player.hand.find(c => c.instanceId === action.payload.cardInstanceId);
      if (card) {
        if (hasKeyword(card, '声望1') || hasKeyword(card, '声望2')) {
          const hasUnitsToDeploy = player.hand.some(c => c.type === 'UNIT');
          if (hasUnitsToDeploy && !player.prestigeDiscountUsed) bias += 25.0;
        }
        if (card.cardId === 'WEI_018' || card.name === '屯田制') {
          bias += 16.0;
        }
      }
    } else if (action.type === ACTION_TYPES.DEPLOY) {
      const card = player.hand.find(c => c.instanceId === action.payload.cardInstanceId);
      if (card) {
        if (!player.prestigeDiscountUsed && player.prestige > 0) bias += 18.0;
        if (hasKeyword(card, KEYWORDS.DU_ZHAN)) bias += 15.0;
        if (hasKeyword(card, KEYWORDS.BU_JI)) bias += 12.0;
        if (hasKeyword(card, KEYWORDS.SHOU_HU)) bias += 18.0;
      }
    } else if (action.type === ACTION_TYPES.MOVE) {
      bias += 22.0;
      const unitLoc = findUnit(state, action.payload.cardInstanceId);
      if (unitLoc && unitLoc.unit.troopType === TROOP_TYPES.CAVALRY) {
        bias += 4.0;
      }
    } else if (action.type === ACTION_TYPES.ATTACK) {
      const { attackerId, targetId } = action.payload;
      const attackerLoc = findUnit(state, attackerId);
      const attacker = attackerLoc?.unit;

      if (targetId === 'HQ') {
        const oppFaction = botFaction === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
        if (state.players[oppFaction].hp <= 12) {
          bias += 30.0;
        } else {
          bias += 15.0;
        }
      } else {
        const targetLoc = findUnit(state, targetId);
        const defender = targetLoc?.unit;
        if (attacker && defender) {
          const atkDmg = getEffectiveAttack(state, attacker, attackerLoc);
          const defDmg = getEffectiveAttack(state, defender, targetLoc);

          // Favorable trade: defender dies, attacker survives
          if (atkDmg >= defender.hp && defDmg < attacker.hp) {
            bias += 35.0;
          }
          // Vanguard kill
          if (hasKeyword(attacker, KEYWORDS.XIAN_DENG) && atkDmg >= defender.hp) {
            bias += 25.0;
          }
          // Suicidal trade: attacker dies, defender survives
          if (defDmg >= attacker.hp && atkDmg < defender.hp) {
            bias -= 50.0;
          }
        }
      }
    } else if (action.type === ACTION_TYPES.SET_COUNTER) {
      bias += 18.0;
    }

    return bias;
  }

  /**
   * Selects best action in current state using 1-ply lookahead simulation.
   * @param {object} state
   * @param {string} [botFaction=this.faction]
   * @returns {object}
   */
  chooseBestAction(state, botFaction = this.faction) {
    const planner = this._planAction(state, botFaction);
    let step;
    do { step = planner.next(); } while (!step.done);
    return step.value;
  }

  /** Evaluate the same candidates while yielding between short batches on phones. */
  async chooseBestActionAsync(state, botFaction = this.faction, options = {}) {
    const planner = this._planAction(state, botFaction);
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const yieldTask = options.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0)));
    const budget = options.budgetMs ?? 6;
    let started = now();
    for (;;) {
      const step = planner.next();
      if (step.done) return step.value;
      if (now() - started >= budget) {
        await yieldTask();
        started = now();
      }
    }
  }

  *_planAction(state, botFaction) {
    const pick = state.players?.[botFaction]?.pendingPick;
    if (pick) return { type: ACTION_TYPES.PICK_CARDS, playerId: botFaction, payload: { cardIds: autoPickCards(pick) } };
    const choice = state.players?.[botFaction]?.pendingChoices?.[0];
    if (choice) return { type: ACTION_TYPES.CHOOSE_TARGET, playerId: botFaction, payload: { choiceId: choice.id, targetId: autoChoiceTarget(state, botFaction) } };
    // 程昱·捕粮：手牌较多时弃掉最便宜的一张换2粮草
    const hand = state.players?.[botFaction]?.hand || [];
    if (hand.length >= 5) {
      for (const u of getAllUnits(state, botFaction)) {
        if (getActiveSkill(u)?.needsHandCard && !activeSkillBlockReason(state, u)) {
          const cheap = [...hand].sort((a, b) => (a.cost || 0) - (b.cost || 0))[0];
          return { type: ACTION_TYPES.ACTIVATE_SKILL, playerId: botFaction, payload: { unitId: u.instanceId, cardId: cheap.instanceId } };
        }
      }
    }
    // 工坊积木主动技：能发动就发动（消耗不会致死，由 activeSkillBlockReason 保证）
    for (const u of getAllUnits(state, botFaction)) {
      for (const spec of getActiveSkills(u)) {
        if (spec.custom && !spec.needsHandCard && !activeSkillBlockReason(state, u, spec.index)) {
          return { type: ACTION_TYPES.ACTIVATE_SKILL, playerId: botFaction, payload: { unitId: u.instanceId, skillIndex: spec.index } };
        }
      }
    }
    // 1. Check immediate lethal strike
    const lethalAction = this.checkImmediateLethal(state, botFaction);
    if (lethalAction) return lethalAction;

    // 2. Enumerate candidate legal actions
    const legalActions = this.enumerateLegalActions(state, botFaction);
    if (legalActions.length === 0) {
      return { type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} };
    }

    const currentScore = evaluateBoard(state, botFaction, this.weights);
    const scoredActions = [];

    // 3 & 4. 1-ply simulation rollout
    for (const action of legalActions) {
      if (action.type === ACTION_TYPES.END_TURN) {
        scoredActions.push({ action, utility: 0 });
        continue;
      }

      try {
        const nextState = fastCloneState(state);
        dispatch(nextState, action);
        const evalScore = evaluateBoard(nextState, botFaction, this.weights);
        const deltaEval = evalScore - currentScore;
        const bias = this.computeTacticalBias(state, action, botFaction);
        const utility = deltaEval + bias;
        scoredActions.push({ action, utility });
      } catch {
        scoredActions.push({ action, utility: -Infinity });
      }
      yield;
    }

    // 5. Select action
    scoredActions.sort((a, b) => b.utility - a.utility);
    const topAction = scoredActions[0];

    if (!topAction || topAction.utility <= 0) {
      return { type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} };
    }

    // Greedy selection
    if (this.temperature <= 0.001) {
      return topAction.action;
    }

    // Softmax temperature selection among positive actions
    const viable = scoredActions.filter(sa => sa.utility > 0);
    const maxU = viable[0].utility;
    const exps = viable.map(sa => Math.exp((sa.utility - maxU) / this.temperature));
    const sumExps = exps.reduce((acc, v) => acc + v, 0);
    let r = this.prng.next() * sumExps;

    for (let i = 0; i < viable.length; i++) {
      r -= exps[i];
      if (r <= 0) return viable[i].action;
    }

    return viable[0].action;
  }

  /**
   * Plays an entire turn synchronously on state until END_TURN or action limit.
   * @param {object} state
   * @param {string} [botFaction=this.faction]
   * @returns {{ actionsExecuted: number }}
   */
  playTurn(state, botFaction = this.faction) {
    let actionsExecuted = 0;
    while (state.phase === PHASES.ACTION && state.activePlayer === botFaction && actionsExecuted < this.turnActionLimit) {
      const action = this.chooseBestAction(state, botFaction);
      if (!action || action.type === ACTION_TYPES.END_TURN) {
        dispatch(state, { type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} });
        break;
      }
      dispatch(state, action);
      actionsExecuted++;
      if (state.phase === PHASES.GAME_OVER) break;
    }
    return { actionsExecuted };
  }
}

/**
 * Visual stepping loop for single-player / UI integration.
 * @param {object} rulesEngine
 * @param {HeuristicBot} bot
 * @param {object} [options]
 */
export async function executeBotTurnAsync(rulesEngine, bot, options = {}) {
  const stepDelayMs = options.stepDelayMs ?? 400;
  const onActionCallback = options.onActionCallback || null;
  const state = rulesEngine.state;
  const botFaction = bot.faction;

  let actionsTaken = 0;
  let failures = 0;
  const maxActions = options.maxActions || 15;

  while (state.phase === PHASES.ACTION && state.activePlayer === botFaction && actionsTaken < maxActions) {
    if (options.shouldContinue && !options.shouldContinue()) return;
    const action = options.cooperative
      ? await bot.chooseBestActionAsync(state, botFaction)
      : bot.chooseBestAction(state, botFaction);
    if (options.shouldContinue && !options.shouldContinue()) return;

    if (!action || action.type === ACTION_TYPES.END_TURN) {
      rulesEngine.dispatch({ type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} });
      if (onActionCallback) onActionCallback({ type: ACTION_TYPES.END_TURN });
      break;
    }

    let result;
    try {
      result = rulesEngine.dispatch(action);
    } catch (err) {
      // 选出的行动被规则拒绝：不要让整个AI回合崩掉卡死，改为结束回合
      console.warn('AI 行动被规则拒绝，结束回合：', err?.message, action);
      failures++;
      if (failures >= 2 || state.phase !== PHASES.ACTION || state.activePlayer !== botFaction) {
        try { rulesEngine.dispatch({ type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} }); } catch (_) { /* ignore */ }
        if (onActionCallback) onActionCallback({ type: ACTION_TYPES.END_TURN });
        break;
      }
      continue;
    }
    actionsTaken++;
    if (onActionCallback) onActionCallback({ action, result });

    if (state.phase === PHASES.GAME_OVER) break;

    if (stepDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, stepDelayMs));
    }
  }
  if (options.shouldContinue && !options.shouldContinue()) return;
  if (state.phase === PHASES.ACTION && state.activePlayer === botFaction) {
    try { rulesEngine.dispatch({ type: ACTION_TYPES.END_TURN, playerId: botFaction, payload: {} }); } catch (_) { /* ignore */ }
    if (onActionCallback) onActionCallback({ type: ACTION_TYPES.END_TURN });
  }
}

/**
 * Autonomous execution loop until end turn or max actions (default 15).
 * Operates on RulesEngine instance or GameState.
 * @param {object} engine - RulesEngine instance or GameState
 * @param {string} [botFaction] - 'WEI' or 'SHU'
 * @param {object} [options]
 * @returns {{ actionsExecuted: number }}
 */
export function runBotTurn(engine, botFaction, options = {}) {
  const state = engine.state || engine;
  const faction = botFaction || state.activePlayer;
  const bot = new HeuristicBot(faction, options);
  const maxActions = options.maxActions || 15;
  let actionsExecuted = 0;

  while (state.phase === PHASES.ACTION && state.activePlayer === faction && actionsExecuted < maxActions) {
    const action = bot.chooseBestAction(state, faction);
    if (!action || action.type === ACTION_TYPES.END_TURN) {
      if (typeof engine.dispatch === 'function') {
        engine.dispatch({ type: ACTION_TYPES.END_TURN, playerId: faction, payload: {} });
      } else {
        dispatch(state, { type: ACTION_TYPES.END_TURN, playerId: faction, payload: {} });
      }
      break;
    }
    if (typeof engine.dispatch === 'function') {
      engine.dispatch(action);
    } else {
      dispatch(state, action);
    }
    actionsExecuted++;
    if (state.phase === PHASES.GAME_OVER) break;
  }
  return { actionsExecuted };
}

export default HeuristicBot;
