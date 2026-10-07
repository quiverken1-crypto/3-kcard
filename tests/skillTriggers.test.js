import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createCard, getLegalActions, dispatch, findUnit } from '../js/engine/rulesEngine.js';
import { getTacticTargets, hqDamageAfterSkills, afterAttack } from '../js/engine/cardSkills.js';
import { InteractionController } from '../js/ui/interaction.js';

// 卡面（实体卡）：控制1个花费不大于3或有二心的敌军
test('策反 targets enemies costing 3 or less, or with 二心, and skips expensive ones', () => {
  const state = createInitialState();
  const tactic = createCard({ cardId: 'wei_ce_fan', type: 'TACTIC', cost: 4 });
  const cheap = createCard({ cardId: 'shu_test_cheap', faction: 'SHU', cost: 3 });
  const traitor = createCard({ cardId: 'shu_test_traitor', faction: 'SHU', cost: 6, badges: ['二心'] });
  const expensive = createCard({ cardId: 'shu_test_expensive', faction: 'SHU', cost: 5, troopType: 'CAVALRY' });
  state.battlefield.support.SHU.slots.push(cheap, traitor, expensive);
  const targets = getTacticTargets(state, 'WEI', tactic);
  assert.ok(targets.some(unit => unit.instanceId === cheap.instanceId));
  assert.ok(targets.some(unit => unit.instanceId === traitor.instanceId));
  assert.ok(!targets.some(unit => unit.instanceId === expensive.instanceId));
});

// 卡面：每有1个战力不小于4的友军，己方主城受到伤害-1
test('李典 reduces HQ damage by 1 for each ally with 4+ attack', () => {
  const state = createInitialState();
  state.battlefield.support.WEI.slots.push(
    createCard({ cardId: 'wei_li_dian', atk: 2 }),
    createCard({ cardId: 'wei_ally_a', atk: 4 }),
    createCard({ cardId: 'wei_ally_b', atk: 5 })
  );
  assert.equal(hqDamageAfterSkills(state, 'WEI', 3), 1);
});

// 卡面：击败敌军时，使对手下回合损失等同于溢出伤害的粮草
test('徐晃劫粮 makes the opponent lose overflow provisions next turn', () => {
  const state = createInitialState();
  const xu = createCard({ cardId: 'wei_xu_huang', faction: 'WEI' });
  const enemy = createCard({ cardId: 'shu_enemy', faction: 'SHU', hp: 1 });
  enemy.hp = -2;
  state.battlefield.support.WEI.slots.push(xu);
  state.players.SHU.provisions = 5;
  afterAttack(state, xu, enemy, { defenderDied: true, damageDealt: 3 }, false);
  assert.equal(state.players.SHU.provisions, 5);
  assert.equal(state.players.SHU.provisionPenalty, 2);
});

function swapState() {
  const state = createInitialState();
  state.phase = 'ACTION';
  state.activePlayer = 'SHU';
  state.players.SHU.provisions = 3;
  const bai = createCard({ cardId: 'shu_bai_er_jun', faction: 'SHU', actionCost: 1 });
  state.battlefield.support.SHU.slots.push(bai);
  const zone = state.battlefield.frontline.CENTER;
  zone.occupant = 'SHU';
  zone.units = Array.from({ length: zone.capacity }, (_, index) => createCard({ cardId: `shu_ally_${index}`, faction: 'SHU' }));
  return { state, bai, zone };
}

test('白毦军 can select a full friendly zone and perform its swap', () => {
  const { state, bai, zone } = swapState();
  const controller = new InteractionController();
  controller.gameState = state;
  controller.localPlayerId = 'SHU';
  controller._computeUnitLegalTargets(bai, findUnit(state, bai.instanceId));
  assert.ok(controller.legalMoveTargets.includes('FRONTLINE_CENTER'));
  assert.ok(getLegalActions(state, 'SHU').some(a => a.type === 'MOVE' && a.payload.cardInstanceId === bai.instanceId && a.payload.targetZone === 'FRONTLINE_CENTER'));
  const swapped = zone.units.at(-1);
  dispatch(state, { type: 'MOVE', playerId: 'SHU', payload: { cardInstanceId: bai.instanceId, targetZone: 'FRONTLINE_CENTER' } });
  assert.ok(zone.units.includes(bai));
  assert.ok(state.battlefield.support.SHU.slots.includes(swapped));
});

test('聚众 is lost after taking combat or skill damage, and no longer grows', async () => {
  const { damageUnit } = await import('../js/engine/cardSkills.js');
  const { resolveCombat } = await import('../js/engine/combat.js');
  const state = createInitialState();
  state.phase = 'ACTION';
  state.activePlayer = 'WEI';
  state.players.WEI.provisions = 10;
  const a = createCard({ cardId: 'hj_huang_jin_jun', faction: 'SHU', atk: 1, hp: 5, keywords: ['聚众'] });
  const b = createCard({ cardId: 'hj_zhang_niu_jiao', faction: 'SHU', atk: 2, hp: 5, keywords: ['聚众'] });
  state.battlefield.support.SHU.slots.push(a, b);
  damageUnit(state, a, 1, 'test');
  assert.ok(!a.keywords.includes('聚众'));
  const attacker = createCard({ cardId: 'wei_test_sm', faction: 'WEI', atk: 1, hp: 9, troopType: 'STRATEGIST' });
  state.battlefield.support.WEI.slots.push(attacker);
  resolveCombat(state, { playerId: 'WEI', payload: { attackerId: attacker.instanceId, targetId: b.instanceId } });
  assert.ok(!b.keywords.includes('聚众'));
});

test('庞德·猛进 still grants 突袭 after units are returned by 云屯鸟散 and redeployed', async () => {
  const { RulesEngine } = await import('../js/engine/rulesEngine.js');
  const { startTurn, createCard: mk } = await import('../js/engine/state.js');
  const { DB_CARD_MAP } = await import('../js/data/cardDB.js');
  const re = new RulesEngine({ autoInit: true, seed: 1, weiKingdom: 'xl', shuKingdom: 'shu', firstPlayer: 'WEI' });
  const s = re.state; if (s.phase === 'MULLIGAN') startTurn(s, 'WEI');
  s.players.WEI.provisions = 60; s.players.WEI.hand.length = 0;
  for (const k of ['LEFT', 'CENTER', 'RIGHT']) s.battlefield.frontline[k].terrain = { type: 'PLAIN', name: '平原', capacity: 3 };
  const add = id => { const c = mk(DB_CARD_MAP[id], { faction: 'WEI', kingdom: 'xl' }); s.players.WEI.hand.push(c); return c; };
  const foe = mk({ cardId: 'shu_x', faction: 'SHU', atk: 0, hp: 30, keywords: ['伏击'] }); s.battlefield.support.SHU.slots.push(foe);
  const pd = add('xl_pang_de'), mw = add('xl_ma_wan');
  const D = c => re.dispatch({ type: 'DEPLOY', playerId: 'WEI', payload: { cardInstanceId: c.instanceId, targetZone: 'SUPPORT' } });
  D(pd); D(mw);
  for (const c of [pd, mw]) { re.dispatch({ type: 'MOVE', playerId: 'WEI', payload: { cardInstanceId: c.instanceId, targetZone: 'FRONTLINE_CENTER' } }); re.dispatch({ type: 'ATTACK', playerId: 'WEI', payload: { attackerId: c.instanceId, targetId: foe.instanceId } }); }
  re.dispatch({ type: 'PLAY_TACTIC', playerId: 'WEI', payload: { cardInstanceId: add('xl_yun_tun').instanceId } });
  D(pd); D(mw);
  assert.ok(mw.keywords.includes('突袭'));
  assert.equal(mw.status.actionsUsed, 0);
});

test('李文侯·合势 buff is removed cleanly when an ally returns to hand (no -1-1)', async () => {
  const { RulesEngine } = await import('../js/engine/rulesEngine.js');
  const { startTurn, createCard: mk } = await import('../js/engine/state.js');
  const { DB_CARD_MAP } = await import('../js/data/cardDB.js');
  const SK = await import('../js/engine/cardSkills.js');
  const re = new RulesEngine({ autoInit: true, seed: 1, weiKingdom: 'xl', shuKingdom: 'shu', firstPlayer: 'WEI' });
  const s = re.state; if (s.phase === 'MULLIGAN') startTurn(s, 'WEI');
  s.players.WEI.provisions = 60; s.players.WEI.hand.length = 0;
  const add = id => { const c = mk(DB_CARD_MAP[id], { faction: 'WEI', kingdom: 'xl' }); s.players.WEI.hand.push(c); return c; };
  const D = c => { re.dispatch({ type: 'DEPLOY', playerId: 'WEI', payload: { cardInstanceId: c.instanceId, targetZone: 'SUPPORT' } }); while (s.players.WEI.pendingChoices?.length) SK.resolveChoice(s, 'WEI', { targetId: 'HQ' }); };
  const lw = add('xl_li_wen_hou'), mw = add('xl_ma_wan');
  D(lw); D(mw);
  assert.equal(mw.atk, 2);
  SK.retreatUnit(s, mw, 'test');
  assert.equal(mw.atk, 1);
  D(mw);
  assert.equal(mw.atk, 2);
  SK.retreatUnit(s, mw, 'test'); SK.retreatUnit(s, lw, 'test');
  D(mw);
  assert.equal(mw.atk, 1);
  assert.equal(mw.hp, 2);
});

test('游击 evades only the first attack of the enemy turn, and an evaded hit applies no suppression', async () => {
  const { createInitialState: init, createCard: mk } = await import('../js/engine/state.js');
  const { resolveCombat } = await import('../js/engine/combat.js');
  const { afterAttack } = await import('../js/engine/cardSkills.js');
  const s = init(); s.phase = 'ACTION'; s.activePlayer = 'WEI'; s.players.WEI.provisions = 30;
  for (const k of ['LEFT', 'CENTER', 'RIGHT']) s.battlefield.frontline[k].terrain = { type: 'PLAIN', name: '平原', capacity: 3 };
  const atk = (n, id = 'wei_a') => { const a = mk({ cardId: id, faction: 'WEI', atk: n, hp: 9 }); s.battlefield.frontline.CENTER.units.push(a); s.battlefield.frontline.CENTER.occupant = 'WEI'; return a; };
  // 第一次就致命：撤退成功，且白马义从的压制不生效
  const g1 = mk({ cardId: 'shu_g1', faction: 'SHU', atk: 0, hp: 2, keywords: ['游击'] });
  s.battlefield.frontline.LEFT.units.push(g1); s.battlefield.frontline.LEFT.occupant = 'SHU';
  const bm = atk(3, 'gsz_bai_ma_yi_cong');
  const r = resolveCombat(s, { playerId: 'WEI', payload: { attackerId: bm.instanceId, targetId: g1.instanceId } });
  afterAttack(s, bm, g1, r, false);
  assert.ok(r.evaded);
  assert.ok(s.battlefield.support.SHU.slots.includes(g1));
  assert.ok(!g1.status.suppressed);
  // 第一次不致命：之后的致命攻击不能再游击
  const g2 = mk({ cardId: 'shu_g2', faction: 'SHU', atk: 0, hp: 5, keywords: ['游击'] });
  s.battlefield.frontline.RIGHT.units.push(g2); s.battlefield.frontline.RIGHT.occupant = 'SHU';
  const r1 = resolveCombat(s, { playerId: 'WEI', payload: { attackerId: atk(2).instanceId, targetId: g2.instanceId } });
  assert.ok(!r1.evaded);
  const r2 = resolveCombat(s, { playerId: 'WEI', payload: { attackerId: atk(9).instanceId, targetId: g2.instanceId } });
  assert.ok(!r2.evaded && r2.defenderDied);
});
