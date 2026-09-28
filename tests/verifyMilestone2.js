/**
 * verifyMilestone2.js
 * Comprehensive Verification Test Suite for Milestone 2: Core Rules Engine & Combat State Machine.
 * Validates constants, deterministic Mulberry32 PRNG, GameState lifecycle,
 * 8-stage combat pipeline with 25+ keywords, status effects, and master rules dispatcher.
 * Zero external dependencies — runs directly with `node game/tests/verifyMilestone2.js`.
 */

import assert from 'node:assert/strict';

// Direct module imports (bypassing testHarness to test production engine directly)
import {
  FACTIONS,
  TROOP_TYPES,
  CARD_TYPES,
  PHASES,
  ACTION_TYPES,
  TERRAIN_TYPES,
  TERRAINS,
  ZONE_KEYS,
  ZONES,
  KEYWORDS,
  STATUS_TYPES,
  GAME_CONFIG,
  parseParametricKeyword,
  hasKeyword,
  getKeywordValue
} from '../js/engine/constants.js';

import { PRNG } from '../js/engine/prng.js';

import {
  createCard,
  createCardInstance,
  resetInstanceCounter,
  createWeiDeck,
  createShuDeck,
  createInitialState,
  setupGame,
  executeMulligan,
  startTurn,
  endTurn,
  drawCard,
  adjustPrestige,
  getAllUnits,
  findUnit,
  removeUnitFromBoard,
  serializeState,
  deserializeState,
  cloneState,
  projectStateForClient,
  GameState
} from '../js/engine/state.js';

import {
  validateAttack,
  getValidTargets,
  resolveCombat,
  applySuppression,
  applyInhibition
} from '../js/engine/combat.js';

import {
  dispatch,
  getLegalActions,
  validateAction,
  RulesEngine
} from '../js/engine/rulesEngine.js';

console.log('='.repeat(80));
console.log('     MILESTONE 2: CORE RULES ENGINE & COMBAT STATE MACHINE VERIFICATION');
console.log('='.repeat(80));

let assertionsRun = 0;
function check(condition, message) {
  assert.ok(condition, message);
  assertionsRun++;
}

// ============================================================================
// Suite 1: Constants, Enums & Keyword Dictionaries
// ============================================================================
console.log('\n[Suite 1] Constants, Enums & Keyword Dictionaries');

// 1.1 Core Enums
check(FACTIONS.WEI === 'WEI' && FACTIONS.SHU === 'SHU', 'FACTIONS enum contains WEI and SHU');
check(Object.isFrozen(FACTIONS), 'FACTIONS enum is deeply frozen');

check(TROOP_TYPES.INFANTRY === 'INFANTRY' && TROOP_TYPES.CAVALRY === 'CAVALRY' &&
      TROOP_TYPES.ARCHER === 'ARCHER' && TROOP_TYPES.NAVY === 'NAVY' &&
      TROOP_TYPES.STRATEGIST === 'STRATEGIST' && TROOP_TYPES.NONE === 'NONE',
      'TROOP_TYPES covers all 6 canonical troop classes');

check(PHASES.SETUP === 'SETUP' && PHASES.MULLIGAN === 'MULLIGAN' &&
      PHASES.TURN_START === 'TURN_START' && PHASES.DRAW === 'DRAW' &&
      PHASES.ACTION === 'ACTION' && PHASES.TURN_END === 'TURN_END' &&
      PHASES.GAME_OVER === 'GAME_OVER',
      'PHASES covers complete turn lifecycle');

check(ACTION_TYPES.DEPLOY === 'DEPLOY' && ACTION_TYPES.MOVE === 'MOVE' &&
      ACTION_TYPES.ATTACK === 'ATTACK' && ACTION_TYPES.PLAY_TACTIC === 'PLAY_TACTIC' &&
      ACTION_TYPES.SET_COUNTER === 'SET_COUNTER' && ACTION_TYPES.END_TURN === 'END_TURN',
      'ACTION_TYPES covers standard player actions');

// 1.2 Terrain Specs
check(TERRAINS.PLAIN.capacity === 3 && TERRAINS.WATER.capacity === 3 &&
      TERRAINS.MOUNTAIN.capacity === 2 && TERRAINS.PASS.capacity === 2,
      'TERRAINS capacities conform to rules spec (3/3/2/2)');

// 1.3 Keyword Helpers
check(hasKeyword({ keywords: ['守护', '坚阵2'] }, '守护'), 'hasKeyword finds exact match');
check(hasKeyword({ keywords: ['坚阵2'] }, '坚阵'), 'hasKeyword finds parametric prefix');
check(parseParametricKeyword('坚阵3', '坚阵') === 3, 'parseParametricKeyword extracts numeric parameter');
check(getKeywordValue({ keywords: ['坚阵1', '坚阵3'] }, '坚阵') === 3, 'getKeywordValue gets highest value');

// ============================================================================
// Suite 2: Deterministic Mulberry32 PRNG Engine
// ============================================================================
console.log('\n[Suite 2] Deterministic Mulberry32 PRNG Engine');

const prng1 = new PRNG(42);
const prng2 = new PRNG(42);
const stream1 = [];
const stream2 = [];
for (let i = 0; i < 50; i++) {
  stream1.push(prng1.next());
  stream2.push(prng2.next());
}
check(stream1.every((v, i) => v === stream2[i]), 'PRNG produces identical deterministic sequence for identical seed');

const prngDiff = new PRNG(999);
check(prngDiff.next() !== stream1[0], 'PRNG produces divergent output for different seed');

// RandomInt within bounds
const ints = [];
for (let i = 0; i < 100; i++) {
  const r = prng1.randomInt(5, 10);
  check(r >= 5 && r <= 10, 'randomInt is strictly within [min, max]');
  ints.push(r);
}
check(new Set(ints).size >= 5, 'randomInt covers multiple distinct values in range');

// Fisher-Yates Shuffle
const originalArr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const shuffled = prng1.shuffleArray([...originalArr]);
check(shuffled.length === 10, 'shuffleArray preserves length');
check(originalArr.every(x => shuffled.includes(x)), 'shuffleArray preserves all elements');

// Checkpoint & Rollback
prng1.checkpoint();
const valBeforeRollback = prng1.next();
prng1.rollback();
check(prng1.next() === valBeforeRollback, 'PRNG rollback restores exact pseudo-random state');

// Serialization & Deserialization
const prngSaved = new PRNG(777);
prngSaved.next();
prngSaved.next();
const serialized = prngSaved.serialize();
const prngRestored = PRNG.deserialize(serialized);
check(prngRestored.next() === prngSaved.next(), 'PRNG serialization and deserialization preserves state');

// Deep Clone
const prngCloneSource = new PRNG(101);
prngCloneSource.next();
const prngCloned = prngCloneSource.clone();
check(prngCloned.next() === prngCloneSource.next(), 'PRNG clone produces identical deterministic future stream');

// ============================================================================
// Suite 3: GameState Schema, Double Granary & Lifecycle
// ============================================================================
console.log('\n[Suite 3] GameState Schema, Double Granary & Lifecycle');

resetInstanceCounter();
const unitCard = createCard({
  name: '轻骑兵',
  faction: FACTIONS.WEI,
  cost: 1,
  actionCost: 1,
  atk: 2,
  hp: 1,
  keywords: ['突袭']
});
check(unitCard.instanceId === 'inst_1', 'createCard assigns incrementing instanceId');
check(unitCard.type === 'UNIT', 'createCard normalizes card type to uppercase');
check(unitCard.status.suppressed === false && unitCard.status.inhibited === false, 'createCard initializes default status flags');

const state = createInitialState({ weiHp: 20, shuHp: 20 });
check(state.battlefield.support[FACTIONS.WEI].slots.length === 0, 'Support line starts with 0 units');
check(state.battlefield.support[FACTIONS.WEI].hq.hp === 20, 'Support line contains Wei HQ with initial HP');
check(state.battlefield.frontline.LEFT.terrain.type === 'PLAIN', 'Default frontline LEFT is Plain');
check(state.battlefield.frontline.CENTER.terrain.type === 'WATER', 'Default frontline CENTER is Water');
check(state.battlefield.frontline.RIGHT.terrain.type === 'MOUNTAIN', 'Default frontline RIGHT is Mountain');
check(state.battlefield.reserveTerrain.type === 'PASS', 'Default reserve terrain is Pass');

// Setup Game & Opening Hands
setupGame(state);
check(state.phase === PHASES.MULLIGAN, 'setupGame advances phase to MULLIGAN');
check(state.players[FACTIONS.WEI].hand.length === 4, 'Player 1 (Wei) draws 4 cards');
check(state.players[FACTIONS.SHU].hand.length === 5, 'Player 2 (Shu) draws 5 cards');
check(state.players[FACTIONS.WEI].deck.length === 36, 'Wei deck decrements from 40 to 36');
check(state.players[FACTIONS.SHU].deck.length === 35, 'Shu deck decrements from 40 to 35');

// Turn 1 Lifecycle (P1 Turn 1 skips draw)
startTurn(state, FACTIONS.WEI);
check(state.phase === PHASES.ACTION, 'startTurn transitions to ACTION phase');
check(state.players[FACTIONS.WEI].mainGranaryCap === 1, 'Turn 1 increments natural main granary to 1');
check(state.players[FACTIONS.WEI].provisions === 1, 'Turn 1 refills provisions to 1');
check(state.players[FACTIONS.WEI].hand.length === 4, 'Turn 1 P1 skips draw phase');

// Turn 2 Lifecycle (P2 Turn 2 draws normally)
endTurn(state);
check(state.activePlayer === FACTIONS.SHU, 'endTurn switches active player to SHU');
check(state.turnNumber === 2, 'endTurn increments turn number to 2');
check(state.players[FACTIONS.SHU].mainGranaryCap === 1, 'P2 increments natural main granary to 1');
check(state.players[FACTIONS.SHU].hand.length === 6, 'P2 draws normally on Turn 2 (5 + 1 = 6 cards)');

// Double Granary: Natural Ceiling at 10
state.players[FACTIONS.WEI].mainGranaryCap = 10;
startTurn(state, FACTIONS.WEI);
check(state.players[FACTIONS.WEI].mainGranaryCap === 10, 'Natural main granary cap is capped at 10');

// Dynamic Prestige Tug-of-War
const pWei = state.players[FACTIONS.WEI];
const pShu = state.players[FACTIONS.SHU];
pWei.prestige = 0;
pShu.prestige = 0;
adjustPrestige(state, FACTIONS.WEI, 1);
check(pWei.prestige === 1 && pShu.prestige === 0, 'Prestige gained by self when opponent at 0');

pShu.prestige = 2;
pWei.prestige = 0;
adjustPrestige(state, FACTIONS.WEI, 1);
check(pShu.prestige === 1 && pWei.prestige === 0, 'Prestige stolen from opponent when opponent > 0');

// Hand Limit 9 Overflow Burn
pWei.hand = [];
for (let i = 0; i < 9; i++) pWei.hand.push(createCard({ name: `手牌_${i}` }));
pWei.deck = [createCard({ name: '溢出手牌' })];
pWei.discard = [];
const burnedCard = drawCard(state, FACTIONS.WEI);
check(pWei.hand.length === 9, 'Hand limit 9 strictly enforced on overdraw');
check(pWei.discard.length === 1 && pWei.discard[0].instanceId === burnedCard.instanceId, '10th card drawn is burned directly to discard');

// Empty Deck Fatigue Damage Escalation (N-th overdraw deals N damage)
pWei.deck = [];
pWei.hp = 20;
pWei.fatigueCount = 0;
drawCard(state, FACTIONS.WEI); // overdraw 1 -> deals 1
check(pWei.hp === 19 && pWei.fatigueCount === 1, 'Fatigue tick 1 deals 1 damage');
drawCard(state, FACTIONS.WEI); // overdraw 2 -> deals 2
check(pWei.hp === 17 && pWei.fatigueCount === 2, 'Fatigue tick 2 deals 2 damage (20 - 1 - 2 = 17)');
drawCard(state, FACTIONS.WEI); // overdraw 3 -> deals 3
check(pWei.hp === 14 && pWei.fatigueCount === 3, 'Fatigue tick 3 deals 3 damage (17 - 3 = 14)');

// Board Management & 降将 (Defector) Routing
const defector = createCard({ name: '降将魏延', faction: FACTIONS.SHU, keywords: ['降将'] });
state.battlefield.support[FACTIONS.SHU].slots.push(defector);
pWei.discard = [];
pShu.discard = [];
removeUnitFromBoard(state, defector.instanceId);
check(pWei.discard.some(c => c.instanceId === defector.instanceId), '降将 (Defector) unit routes to OPPONENT discard upon defeat');
check(!pShu.discard.some(c => c.instanceId === defector.instanceId), '降将 does not enter owner discard');

// Serialization & Client Secret Masking
const clientProjection = projectStateForClient(state, FACTIONS.WEI);
check(clientProjection.players[FACTIONS.SHU].hand[0].isHidden === true, 'Opponent hand cards are hidden for WebRTC client projection');
check(clientProjection.players[FACTIONS.WEI].hand[0].isHidden === undefined, 'Friendly hand cards remain unmasked');

// ============================================================================
// Suite 4: Combat Pipeline, Keywords & Status Effects
// ============================================================================
console.log('\n[Suite 4] Combat Pipeline, Keywords & Status Effects');

// 4.1 Ambush (伏击) Preemptive Strike
const ambushDefender = createCard({ name: '伏击兵', faction: FACTIONS.SHU, atk: 5, hp: 2, keywords: ['伏击'] });
const regularAttacker = createCard({ name: '普通骑兵', faction: FACTIONS.WEI, atk: 4, hp: 3, actionCost: 1, keywords: [] });
state.battlefield.support[FACTIONS.SHU].slots = [ambushDefender];
state.battlefield.support[FACTIONS.WEI].slots = [regularAttacker];
pWei.provisions = 10;
state.activePlayer = FACTIONS.WEI;

const ambushResult = resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: regularAttacker.instanceId, targetId: ambushDefender.instanceId }
});
check(ambushResult.ambushTriggered === true, 'Ambush triggers first-strike counter');
check(ambushResult.attackerDied === true, 'Lethal ambush counter destroys attacker before striking');
check(ambushResult.damageDealt === 0, 'Attacker dealt 0 damage after dying to Ambush');
check(ambushDefender.hp === 2, 'Ambush defender took 0 damage');

// 4.2 先登 (Vanguard) Preemptive Strike
const vanguardAttacker = createCard({ name: '先登士', faction: FACTIONS.WEI, atk: 4, hp: 2, actionCost: 1, keywords: ['先登'] });
const standardDefender = createCard({ name: '守卫', faction: FACTIONS.SHU, atk: 3, hp: 3, keywords: [] });
state.battlefield.support[FACTIONS.WEI].slots = [vanguardAttacker];
state.battlefield.support[FACTIONS.SHU].slots = [standardDefender];
pWei.provisions = 10;

const vanguardResult = resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: vanguardAttacker.instanceId, targetId: standardDefender.instanceId }
});
check(vanguardResult.vanguardImmunity === true, 'Vanguard gains counterattack immunity on lethal strike');
check(vanguardResult.counterDealt === 0, 'Vanguard takes 0 counterattack damage');
check(vanguardAttacker.hp === 2, 'Vanguard attacker survives at full HP');

// 4.3 冲阵 (Charge) Counter-Immunity
const chargeAttacker = createCard({ name: '冲阵骑', faction: FACTIONS.WEI, atk: 3, hp: 3, actionCost: 1, keywords: ['冲阵'] });
const normalDef = createCard({ name: '步兵', faction: FACTIONS.SHU, atk: 2, hp: 5, keywords: [] });
state.battlefield.support[FACTIONS.WEI].slots = [chargeAttacker];
state.battlefield.support[FACTIONS.SHU].slots = [normalDef];

const chargeResult = resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: chargeAttacker.instanceId, targetId: normalDef.instanceId }
});
check(chargeResult.chargeImmunity === true, 'Charge grants counter-immunity on first attack');
check(!chargeAttacker.keywords.includes('冲阵'), 'Charge keyword is consumed and removed after attack');

// 4.4 坚阵X (Fortified) Combat Damage Reduction
const fortifyDefender = createCard({ name: '曹仁', faction: FACTIONS.SHU, atk: 2, hp: 5, keywords: ['坚阵2'] });
const attacker4 = createCard({ name: '步卒', faction: FACTIONS.WEI, atk: 4, hp: 4, actionCost: 1, keywords: [] });
state.battlefield.support[FACTIONS.SHU].slots = [fortifyDefender];
state.battlefield.support[FACTIONS.WEI].slots = [attacker4];

const fortifyResult = resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: attacker4.instanceId, targetId: fortifyDefender.instanceId }
});
check(fortifyResult.damageDealt === 2, '坚阵2 reduces 4 attack damage down to 2 (4 - 2 = 2)');

// 4.5 矢石 (Archery) Counter Exclusivity
const archerAttacker = createCard({ name: '弓手', faction: FACTIONS.WEI, atk: 3, hp: 3, actionCost: 1, keywords: ['矢石'] });
const nonArcherDefender = createCard({ name: '刀兵', faction: FACTIONS.SHU, atk: 3, hp: 4, keywords: [] });
state.battlefield.support[FACTIONS.WEI].slots = [archerAttacker];
state.battlefield.support[FACTIONS.SHU].slots = [nonArcherDefender];

const archerResult = resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: archerAttacker.instanceId, targetId: nonArcherDefender.instanceId }
});
check(archerResult.counterDealt === 0, 'Non-archery unit cannot counterattack archery unit');

// 4.6 火攻 (Fire Attack) Splash Chain Bypassing 坚阵
const fireAttacker = createCard({ name: '火攻兵', faction: FACTIONS.WEI, atk: 3, hp: 3, actionCost: 1, keywords: ['火攻'] });
const targetUnit = createCard({ name: '前锋', faction: FACTIONS.SHU, atk: 1, hp: 2, keywords: [] });
const adjacentFortified = createCard({ name: '重甲护卫', faction: FACTIONS.SHU, atk: 1, hp: 4, keywords: ['坚阵2'] });
state.battlefield.frontline.LEFT.occupant = FACTIONS.SHU;
state.battlefield.frontline.LEFT.units = [targetUnit, adjacentFortified];
state.battlefield.support[FACTIONS.WEI].slots = [fireAttacker];

resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: fireAttacker.instanceId, targetId: targetUnit.instanceId }
});
check(adjacentFortified.hp === 1, '火攻 splash damage (3) completely ignores 坚阵2 (4 - 3 = 1 HP remaining)');

// 4.7 Survival Validity Law (存活生效律): 曹操 归心
const caoCao = createCard({ name: '曹操', faction: FACTIONS.WEI, atk: 4, hp: 2, actionCost: 1, keywords: ['归心'] });
const lethalEnemy = createCard({ name: '死士', faction: FACTIONS.SHU, atk: 4, hp: 2, keywords: [] });
state.battlefield.support[FACTIONS.WEI].slots = [caoCao];
state.battlefield.support[FACTIONS.SHU].slots = [lethalEnemy];
pWei.deck = [createCard({ name: '测试牌' })];
const handCountBefore = pWei.hand.length;

resolveCombat(state, {
  type: 'ATTACK',
  playerId: FACTIONS.WEI,
  payload: { attackerId: caoCao.instanceId, targetId: lethalEnemy.instanceId }
});
check(pWei.hand.length === handCountBefore, '曹操 归心 does NOT draw a card when Cao Cao dies simultaneously in combat');

// 4.8 Status Effects: 压制 (Suppression) & 抑制 (Inhibition)
const testUnit = createCard({ name: '精锐', atk: 4, hp: 5, cost: 3, keywords: ['守护', '坚阵1'] });
applySuppression(testUnit, 2);
check(testUnit.status.suppressed === true, 'applySuppression sets suppressed status');

// Inhibition purges all traits, resets to vanilla base stats, and clears suppression
applyInhibition(testUnit);
check(testUnit.status.inhibited === true, 'applyInhibition sets inhibited status');
check(testUnit.status.suppressed === false, 'applyInhibition purges suppression');
check(testUnit.keywords.length === 0, 'applyInhibition strips all keywords');
check(testUnit.atk === testUnit.baseAtk, 'applyInhibition resets atk to printed base');

// Re-inhibition immunity
const reInhibitSuccess = applyInhibition(testUnit);
check(reInhibitSuccess === false, 'Unit is immune to re-inhibition before receiving a new card buff');

// ============================================================================
// Suite 5: Master Action Dispatcher & RulesEngine Orchestrator
// ============================================================================
console.log('\n[Suite 5] Master Action Dispatcher & RulesEngine Orchestrator');

const matchState = createInitialState();
matchState.phase = PHASES.ACTION;
matchState.activePlayer = FACTIONS.WEI;
matchState.players[FACTIONS.WEI].provisions = 10;
matchState.players[FACTIONS.WEI].prestige = 1;

// Deploy with dynamic prestige discount
const deployCard = createCard({ name: '虎豹骑', faction: FACTIONS.WEI, cost: 4, type: 'UNIT', keywords: ['突袭'] });
matchState.players[FACTIONS.WEI].hand.push(deployCard);

const deployRes = dispatch(matchState, {
  type: 'DEPLOY',
  playerId: FACTIONS.WEI,
  payload: { cardInstanceId: deployCard.instanceId, targetZone: 'SUPPORT' }
});
check(deployRes.cost === 3, 'Prestige 1 grants 1 provision discount (4 - 1 = 3)');
check(deployRes.discountApplied === 1, 'Records 1 discount applied');
check(matchState.players[FACTIONS.WEI].provisions === 7, 'Provisions correctly deducted');

// Frontline Advance
const moveRes = dispatch(matchState, {
  type: 'MOVE',
  playerId: FACTIONS.WEI,
  payload: { cardInstanceId: deployCard.instanceId, targetZone: 'FRONTLINE_CENTER' }
});
check(moveRes.success === true, 'Advance from Support to Frontline succeeds');
check(matchState.battlefield.frontline.CENTER.occupant === FACTIONS.WEI, 'Frontline zone occupied by Wei');

// Illegal direct lateral move from LEFT to RIGHT
assert.throws(() => {
  matchState.battlefield.frontline.LEFT.units = [createCard({ name: '测试' })];
  matchState.battlefield.frontline.LEFT.occupant = FACTIONS.WEI;
  dispatch(matchState, {
    type: 'MOVE',
    playerId: FACTIONS.WEI,
    payload: { cardInstanceId: matchState.battlefield.frontline.LEFT.units[0].instanceId, targetZone: 'FRONTLINE_RIGHT' }
  });
}, /Invalid lateral move from LEFT to RIGHT/);
check(true, 'Direct lateral move LEFT to RIGHT is strictly blocked');

// Action Validation helper
const legalValidation = validateAction(matchState, {
  type: 'END_TURN',
  playerId: FACTIONS.WEI
});
check(legalValidation.valid === true, 'validateAction confirms valid action');

// RulesEngine class subscription & event streaming
const engine = new RulesEngine({ autoInit: true });
let eventEmitted = false;
engine.subscribe(e => {
  if (e.type === 'ACTION_RESOLVED') eventEmitted = true;
});
engine.dispatch({ type: 'END_TURN', playerId: FACTIONS.WEI });
check(eventEmitted === true, 'RulesEngine class emits events on action dispatch');

console.log('\n' + '='.repeat(80));
console.log('             MILESTONE 2 DIRECT ENGINE VERIFICATION SUMMARY');
console.log('='.repeat(80));
console.log(`  Total Module Assertions Verified : ${assertionsRun}`);
console.log(`  Engine Status                    : ALL 5 PRODUCTION MODULES PASSED 100%`);
console.log('='.repeat(80));
