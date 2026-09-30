/**
 * preview.js — 行动预演：在状态副本上真正执行一次行动，比较前后的血量，
 * 得到“造成伤害 / 被反击伤害 / 双方剩余血量 / 是否击败”。与实际结算完全一致。
 */
import { dispatch } from './rulesEngine.js';
import { findUnit, getAllUnits } from './state.js';
import { STATUS_TYPES } from './constants.js';

function cloneForPreview(state) {
  // 战报会越打越长，预演用不到：不复制（否则后期每次指向目标都要拷贝整份战报，拖动明显卡）
  const { prng, combatLog, ...rest } = state;
  const c = structuredClone(rest);
  c.combatLog = [];
  c.prng = prng && typeof prng.clone === 'function' ? prng.clone() : prng;
  return c;
}

function snapshot(state) {
  const units = new Map();
  for (const pid of ['WEI', 'SHU']) {
    for (const u of getAllUnits(state, pid)) units.set(u.instanceId, { hp: u.hp, name: u.name, faction: u.faction });
  }
  const hq = {};
  for (const pid of ['WEI', 'SHU']) hq[pid] = state.players?.[pid]?.hp ?? 0;
  return { units, hq };
}

/**
 * @returns {null | { units: {id,name,faction,before,after,dead}[], hq: {pid,before,after}[] }}
 */
export function previewAction(state, action) {
  if (!state?.players?.WEI?.deck || !Array.isArray(state.players.WEI.deck)) return null; // 联机客机的遮蔽状态无法预演
  let sim;
  try {
    sim = cloneForPreview(state);
    // 不泄露对手的暗牌信息：预演时忽略对方已设下的反制
    sim.activeCounters = (sim.activeCounters || []).filter(c => c.owner === action.playerId);
    const before = snapshot(sim);
    dispatch(sim, action);
    const after = snapshot(sim);
    const units = [];
    for (const [id, b] of before.units) {
      const a = after.units.get(id);
      if (!a) {
        const inHand = ['WEI', 'SHU'].some(p => sim.players[p].hand.some(c => c.instanceId === id));
        units.push({ id, name: b.name, faction: b.faction, before: b.hp, after: inHand ? b.hp : 0, dead: !inHand, returned: inHand });
      }
      else if (a.hp !== b.hp) units.push({ id, name: b.name, faction: b.faction, before: b.hp, after: a.hp, dead: a.hp <= 0 });
    }
    const hq = ['WEI', 'SHU'].filter(p => before.hq[p] !== after.hq[p]).map(p => ({ pid: p, before: before.hq[p], after: Math.max(0, after.hq[p]) }));
    return { units, hq, gameOver: sim.phase === 'GAME_OVER' ? sim.winner : null };
  } catch {
    return null;
  }
}

/** 攻击的简易估算（无法预演时的兜底：联机客机） */
export function estimateAttack(state, attackerId, targetId) {
  const a = findUnit(state, attackerId)?.unit;
  if (!a) return null;
  if (targetId === 'HQ') {
    const opp = a.faction === 'WEI' ? 'SHU' : 'WEI';
    const hp = state.players?.[opp]?.hp ?? 0;
    return { units: [], hq: [{ pid: opp, before: hp, after: Math.max(0, hp - a.atk) }], estimate: true };
  }
  const d = findUnit(state, targetId)?.unit;
  if (!d || d.status?.[STATUS_TYPES.IS_FACE_DOWN]) return null;
  const dAfter = d.hp - a.atk;
  const aAfter = a.hp - d.atk;
  const units = [{ id: d.instanceId, name: d.name, faction: d.faction, before: d.hp, after: Math.max(0, dAfter), dead: dAfter <= 0 }];
  if (d.atk > 0) units.push({ id: a.instanceId, name: a.name, faction: a.faction, before: a.hp, after: Math.max(0, aAfter), dead: aAfter <= 0 });
  return { units, hq: [], estimate: true };
}
