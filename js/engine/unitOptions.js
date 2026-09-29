/**
 * unitOptions.js — 单位当前“真正能做什么”的实时判定（界面高亮、选中提示共用）。
 * 与 rulesEngine 的 MOVE 校验、combat.validateAttack 保持一致。
 */
import { KEYWORDS, STATUS_TYPES, hasKeyword } from './constants.js';
import { findUnit } from './state.js';
import { getValidTargets } from './combat.js';
import { getActionCost, actsLikeCavalry, baseId, getActiveSkill, activeSkillBlockReason } from './cardSkills.js';

/** 该单位本回合还能移动到的区域：['FRONTLINE_LEFT', ..., 'SUPPORT'] */
export function getUnitMoveZones(state, unit, loc = null) {
  loc ||= findUnit(state, unit?.instanceId);
  const bf = state?.battlefield;
  if (!unit || !loc || !bf) return [];
  const owner = unit.faction;
  const st = unit.status || {};
  if (st[STATUS_TYPES.SUPPRESSED]) return [];
  const player = state.players?.[owner];
  if (player && player.provisions < getActionCost(state, unit, loc)) return [];
  const cav = actsLikeCavalry(state, unit, loc);
  if (cav) {
    if (st[STATUS_TYPES.MOVED_THIS_TURN]) return [];
    if (st[STATUS_TYPES.DEPLOYED_THIS_TURN] && !hasKeyword(unit, KEYWORDS.TU_XI)) return [];
  } else if ((st[STATUS_TYPES.ACTIONS_USED] || 0) > 0) return [];

  const canSwap = baseId(unit.cardId) === 'shu_bai_er_jun' && !st[STATUS_TYPES.INHIBITED];
  const enterable = zk => {
    const z = bf.frontline?.[zk];
    if (!z || (z.occupant !== null && z.occupant !== owner)) return false;
    return z.units.length < z.capacity || (canSwap && z.occupant === owner);
  };
  const out = [];
  if (loc.zoneType === 'SUPPORT') {
    for (const zk of ['LEFT', 'CENTER', 'RIGHT']) if (enterable(zk)) out.push(`FRONTLINE_${zk}`);
  } else if (loc.zoneType === 'FRONTLINE') {
    const adj = loc.zoneKey === 'CENTER' ? ['LEFT', 'RIGHT'] : ['CENTER'];
    for (const zk of adj) if (enterable(zk)) out.push(`FRONTLINE_${zk}`);
    if (hasKeyword(unit, KEYWORDS.YOU_JI) && (bf.support?.[owner]?.slots?.length || 0) < 4) out.push('SUPPORT');
  }
  return out;
}

/** 该单位本回合还能攻击的目标 */
export function getUnitAttackTargets(state, unit) {
  if (!unit || state?.activePlayer !== unit.faction) return [];
  try { return getValidTargets(state, unit.instanceId); } catch { return []; }
}

/** 实时判定：还有至少一个有效的移动或攻击 */
export function unitHasUsefulAction(state, unit) {
  if (!state || !unit || state.activePlayer !== unit.faction || state.phase !== 'ACTION') return false;
  const loc = findUnit(state, unit.instanceId);
  if (!loc) return false;
  if (getActiveSkill(unit) && !activeSkillBlockReason(state, unit)) return true;
  return getUnitMoveZones(state, unit, loc).length > 0 || getUnitAttackTargets(state, unit).length > 0;
}
