/**
 * factions2.js — 袁绍 / 黄巾 / 董卓 / 西凉（马腾）/ 刘表 / 袁术 六家的武将技能、战法、反制
 * （另含魏“奇船避箭”、蜀“三顾茅庐”“诸葛亮（草庐）”）
 *
 * 全部通过 cardSkills.js 的开放注册表与扩展点（EXT / PLUGIN_HOOKS / DEPLOY_SKILLS / TACTICS / COUNTERS / CHOICE_SPECS）挂载，
 * 不改核心流程。本模块只定义函数，由 cardSkills.js 在自身初始化完成后调用 installFactions2()。
 * 想给这些势力改技能 / 加新卡，照着这里的写法即可。
 */

import { FACTIONS, STATUS_TYPES, TROOP_TYPES, GAME_CONFIG, hasKeyword } from './constants.js';
import { drawCard, getAllUnits, findUnit, removeUnitFromBoard, createCard, adjustPrestige, PRESTIGE_OVERFLOW_HOOKS } from './state.js';
import {
  EXT, PLUGIN_HOOKS, DEPLOY_SKILLS, DEPLOY_TARGETS, TACTICS, COUNTERS, CHOICE_SPECS, ACTIVE_SKILLS, triggerCounters, discardRandom, extRun,
  queueChoice, chosenOr, buff, damageUnit, damageHq, healHq, suppressUnit, retreatUnit, log, searchDeck, putInHand,
  applyInhibitionLocal, adjacentUnits, canSkillTarget, canTargetEnemy, canBeSuppressed, baseId, opp, isId,
  applyEnterKeywords, onUnitEnter, resetCardState, getAttackValue, unitTerrain, effectiveTroop
} from './cardSkills.js';
import { DB_CARD_MAP } from '../data/cardDB.js';

// ------------------------------------------------------------------ 工具
const active = u => Boolean(u) && !u.status?.[STATUS_TYPES.INHIBITED];
const onBoard = (state, u) => Boolean(u && findUnit(state, u.instanceId));
const ownWith = (state, pid, id) => getAllUnits(state, pid).filter(u => isId(u, id));
const countOf = (state, pid, id) => ownWith(state, pid, id).length;
const hasBadge = (u, b) => Array.isArray(u?.badges) && u.badges.includes(b);
const kingdomOf = u => u?.kingdom || String(baseId(u?.cardId)).split('_')[0];
const isXL = u => kingdomOf(u) === 'xl';
const isHJJ = u => baseId(u?.cardId) === 'hj_huang_jin_jun';
const isStrategist = (state, u) => effectiveTroop(state, u) === TROOP_TYPES.STRATEGIST;
const MAX_SUPPORT = GAME_CONFIG.MAX_SUPPORT_UNITS || 4;
const ZONES = ['LEFT', 'CENTER', 'RIGHT'];
const FEMALE = /夫人|孙尚香|貂蝉|甄|大乔|小乔|祝融|黄月英|蔡文姬|步练师|王异|吴国太/;
const fxOf = (state, pid) => { state.turnEffects ||= { WEI: {}, SHU: {} }; return (state.turnEffects[pid] ||= {}); };
const meta = p => { p.provisionPenalty ||= 0; p.reserve ||= []; return p; };
const byValueDesc = (a, b) => ((b.cost || 0) - (a.cost || 0)) || ((b.atk || 0) - (a.atk || 0));

function inhibit(state, unit, source) {
  if (!onBoard(state, unit) || unit.status?.[STATUS_TYPES.INHIBITED]) return false;
  applyInhibitionLocal(unit);
  unit.status[STATUS_TYPES.SUPPRESSED] = false;
  log(state, opp(unit.faction), `${source}：【${unit.name}】被抑制`);
  return true;
}

/** 卡面没写“随机”的选择一律交给相应一方的玩家（对方回合触发也一样，AI 自动选） */
function pickOrQueue(state, pid, kind, source, list, extra = {}) {
  list = list.filter(Boolean);
  if (!list.length) return;
  queueChoice(state, pid, kind, source, list, extra);
}
/** 选择“己方1个目标”（单位或主城）：相攻、误策 */
function queueOwnTarget(state, pid, amount, source) {
  const opts = [...getAllUnits(state, pid).map(u => ({ instanceId: u.instanceId, name: `${u.name} ${u.atk}/${u.hp}` })), { instanceId: 'HQ', name: `己方主城（${state.players[pid].hp}）` }];
  queueChoice(state, pid, 'f2OwnTarget', null, opts, { amount, source, prompt: `选择1个己方目标，受到${amount}点伤害` });
}

/** 生成一张新卡（黄巾军等衍生单位） */
function makeCard(state, pid, cardId) {
  const def = DB_CARD_MAP[cardId];
  if (!def) return null;
  state._tokSeq = (state._tokSeq || 0) + 1;
  return createCard(def, { faction: pid, kingdom: def.kingdom, instanceId: `tok_${state.turnNumber}_${state._tokSeq}` });
}

/** 把卡放上战场：where = 'FRONT'（优先前线）/ 'SUPPORT' / { zoneKey } / { support: true } */
function placeUnit(state, pid, card, where = 'SUPPORT', { rush = false } = {}) {
  if (!card) return false;
  const support = state.battlefield.support[pid].slots;
  let placed = false;
  const tryZone = zk => {
    const z = state.battlefield.frontline[zk];
    if (!z || z.units.length >= z.capacity || (z.occupant !== null && z.occupant !== pid)) return false;
    z.units.push(card); z.occupant = pid; return true;
  };
  if (where === 'FRONT') {
    const zs = [...ZONES].sort((a, b) => (state.battlefield.frontline[b].occupant === pid) - (state.battlefield.frontline[a].occupant === pid));
    placed = zs.some(tryZone);
  } else if (where && where.zoneKey) placed = tryZone(where.zoneKey);
  if (!placed && support.length < MAX_SUPPORT && (where === 'FRONT' || where === 'SUPPORT' || where?.support)) { support.push(card); placed = true; }
  if (!placed) return false;
  card.faction = pid;
  card.status[STATUS_TYPES.DEPLOYED_THIS_TURN] = true;
  if (rush && !card.keywords.includes('突袭')) card.keywords.push('突袭');
  card.status[STATUS_TYPES.ACTIONS_USED] = hasKeyword(card, '突袭') ? 0 : 1;
  applyEnterKeywords(state, card, pid);
  onUnitEnter(state, card);
  return true;
}

function returnToHand(state, unit, source) {
  if (!onBoard(state, unit)) return;
  removeUnitFromBoard(state, unit.instanceId, true, { silent: true });
  resetCardState(unit);
  const owner = unit.originalFaction || unit.faction;
  unit.faction = owner;
  putInHand(state, owner, unit);
  log(state, owner, `${source}：【${unit.name}】返回手牌`);
}

function raiseCap(state, pid, n) {
  const p = state.players[pid];
  p.extraGranaryCap = (p.extraGranaryCap || 0) + n;
  p.provisionsCap = Math.max(1, p.mainGranaryCap + p.extraGranaryCap);
  p.provisions = Math.min(p.provisions, p.provisionsCap);
}

/** 失去粮草上限（袁术·伪帝、舒邵·赈济、淮南军会响应） */
function loseCap(state, pid, n = 1, source = '') {
  if (n <= 0) return;
  raiseCap(state, pid, -n);
  log(state, pid, `${source ? source + '：' : ''}粮草上限-${n}`);
  for (const _ of ownWith(state, pid, 'yshu_yuan_shu')) { state.players[pid].provisions += 3 * n; log(state, pid, `袁术·伪帝：获得${3 * n}粮草`); }
  for (const _ of ownWith(state, pid, 'yshu_shu_shao')) { adjustPrestige(state, pid, n); log(state, pid, `舒邵·赈济：声望+${n}`); }
  for (const u of ownWith(state, pid, 'yshu_huai_nan')) { buff(u, n, n); log(state, pid, `淮南军：+${n}+${n}`); }
}

/** 从手牌弃1张（会触发弃军、截众、汝南亲卫） */
function discardFromHand(state, pid, card, reason = '弃牌') {
  const p = state.players[pid];
  const i = p.hand.indexOf(card);
  if (i === -1) return false;
  p.hand.splice(i, 1);
  p.discard.push(card);
  log(state, pid, `${reason}：弃置【${card.name}】`);
  extRun('discard', state, pid, card);
  return true;
}
const QI_JUN_IDS = ['yshu_li_feng', 'yshu_yue_jiu', 'yshu_liang_gang'];
/** 自动挑一张要弃的手牌：优先【弃军】牌，其次趁火打劫，再其次最低费 */
function pickDiscard(hand) {
  return hand.find(c => QI_JUN_IDS.includes(baseId(c.cardId))) || hand.find(c => baseId(c.cardId) === 'yshu_chen_huo')
    || [...hand].sort((a, b) => (a.cost || 0) - (b.cost || 0))[0];
}
function onDiscard(state, pid, card) {
  if ((state._discardDepth || 0) > 4) return;
  state._discardDepth = (state._discardDepth || 0) + 1;
  try {
    if (card && QI_JUN_IDS.includes(baseId(card.cardId))) { drawCard(state, pid); drawCard(state, pid); log(state, pid, `${card.name}·弃军：抽2张牌`); }
    for (const _ of ownWith(state, pid, 'yshu_liu_xun')) discardRandom(state, opp(pid), 1, '刘勋·截众');
    for (const _ of ownWith(state, pid, 'yshu_ru_nan')) {
      for (const e of [...getAllUnits(state, opp(pid))]) damageUnit(state, e, 1, '汝南亲卫');
      log(state, pid, '汝南亲卫：对所有敌军造成1伤害');
    }
  } finally { state._discardDepth -= 1; }
}
const occupied = (state, pid) => ZONES.filter(zk => state.battlefield.frontline[zk].occupant === pid && state.battlefield.frontline[zk].units.length).length;

function controlUnit(state, owner, target, source) {
  const support = state.battlefield.support[owner].slots;
  if (!onBoard(state, target) || support.length >= MAX_SUPPORT) return;
  removeUnitFromBoard(state, target.instanceId, true, { silent: true });
  target.originalFaction = owner;
  target.faction = owner;
  Object.assign(target.status, { actionsUsed: 1, movedThisTurn: false, attackedThisTurn: false, attacksThisTurn: 0, deployedThisTurn: true, suppressed: false });
  support.push(target);
  applyEnterKeywords(state, target, owner);
  log(state, owner, `${source}：【${target.name}】归入麾下`);
}

// ------------------------------------------------------------------ 选择
const CHOICES = {
  f2OwnTarget: {
    source: '技能', prompt: '选择1个己方目标', pool: 'option',
    auto: (list, state, pid) => (state.players[pid].hp > 10 ? list.find(o => o.instanceId === 'HQ') : null)
      || [...list].filter(o => o.instanceId !== 'HQ').map(o => findUnit(state, o.instanceId)?.unit).filter(Boolean).sort((a, b) => b.hp - a.hp).map(u => list.find(o => o.instanceId === u.instanceId))[0] || list[0],
    apply(state, pid, opt, c = {}) {
      if (opt.instanceId === 'HQ') { damageHq(state, pid, c.amount || 2, c.source || '技能', { noRedirect: true }); return; }
      const u = findUnit(state, opt.instanceId)?.unit;
      if (u) damageUnit(state, u, c.amount || 2, c.source || '技能');
    }
  },
  f2Discard: {
    source: '弃牌', prompt: '选择弃置1张手牌', pool: 'hand',
    auto: list => pickDiscard(list),
    apply(state, pid, card, c = {}) { discardFromHand(state, pid, card, c.source || '弃牌'); }
  },
  f2Sacrifice: {
    source: '技能', prompt: '选择己方1个单位承受效果', pool: 'board',
    auto: list => [...list].sort((a, b) => ((a.cost || 0) - (b.cost || 0)) || (b.hp - a.hp))[0],
    apply(state, pid, t, c = {}) {
      const src = c.source || '技能';
      if (c.destroy) {
        const cav = t.troopType === TROOP_TYPES.CAVALRY;
        removeUnitFromBoard(state, t.instanceId);
        log(state, pid, `${src}：交出【${t.name}】`);
        if (cav && c.drawIfCav) { drawCard(state, opp(pid)); log(state, opp(pid), `${src}：是马军，摸1张牌`); }
        return;
      }
      if (c.amount) damageUnit(state, t, c.amount, src);
      if (c.inhibit) inhibit(state, t, src);
    }
  },
  f2ZhongZhong: {
    source: '冢中枯骨', prompt: '可弃1张手牌，使阵亡单位返回手牌', pool: 'option',
    auto: list => list.find(o => o.instanceId !== 'skip') || list[0],
    apply(state, pid, opt, c = {}) {
      if (opt.instanceId === 'skip') { log(state, pid, '冢中枯骨：放弃'); return; }
      const p = state.players[pid];
      const card = p.hand.find(x => x.instanceId === opt.instanceId);
      if (!card) return;
      discardFromHand(state, pid, card, '冢中枯骨');
      for (const pl of [p, state.players[opp(pid)]]) {
        const i = pl.discard.findIndex(x => x.instanceId === c.unitId);
        if (i === -1) continue;
        const [u] = pl.discard.splice(i, 1);
        resetCardState(u);
        u.faction = pid;
        putInHand(state, pid, u);
        log(state, pid, `冢中枯骨：【${u.name}】返回手牌`);
        break;
      }
    }
  },
  f2Hit: {
    source: '技能', prompt: '选择目标',
    auto: (list, state, pid) => (list[0]?.faction === pid
      ? [...list].sort((a, b) => b.hp - a.hp)[0]
      : [...list].sort((a, b) => (a.hp - b.hp) || byValueDesc(a, b))[0]),
    apply(state, pid, t, c = {}) {
      damageUnit(state, t, c.amount || 1, c.source || '技能');
      if (c.inhibit) inhibit(state, t, c.source || '技能');
      if (c.suppress && onBoard(state, t)) suppressUnit(state, t, c.source || '技能');
    }
  },
  f2ZongBing: {
    source: '纵兵劫掠', prompt: '选择：获得粮草，或抽2张牌', pool: 'option',
    auto: (list, state, pid) => ((state.players[pid].hand.length < 4) ? list.find(o => o.instanceId === 'draw') : list.find(o => o.instanceId === 'grain')) || list[0],
    apply(state, pid, opt, c = {}) {
      if (opt.instanceId === 'draw') { drawCard(state, pid); drawCard(state, pid); log(state, pid, '纵兵劫掠：抽2张牌'); }
      else { state.players[pid].provisions += c.amount || 0; log(state, pid, `纵兵劫掠：获得${c.amount || 0}粮草`); }
    }
  },
  f2YuanMou: {
    source: '沮授·远谋', prompt: '选择留下哪张牌（另一张置于牌堆底）', pool: 'option',
    auto: list => list.find(o => o.instanceId === 'keep') || list[0],
    apply(state, pid, opt, c = {}) {
      const p = state.players[pid];
      const drawn = p.hand.find(x => x.instanceId === c.drawnId);
      const ti = p.deck.findIndex(x => x.instanceId === c.topId);
      if (ti === -1) return;
      if (opt.instanceId === 'swap' && drawn) {
        p.hand.splice(p.hand.indexOf(drawn), 1);
        const [top] = p.deck.splice(ti, 1);
        p.hand.push(top);
        p.deck.push(drawn);
        log(state, pid, '沮授·远谋：换牌，原牌置于牌堆底');
      } else {
        p.deck.push(p.deck.splice(ti, 1)[0]);
        log(state, pid, '沮授·远谋：留下所摸的牌，另一张置于牌堆底');
      }
    }
  },
  f2Reserve: {
    source: '羌胡景附', prompt: '选择从备用区加入手牌的骑兵', pool: 'option',
    auto: list => list.find(o => o.instanceId === 'xl_di_ren') || list[0],
    apply(state, pid, opt) {
      const p = meta(state.players[pid]);
      const want = [opt.instanceId, 'xl_qiang_hu', 'xl_di_ren'];
      for (const id of want) {
        const i = p.reserve.findIndex(c => baseId(c.cardId) === id);
        if (i === -1) continue;
        const [card] = p.reserve.splice(i, 1);
        card.faction = pid;
        putInHand(state, pid, card);
        log(state, pid, `羌胡景附：【${card.name}】自备用区加入手牌`);
        return;
      }
      log(state, pid, '羌胡景附：备用区已空');
    }
  }
};

// ------------------------------------------------------------------ 进场时选目标
const others = (state, owner, card) => getAllUnits(state, owner).filter(u => u.instanceId !== card?.instanceId);
const TARGETS = {
  ys_feng_ji: { prompt: '游说：选择敌方支援阵线1个目标，造成2伤害', list: (state, owner) => state.battlefield.support[opp(owner)].slots.filter(canSkillTarget) },
  ys_shen_pei: { prompt: '专断：选择要抑制的1个己方单位', list: (state, owner, card) => others(state, owner, card).filter(u => active(u)) },
  ys_zhang_he: { prompt: '驰援：选择1个友军，防御+2', list: others },
  hj_liu_pi: { prompt: '夹击：选择另1个己方步军，双方+1+1', list: (state, owner, card) => others(state, owner, card).filter(u => effectiveTroop(state, u) === TROOP_TYPES.INFANTRY) },
  hj_gong_du: { prompt: '夹击：选择另1个己方步军，双方+1+1', list: (state, owner, card) => others(state, owner, card).filter(u => effectiveTroop(state, u) === TROOP_TYPES.INFANTRY) },
  dz_dong_zhuo: { prompt: '凌朝：选择1个敌军，抑制它及其相邻单位', list: (state, owner) => getAllUnits(state, opp(owner)).filter(canSkillTarget) },
  dz_dong_min: {
    prompt: '擅权：选择1个花费2或更低的敌军，将其控制',
    list: (state, owner) => (state.battlefield.support[owner].slots.length >= MAX_SUPPORT ? [] : getAllUnits(state, opp(owner)).filter(u => canSkillTarget(u) && (u.cost ?? 0) <= 2))
  },
  dz_zhang_ji: { prompt: '周停：选择1个单位，行动花费+2', list: (state, owner, card) => [...getAllUnits(state, opp(owner)).filter(canSkillTarget), ...others(state, owner, card)] },
  dz_hu_zhen: { prompt: '大督：选择要压制的敌军', list: (state, owner) => getAllUnits(state, opp(owner)).filter(u => canSkillTarget(u) && !u.status.suppressed && canBeSuppressed(state, u)) },
  lbiao_liu_qi: { prompt: '合兵：选择1个己方军队结为犄角', list: (state, owner, card) => others(state, owner, card).filter(u => u.troopType !== TROOP_TYPES.STRATEGIST) }
};

const xiangGong = (state, unit) => queueOwnTarget(state, unit.faction, 2, `${unit.name}·相攻`);

const DEPLOY = {
  ys_chen_lin(state, unit) { searchDeck(state, unit.faction, 'ys_tao_zei', '陈琳·墨兵'); },
  ys_feng_ji(state, unit) {
    const t = chosenOr(TARGETS.ys_feng_ji.list(state, unit.faction), unit, l => [...l].sort((a, b) => a.hp - b.hp)[0]);
    if (t) damageUnit(state, t, 2, '逢纪·游说');
  },
  ys_shen_pei(state, unit) {
    const t = chosenOr(TARGETS.ys_shen_pei.list(state, unit.faction, unit), unit, l => [...l].sort((a, b) => (a.cost || 0) - (b.cost || 0))[0]);
    if (t) inhibit(state, t, '审配·专断');
  },
  ys_zhang_he(state, unit) {
    const t = chosenOr(others(state, unit.faction, unit), unit, l => [...l].sort((a, b) => a.hp - b.hp)[0]);
    if (t) { buff(t, 0, 2); log(state, unit.faction, `张郃·驰援：【${t.name}】防御+2`); }
  },
  hj_qu_shuai(state, unit) {
    const d = state.players[unit.faction].discard;
    const i = d.findIndex(isHJJ);
    if (i === -1) { log(state, unit.faction, '黄巾渠帅·复起：弃牌区没有黄巾军'); return; }
    if (state.battlefield.support[unit.faction].slots.length >= MAX_SUPPORT) { log(state, unit.faction, '黄巾渠帅·复起：支援阵线已满'); return; }
    const [card] = d.splice(i, 1);
    resetCardState(card);
    placeUnit(state, unit.faction, card, 'SUPPORT');
    log(state, unit.faction, '黄巾渠帅·复起：黄巾军自弃牌区重返支援阵线');
  },
  hj_liu_pi(state, unit) { jiaJi(state, unit, '刘辟'); },
  hj_gong_du(state, unit) { jiaJi(state, unit, '龚都'); },
  dz_dong_zhuo(state, unit) {
    const t = chosenOr(TARGETS.dz_dong_zhuo.list(state, unit.faction), unit, l => [...l].sort((a, b) => adjacentUnits(state, b).length - adjacentUnits(state, a).length || byValueDesc(a, b))[0]);
    if (!t) return;
    const hit = [t, ...adjacentUnits(state, t).filter(u => u.faction !== unit.faction)];
    for (const u of hit) inhibit(state, u, '董卓·凌朝');
  },
  dz_dong_min(state, unit) {
    const t = chosenOr(TARGETS.dz_dong_min.list(state, unit.faction), unit, l => [...l].sort(byValueDesc)[0]);
    if (t) controlUnit(state, unit.faction, t, '董旻·擅权');
  },
  dz_zhang_ji(state, unit) {
    const t = chosenOr(TARGETS.dz_zhang_ji.list(state, unit.faction, unit), unit, l => [...l].filter(u => u.faction !== unit.faction).sort((a, b) => b.atk - a.atk)[0] || l[0]);
    if (t) { t.actionCost = (t.actionCost ?? 1) + 2; log(state, unit.faction, `张济·周停：【${t.name}】行动花费+2`); }
  },
  dz_hu_zhen(state, unit) {
    const t = chosenOr(TARGETS.dz_hu_zhen.list(state, unit.faction), unit, l => [...l].sort((a, b) => b.atk - a.atk)[0]);
    if (t) suppressUnit(state, t, '胡轸·大督');
  },
  dz_fan_chou(state, unit) {
    if (others(state, unit.faction, unit).some(u => active(u) && hasKeyword(u, '掳掠'))) { drawCard(state, unit.faction); log(state, unit.faction, '樊稠·索兵：抽1张牌'); }
  },
  xl_ma_teng: xiangGong, xl_han_sui: xiangGong, xl_bei_gong: xiangGong, xl_li_wen_hou: xiangGong, xl_bian_zhang: xiangGong,
  ys_ju_yi(state, unit) {
    // 目标由敌方选择
    pickOrQueue(state, opp(unit.faction), 'f2Sacrifice', unit, getAllUnits(state, opp(unit.faction)), { destroy: true, drawIfCav: true, source: '鞠义·夺帅', prompt: '鞠义·夺帅：选择己方1个单位被消灭' });
  },
  yshu_lei_bo(state, unit) { liuKou(state, unit); },
  yshu_chen_lan(state, unit) { liuKou(state, unit); },
  yshu_han_yin(state, unit) {
    const list = others(state, unit.faction, unit).filter(u => kingdomOf(u) !== 'yshu');
    for (const u of list) buff(u, 1, 1);
    log(state, unit.faction, `韩胤·联姻：${list.length}个非袁术阵营友军+1+1`);
  },
  lbiao_wang_can(state, unit) {
    const n = state.players[unit.faction].prestige || 0;
    for (let i = 0; i < n; i++) drawCard(state, unit.faction);
    log(state, unit.faction, `王粲·文赋：声望${n}，抽${n}张牌`);
  },
  lbiao_meng_chong(state, unit) {
    const n = others(state, unit.faction, unit).filter(u => u.troopType === TROOP_TYPES.NAVY).length;
    if (n) { buff(unit, n, n); log(state, unit.faction, `艨艟斗舰：${n}艘友舰，获得+${n}+${n}`); }
  },
  lbiao_su_fei(state, unit) { drawCard(state, unit.faction); log(state, unit.faction, '苏飞·举荐：抽1张牌'); },
  lbiao_han_xuan(state, unit) { healHq(state, unit.faction, 1, true); log(state, unit.faction, '韩玄·修筑：主城+1'); },
  lbiao_zhao_fan(state, unit) {
    const all = [...getAllUnits(state, FACTIONS.WEI), ...getAllUnits(state, FACTIONS.SHU)];
    if (all.some(u => u !== unit && FEMALE.test(u.name || ''))) {
      for (const k of ['帷幄', '警戒']) if (!unit.keywords.includes(k)) unit.keywords.push(k);
      log(state, unit.faction, '赵范·攀姻：获得帷幄、警戒');
    }
  },
  lbiao_liu_pan(state, unit) {
    const me = state.players[unit.faction].hp, foe = state.players[opp(unit.faction)].hp;
    if (me - foe >= 5) { buff(unit, 2, 2); log(state, unit.faction, '刘磐·强袭：主城占优，获得+2+2'); }
  },
  lbiao_liu_qi(state, unit) {
    const t = chosenOr(TARGETS.lbiao_liu_qi.list(state, unit.faction, unit), unit, l => [...l].sort((a, b) => b.maxHp - a.maxHp)[0]);
    if (!t) return;
    unit._heBing = t.instanceId; t._heBing = unit.instanceId;
    log(state, unit.faction, `刘琦·合兵：与【${t.name}】互为犄角，一方受伤由另一方承受`);
  }
};

function liuKou(state, unit) {
  if (placeUnit(state, unit.faction, makeCard(state, unit.faction, 'yshu_liu_kou'), 'SUPPORT')) log(state, unit.faction, `${unit.name}·山寇：流寇加入支援阵线`);
}

function jiaJi(state, unit, who) {
  const t = chosenOr(TARGETS.hj_liu_pi.list(state, unit.faction, unit), unit, l => [...l].sort((a, b) => b.atk - a.atk)[0]);
  if (!t) return;
  buff(unit, 1, 1); buff(t, 1, 1);
  log(state, unit.faction, `${who}·夹击：与【${t.name}】各+1+1`);
}

// ------------------------------------------------------------------ 战法
const allEnemies = (state, owner) => getAllUnits(state, opp(owner)).filter(canTargetEnemy);
const TACTIC_SPECS = {
  ys_tao_zei: {
    play(state, owner) {
      const n = state.players[owner].prestige || 0;
      const x = getAllUnits(state, opp(owner)).filter(u => hasBadge(u, '暴虐') || hasKeyword(u, '掳掠')).length;
      const dmg = n * (1 + x);
      if (dmg > 0) damageHq(state, opp(owner), dmg, '讨贼檄文');
      log(state, owner, `讨贼檄文：声望${n}，每点造成${1 + x}伤害，共${dmg}`);
    }
  },
  hj_jie_gan: {
    play(state, owner) {
      let n = 0;
      for (let i = 0; i < 2; i++) if (placeUnit(state, owner, makeCard(state, owner, 'hj_huang_jin_jun'), 'FRONT')) n++;
      log(state, owner, `揭竿而起：${n}个黄巾军加入战场`);
    }
  },
  hj_wu_he: {
    play(state, owner) {
      const list = getAllUnits(state, owner).filter(isHJJ);
      if (list.length) { for (const u of list) buff(u, 1, 2); log(state, owner, `乌合之众：${list.length}个黄巾军+1+2`); return; }
      for (let i = 0; i < 2; i++) putInHand(state, owner, makeCard(state, owner, 'hj_huang_jin_jun'));
      log(state, owner, '乌合之众：2张黄巾军加入手牌');
    }
  },
  hj_wei_gong: {
    precheck: (state, owner) => getAllUnits(state, owner).length > getAllUnits(state, opp(owner)).length,
    precheckMsg: '己方单位数量需多于敌方',
    targets: (state, owner) => [...allEnemies(state, owner), ...getAllUnits(state, owner)],
    autoPick: (state, owner, list) => {
      const d = getAllUnits(state, owner).length - getAllUnits(state, opp(owner)).length;
      const foes = list.filter(u => u.faction !== owner);
      return [...foes].sort((a, b) => ((b.hp <= d) - (a.hp <= d)) || byValueDesc(a, b))[0] || list[0];
    },
    play(state, owner, card, t) {
      const d = getAllUnits(state, owner).length - getAllUnits(state, opp(owner)).length;
      if (d > 0 && t) damageUnit(state, t, d, '围攻');
    }
  },
  hj_tai_ping_dao: {
    play(state, owner) {
      let n = 0;
      for (const u of getAllUnits(state, owner)) if (u.hp < u.maxHp) { u.hp = u.maxHp; n++; }
      for (let i = 0; i < n; i++) drawCard(state, owner);
      log(state, owner, `太平道：恢复${n}个单位，抽${n}张牌`);
    }
  },
  hj_huang_tian: {
    precheck: (state, owner) => state.battlefield.support[owner].slots.length < MAX_SUPPORT,
    precheckMsg: '支援阵线已满',
    play(state, owner) {
      let n = 0;
      while (state.battlefield.support[owner].slots.length < MAX_SUPPORT && n < MAX_SUPPORT) {
        if (!placeUnit(state, owner, makeCard(state, owner, 'hj_huang_jin_jun'), 'SUPPORT', { rush: true })) break;
        n++;
      }
      log(state, owner, `黄天当立：${n}个黄巾军获得突袭，加入支援阵线`);
    }
  },
  dz_zong_bing: {
    play(state, owner) {
      const p = state.players[owner];
      p.prestige = Math.max(0, (p.prestige || 0) - 1);
      const n = getAllUnits(state, owner).filter(u => active(u) && hasKeyword(u, '掳掠')).length;
      queueChoice(state, owner, 'f2ZongBing', null, [{ instanceId: 'grain', name: `获得${n}粮草` }, { instanceId: 'draw', name: '抽2张牌' }], { amount: n });
    }
  },
  dz_xie_chao: {
    targets: (state, owner) => [...allEnemies(state, owner), ...getAllUnits(state, owner)].filter(u => !u.status?.[STATUS_TYPES.INHIBITED]),
    autoPick: (state, owner, list) => {
      const foes = list.filter(u => u.faction !== owner);
      return foes.find(u => isStrategist(state, u)) || [...foes].sort(byValueDesc)[0] || list[0];
    },
    play(state, owner, card, t) {
      const strat = isStrategist(state, t);
      inhibit(state, t, '胁朝');
      if (strat) { drawCard(state, owner); log(state, owner, '胁朝：抑制谋士，摸1张牌'); }
    }
  },
  xl_tie_qi_tu_ji: {
    play(state, owner) {
      fxOf(state, owner).f2TieQi = true;
      for (const u of getAllUnits(state, owner)) {
        if (u.troopType === TROOP_TYPES.CAVALRY && u.status[STATUS_TYPES.DEPLOYED_THIS_TURN] && !u.status.attacksThisTurn && !u.status[STATUS_TYPES.MOVED_THIS_TURN]) u.status[STATUS_TYPES.ACTIONS_USED] = 0;
      }
      log(state, owner, '铁骑突击：本回合己方马军获得突袭，并无视守护、帷幄');
    }
  },
  xl_feng_bu_ke_dang: {
    play(state, owner) { fxOf(state, owner).f2FengBu = true; log(state, owner, '锋不可当：本回合每消灭1个敌军，己方单位+1+1'); }
  },
  xl_qiang_hu_jing_fu: {
    precheck: (state, owner) => (state.players[owner].reserve || []).some(c => ['xl_qiang_hu', 'xl_di_ren'].includes(baseId(c.cardId))),
    precheckMsg: '备用区已没有羌胡游骑或氐人锐骑',
    play(state, owner) {
      for (let i = 0; i < 2; i++) {
        const ids = [...new Set((state.players[owner].reserve || []).map(c => baseId(c.cardId)).filter(id => ['xl_qiang_hu', 'xl_di_ren'].includes(id)))];
        const opts = ids.map(id => ({ instanceId: id, name: DB_CARD_MAP[id]?.name || id }));
        if (opts.length) queueChoice(state, owner, 'f2Reserve', null, opts);
      }
    }
  },
  xl_kou_lue: {
    play(state, owner) {
      const n = ZONES.filter(zk => state.battlefield.frontline[zk].units.some(u => u.faction === owner && isXL(u))).length;
      for (let i = 0; i < n; i++) drawCard(state, owner);
      log(state, owner, `寇掠三辅：${n}个前线区域有西凉军，抽${n}张牌`);
    }
  },
  xl_juan_tu: {
    precheck: (state, owner) => state.players[owner].discard.some(c => c.type === 'UNIT' && (c.cost ?? 0) <= 2),
    precheckMsg: '弃牌区没有花费不超过2的单位',
    play(state, owner) {
      const p = state.players[owner];
      const cards = p.discard.filter(c => c.type === 'UNIT' && (c.cost ?? 0) <= 2);
      p.discard = p.discard.filter(c => !cards.includes(c));
      for (const c of cards) { resetCardState(c); c.faction = owner; }
      p.pendingPick = { source: '卷土重来', max: 3, cards };
      log(state, owner, `卷土重来：从弃牌区挑选至多3张低费单位`);
    }
  },
  lbiao_dan_qi: { play(state, owner) { state.players[owner]._danQi = state.turnNumber; log(state, owner, '单骑入荆：回合结束时，若本回合只进场了1个单位，使其+1+1并抽1张牌'); } },
  lbiao_en_wei: {
    optionalTarget: true,
    targets: allEnemies,
    autoPick: (state, owner, list) => [...list].sort((a, b) => ((b.hp <= 3) - (a.hp <= 3)) || byValueDesc(a, b))[0],
    play(state, owner, card, t) {
      if (t) damageUnit(state, t, 3, '恩威并施'); else damageHq(state, opp(owner), 3, '恩威并施');
      healHq(state, owner, 5, true);
      log(state, owner, '恩威并施：己方主城+5');
    }
  },
  lbiao_li_xue: {
    play(state, owner) {
      const n = state.players[owner].prestige || 0;
      if (n) healHq(state, owner, 2 * n, true);
      for (let i = 0; i < n; i++) drawCard(state, owner);
      log(state, owner, `立学修经：声望${n}，主城+${2 * n}，抽${n}张牌`);
    }
  },
  lbiao_xiu_yan: { play(state, owner) { raiseCap(state, owner, 1); healHq(state, owner, 3, true); log(state, owner, '修堰溉田：粮草上限+1，主城+3'); } },
  lbiao_nian_gu: {
    play(state, owner) { raiseCap(state, owner, 1); log(state, owner, '年谷独登：己方粮草上限+1'); loseCap(state, opp(owner), 1, '年谷独登'); }
  },
  lbiao_liang_gu: {
    play(state, owner) {
      damageHq(state, opp(owner), 6, '两顾相持');
      if (state.players[opp(owner)].hp > 0) damageHq(state, owner, 6, '两顾相持', { noRedirect: true });
    }
  },
  lbiao_zuo_guan: {
    targets: (state, owner) => getAllUnits(state, owner),
    autoPick: (state, owner, list) => [...list].sort((a, b) => b.atk - a.atk)[0],
    play(state, owner, card, t) {
      const n = state.players[opp(owner)].hand.filter(c => c._known).length;
      if (n) buff(t, n, n);
      log(state, owner, `坐观天下：对手手中${n}张明牌，【${t.name}】+${n}+${n}`);
    }
  },
  lbiao_shang_wu: {
    precheck: (state, owner) => state.players[owner].deck.length > 0,
    precheckMsg: '牌堆已空',
    play(state, owner) {
      const card = state.players[owner].deck.pop();
      if (!card) return;
      putInHand(state, owner, card);
      const n = card.cost ?? 0;
      if (n) healHq(state, owner, n, true);
      log(state, owner, `上屋抽梯：从牌堆底抽出【${card.name}】并展示，主城+${n}`);
    }
  },
  lbiao_hong_men_yan: {
    targets: (state, owner) => state.battlefield.support[opp(owner)].slots.filter(canTargetEnemy),
    autoPick: (state, owner, list) => [...list].sort(byValueDesc)[0],
    play(state, owner, card, t) { removeUnitFromBoard(state, t.instanceId); log(state, owner, `鸿门宴：消灭【${t.name}】`); }
  },
  dz_du_lan: {
    play(state, owner) {
      const list = getAllUnits(state, opp(owner)).filter(u => u.status?.[STATUS_TYPES.INHIBITED] || u.status?.[STATUS_TYPES.SUPPRESSED]);
      for (const u of list) removeUnitFromBoard(state, u.instanceId);
      log(state, owner, `独揽大权：消灭${list.length}个被抑制或压制的敌军`);
    }
  },
  xl_yun_tun: {
    play(state, owner) {
      const list = getAllUnits(state, owner).filter(u => u._atkTurn === state.turnNumber || (u.status?.attacksThisTurn || 0) > 0);
      for (const u of list) returnToHand(state, u, '云屯鸟散');
      state.players[owner].provisions += 2 * list.length;
      log(state, owner, `云屯鸟散：${list.length}个单位返回手牌，获得${2 * list.length}粮草`);
    }
  },
  // ---- 袁术 ----
  yshu_si_shi: {
    play(state, owner) {
      const n = getAllUnits(state, opp(owner)).length;
      for (let i = 0; i < n; i++) drawCard(state, owner);
      log(state, owner, `四世五公：敌方场上${n}个单位，抽${n}张牌`);
    }
  },
  yshu_la_long: {
    targets: (state, owner) => {
      const cap = state.players[owner].provisionsCap;
      return [...allEnemies(state, owner), ...getAllUnits(state, owner)].filter(u => getAttackValue(state, u) <= cap);
    },
    autoPick: (state, owner, list) => [...list.filter(u => u.faction !== owner)].sort(byValueDesc)[0] || list[0],
    play(state, owner, card, t) {
      removeUnitFromBoard(state, t.instanceId);
      log(state, owner, `拉拢：消灭【${t.name}】`);
      loseCap(state, owner, 1, '拉拢');
    }
  },
  yshu_xie_chi: {
    targets: (state, owner) => [...allEnemies(state, owner), ...getAllUnits(state, owner)],
    autoPick: (state, owner, list) => [...list.filter(u => u.faction !== owner)].sort(byValueDesc)[0] || list[0],
    play(state, owner, card, t) {
      returnToHand(state, t, '挟持');
      // 敌方弃1张牌：由敌方自己挑
      pickOrQueue(state, opp(owner), 'f2Discard', null, state.players[opp(owner)].hand, { source: '挟持', prompt: '挟持：选择弃置1张手牌' });
    }
  },
  yshu_bing_fen: {
    play(state, owner) {
      const n = occupied(state, owner);
      if (n) for (const u of getAllUnits(state, owner)) buff(u, n, n);
      log(state, owner, `兵分七路：占领${n}个前线，己方单位+${n}+${n}`);
    }
  },
  yshu_chen_huo: {
    optionalTarget: true,
    targets: allEnemies,
    autoPick: (state, owner, list) => [...list].sort((a, b) => ((b.hp <= 2) - (a.hp <= 2)) || byValueDesc(a, b))[0],
    play(state, owner, card, t) {
      if (t) damageUnit(state, t, 2, '趁火打劫'); else damageHq(state, opp(owner), 2, '趁火打劫');
      discardRandom(state, opp(owner), 1, '趁火打劫');
    }
  },
  yshu_heng_zheng: {
    play(state, owner) {
      state.players[owner].provisions += 3;
      drawCard(state, owner);
      log(state, owner, '横征暴敛：获得3粮草，抽1张牌');
      loseCap(state, owner, 1, '横征暴敛');
    }
  },
  yshu_jian_hao: {
    play(state, owner) {
      drawCard(state, owner); drawCard(state, owner);
      const d = state.players[opp(owner)].provisionsCap - state.players[owner].provisionsCap;
      if (d > 0) state.players[owner].provisions += 2 * d;
      log(state, owner, `僭号称帝：抽2张牌${d > 0 ? `，粮草上限少${d}，获得${2 * d}粮草` : ''}`);
    }
  },
  yshu_qiong_tu: {
    play(state, owner) {
      for (const u of [...getAllUnits(state, opp(owner))]) damageUnit(state, u, 2, '穷途末路');
      damageHq(state, opp(owner), 2, '穷途末路');
      log(state, owner, '穷途末路：对所有敌方目标造成2伤害');
      if (state.players[opp(owner)].hp > 0) loseCap(state, owner, 1, '穷途末路');
    }
  },
  shu_san_gu: {
    precheck: (state, owner) => state.players[owner].deck.length > 0,
    precheckMsg: '牌堆已空',
    play(state, owner) {
      const p = state.players[owner];
      const cards = p.deck.splice(0, 3);
      p.pendingPick = { source: '三顾茅庐', max: 1, cards, restTo: 'bottom' };
      log(state, owner, `三顾茅庐：翻看${cards.length}张牌，选1张加入手牌`);
    }
  }
};

// ------------------------------------------------------------------ 反制
const COUNTER_SPECS = {
  xl_ban_du: {
    event: 'ENEMY_MOVE',
    check: (state, owner, ctx) => Boolean(ctx.unit && ctx.unit.faction !== owner && ctx.toZoneType === 'FRONTLINE' && onBoard(state, ctx.unit) && canTargetEnemy(ctx.unit)),
    fire(state, owner, ctx) {
      const dmg = hasKeyword(ctx.unit, '突袭') ? 8 : 4;
      log(state, owner, `反制【半渡而击】：对【${ctx.unit.name}】造成${dmg}点伤害`);
      damageUnit(state, ctx.unit, dmg, '半渡而击');
    }
  },
  wei_qi_chuan: {
    event: 'OWN_ATTACKED',
    check: (state, owner, ctx) => Boolean(ctx.defender && ctx.defender.faction === owner && onBoard(state, ctx.defender)),
    fire(state, owner, ctx) {
      const u = ctx.defender;
      if (!u.keywords.includes('坚阵3')) { u.keywords.unshift('坚阵3'); (u._tempKw ||= []).push('坚阵3'); }
      log(state, owner, `反制【奇船避箭】：【${u.name}】获得坚阵3直到回合结束`);
    }
  },
  yshu_you_sha: {
    event: 'ENEMY_MOVE',
    check: (state, owner, ctx) => Boolean(ctx.unit && ctx.unit.faction !== owner && ctx.toZoneType === 'FRONTLINE' && onBoard(state, ctx.unit) && canTargetEnemy(ctx.unit)),
    fire(state, owner, ctx) {
      log(state, owner, `反制【诱杀】：对【${ctx.unit.name}】造成3点伤害`);
      if (damageUnit(state, ctx.unit, 3, '诱杀')) { drawCard(state, owner); log(state, owner, '诱杀：得手，抽1张牌'); }
    }
  },
  yshu_ci_sha: {
    event: 'ENEMY_DEPLOY',
    check: (state, owner, ctx) => Boolean(ctx.unit && ctx.unit.faction !== owner && onBoard(state, ctx.unit)),
    fire(state, owner, ctx) { removeUnitFromBoard(state, ctx.unit.instanceId); log(state, owner, `反制【刺杀】：【${ctx.unit.name}】刚部署即被刺杀`); }
  },
  yshu_zhong_zhong: {
    event: 'OWN_DEFEATED',
    check: (state, owner, ctx) => Boolean(ctx.unit && ctx.owner === owner && state.players[owner].hand.length > 0),
    fire(state, owner, ctx) {
      const opts = [...state.players[owner].hand.map(c => ({ instanceId: c.instanceId, name: `弃【${c.name}】` })), { instanceId: 'skip', name: '不发动' }];
      log(state, owner, `反制【冢中枯骨】：【${ctx.unit.name}】阵亡`);
      queueChoice(state, owner, 'f2ZhongZhong', null, opts, { unitId: ctx.unit.instanceId, prompt: `弃1张手牌，使【${ctx.unit.name}】返回手牌` });
    }
  },
  yshu_lu_zhong: {
    event: 'OWN_HQ_DAMAGED',
    check: (state, owner, ctx) => ctx.playerId === owner && ctx.amount > 0,
    fire(state, owner, ctx) { log(state, owner, `反制【路中悍鬼】：对敌方主城造成${ctx.amount}点伤害`); damageHq(state, opp(owner), ctx.amount, '路中悍鬼'); }
  },
  lbiao_bao_jing: {
    event: 'OWN_HQ_DAMAGED',
    check: (state, owner, ctx) => ctx.playerId === owner && ctx.amount > 1,
    fire(state, owner) { state.players[owner]._hqCapTurn = state.turnNumber; log(state, owner, '反制【保境安民】：本回合己方主城每次受到的伤害最多为1'); }
  }
};

// ------------------------------------------------------------------ 持续效果（光环）
function statAuras(state) {
  for (const pid of [FACTIONS.WEI, FACTIONS.SHU]) {
    const units = getAllUnits(state, pid);
    const enemies = getAllUnits(state, opp(pid));
    const liWen = countOf(state, pid, 'xl_li_wen_hou');
    const weiGong = units.filter(u => isId(u, 'hj_bo_cai') || isId(u, 'hj_guan_hai')).length;
    const caiMao = countOf(state, pid, 'lbiao_cai_mao') > 0 && !enemies.some(u => u.troopType === TROOP_TYPES.NAVY);
    const xlCount = units.filter(isXL).length;
    const heWei = Math.max(0, occupied(state, pid) - occupied(state, opp(pid))) * countOf(state, pid, 'yshu_zhang_xun');
    const nonYshu = units.filter(u => kingdomOf(u) !== 'yshu').length;
    const fx = fxOf(state, pid);
    for (const u of units) {
      // ---- 数值 ----
      let a = 0;
      if (active(u)) {
        if (isXL(u) && liWen) a += liWen - (isId(u, 'xl_li_wen_hou') ? 1 : 0);
        if (isId(u, 'xl_guan_xi')) a += xlCount - 1;
        if (isHJJ(u)) a += weiGong;
        if (caiMao && u.troopType === TROOP_TYPES.NAVY) a += 1;
        if (heWei && findUnit(state, u.instanceId)?.zoneType === 'FRONTLINE') a += heWei;
        if (isId(u, 'yshu_qiao_rui')) a += nonYshu;
      }
      if (u.status?.[STATUS_TYPES.INHIBITED]) u._f2Aura = 0; // 抑制已把数值重置
      const have = u._f2Aura || 0;
      if (a !== have) {
        const d = a - have;
        u.atk += d; u.maxHp += d; u.hp += d;
        if (d < 0) u.hp = Math.max(1, Math.min(u.hp, u.maxHp));
        u._f2Aura = a;
      }
      // ---- 词条 ----
      const want = [];
      if (active(u)) {
        if (isId(u, 'lbiao_jiang_xia') && unitTerrain(state, u)?.type === 'WATER') want.push('坚阵1', '矢石');
        if (fx.f2TieQi && u.troopType === TROOP_TYPES.CAVALRY) want.push('突袭');
        if (isId(u, 'shu_zhu_ge_liang_cl') && u._acted) want.push('警戒');
      }
      const had = u._f2Kw || [];
      for (const k of had) if (!want.includes(k)) { const i = u.keywords.indexOf(k); if (i !== -1) u.keywords.splice(i, 1); }
      const added = had.filter(k => want.includes(k));
      for (const k of want) if (!added.includes(k) && !u.keywords.includes(k)) { u.keywords.push(k); added.push(k); }
      u._f2Kw = added;
    }
  }
}

// ------------------------------------------------------------------ 离场
function onDeath(state, unit, owner, { banish }) {
  const wasActive = !unit.status?.[STATUS_TYPES.INHIBITED];
  const id = baseId(unit.cardId);
  const foe = opp(owner);
  const reps = 1 + (countOf(state, owner, 'xl_bian_zhang') > 0 ? 1 : 0); // 边章·复举
  if (wasActive) {
    for (let r = 0; r < reps; r++) {
      if (id === 'ys_tian_feng') { drawCard(state, owner); log(state, owner, '田丰·死谏：摸1张牌'); }
      if (banish) continue;
      if (id === 'hj_huang_jin_jun') pickOrQueue(state, owner, 'f2Hit', null, getAllUnits(state, owner), { amount: 1, source: '黄巾军', prompt: '黄巾军阵亡：选择1个友军受到1伤害' });
      if (id === 'hj_zhang_man_cheng') zhangManCheng(state, owner);
      if (id === 'ys_da_ji') pickOrQueue(state, owner, 'f2Hit', null, getAllUnits(state, foe).filter(canSkillTarget), { amount: 2, source: '大戟士', prompt: '大戟士：选择1个敌军，造成2伤害' });
      if (id === 'ys_gao_lan' || id === 'ys_zhang_he') damageHq(state, owner, 2, `${unit.name}·倒戈`, { noRedirect: true });
      if (id === 'xl_yan_xing') damageHq(state, owner, 1, '阎行·叛乱', { noRedirect: true });
      if (['xl_zhang_heng', 'xl_ma_wan', 'xl_li_kan', 'xl_cheng_yi'].includes(id)) damageHq(state, foe, 1, `${unit.name}·力战`);
      if (id === 'xl_liang_xing') { drawCard(state, owner); log(state, owner, '梁兴·溃掠：抽1张牌'); }
    }
  }
  if (!banish) triggerCounters(state, 'OWN_DEFEATED', { unit, owner });
  if (!banish) {
    for (const _ of ownWith(state, owner, 'xl_han_sui')) damageHq(state, foe, 1, '韩遂·权变');
    for (const _ of ownWith(state, owner, 'xl_cheng_gong_ying')) { drawCard(state, owner); log(state, owner, '成公英·收拢：抽1张牌'); }
    for (const _ of ownWith(state, owner, 'yshu_yang_hong')) { drawCard(state, owner); log(state, owner, '杨弘·收拢：抽1张牌'); }
  }
  // 锋不可当：本回合每消灭1个敌军，己方单位+1+1直到回合结束
  const ap = state.activePlayer;
  if (owner !== ap && fxOf(state, ap).f2FengBu) {
    const recs = (fxOf(state, ap).f2FengBuHp ||= []);
    for (const u of getAllUnits(state, ap)) { u._tempAtk = (u._tempAtk || 0) + 1; u.maxHp += 1; u.hp += 1; recs.push(u.instanceId); }
    log(state, ap, '锋不可当：己方单位+1+1');
  }
}

function zhangManCheng(state, owner) {
  const p = state.players[owner];
  if (state.battlefield.support[owner].slots.length >= MAX_SUPPORT) { log(state, owner, '张曼成·残党：支援阵线已满'); return; }
  const isQS = c => baseId(c.cardId) === 'hj_qu_shuai';
  let card = null;
  let i = p.deck.findIndex(isQS);
  if (i !== -1) card = p.deck.splice(i, 1)[0];
  else if ((i = p.discard.findIndex(isQS)) !== -1) { card = p.discard.splice(i, 1)[0]; resetCardState(card); }
  else card = makeCard(state, owner, 'hj_qu_shuai');
  if (placeUnit(state, owner, card, 'SUPPORT')) log(state, owner, '张曼成·残党：黄巾渠帅加入支援阵线');
}

// ------------------------------------------------------------------ 交战后
function afterAttack(state, attacker, defender, result, targetIsHq) {
  const aAlive = onBoard(state, attacker);
  const dAlive = defender && onBoard(state, defender);
  const t = state.turnNumber;
  attacker._atkTurn = t;
  attacker._acted = true;
  if (aAlive && isId(attacker, 'lbiao_kuai_yue') && result.damageDealt > 0) { healHq(state, attacker.faction, result.damageDealt, true); log(state, attacker.faction, `蒯越·定乱：主城+${result.damageDealt}`); }
  if (aAlive && isId(attacker, 'hj_zhang_yan') && attacker._feiYan !== t) feiYan(state, attacker);
  if (targetIsHq || !defender) return;
  if (dAlive && isId(defender, 'lbiao_kuai_yue') && result.counterDealt > 0) { healHq(state, defender.faction, result.counterDealt, true); log(state, defender.faction, `蒯越·定乱：主城+${result.counterDealt}`); }
  // 董璜·钳口
  if (aAlive && dAlive && isId(attacker, 'dz_dong_huang') && isStrategist(state, defender)) inhibit(state, defender, '董璜·钳口');
  // 徐荣·追击
  if (aAlive && result.defenderDied && isId(attacker, 'dz_xu_rong')) {
    pickOrQueue(state, attacker.faction, 'f2Hit', attacker, getAllUnits(state, defender.faction).filter(canSkillTarget), { amount: 2, source: '徐荣·追击', prompt: '追击：选择1个敌军，造成2伤害' });
  }
  // 李儒·鸩酒
  if (aAlive && dAlive && isId(attacker, 'dz_li_ru') && result.damageDealt > 0 && isStrategist(state, defender)) { removeUnitFromBoard(state, defender.instanceId); log(state, attacker.faction, `李儒·鸩酒：毒杀【${defender.name}】`); }
  if (aAlive && dAlive && isId(defender, 'dz_li_ru') && result.counterDealt > 0 && isStrategist(state, attacker)) { removeUnitFromBoard(state, attacker.instanceId); log(state, defender.faction, `李儒·鸩酒：毒杀【${attacker.name}】`); }
  // 甘宁·轻侠
  if (aAlive && result.defenderDied && isId(attacker, 'lbiao_gan_ning')) retreatUnit(state, attacker, '甘宁·轻侠');
  // 刘琮·束手
  if (dAlive && result.damageDealt > 0 && isId(defender, 'lbiao_liu_cong') && !defender._shuShou) { defender._shuShou = true; removeUnitFromBoard(state, defender.instanceId); log(state, defender.faction, '刘琮·束手：一触即溃'); }
  if (aAlive && result.counterDealt > 0 && isId(attacker, 'lbiao_liu_cong') && !attacker._shuShou) { attacker._shuShou = true; removeUnitFromBoard(state, attacker.instanceId); log(state, attacker.faction, '刘琮·束手：一触即溃'); }
  // 文聘（刘表）·镇守
  if (aAlive && dAlive && isId(attacker, 'lbiao_wen_pin') && result.damageDealt > 0) suppressUnit(state, defender, '文聘·镇守');
  if (aAlive && dAlive && isId(defender, 'lbiao_wen_pin') && result.counterDealt > 0) suppressUnit(state, attacker, '文聘·镇守');
  // 张闿·刺杀：消灭受到本单位对战伤害的单位
  if (aAlive && dAlive && isId(attacker, 'yshu_zhang_kai') && result.damageDealt > 0) { removeUnitFromBoard(state, defender.instanceId); log(state, attacker.faction, `张闿·刺杀：【${defender.name}】被刺杀`); }
  if (aAlive && dAlive && isId(defender, 'yshu_zhang_kai') && result.counterDealt > 0) { removeUnitFromBoard(state, attacker.instanceId); log(state, defender.faction, `张闿·刺杀：【${attacker.name}】被刺杀`); }
  // 牛辅·惊乱：敌方回合受到伤害
  if (dAlive && isId(defender, 'dz_niu_fu') && result.damageDealt > 0) jingLuan(state, defender);
}

function jingLuan(state, unit) {
  if (state.activePlayer === unit.faction) return;
  meta(state.players[unit.faction]).provisionPenalty += 1;
  log(state, opp(unit.faction), '牛辅·惊乱：对手下回合失去1粮草');
}

/** 张燕·飞燕：每回合可行动2次 */
function feiYan(state, u) {
  u._feiYan = state.turnNumber;
  Object.assign(u.status, { actionsUsed: 0, movedThisTurn: false, attackedThisTurn: false, attacksThisTurn: 0 });
  log(state, u.faction, '张燕·飞燕：可再行动1次');
}

// ------------------------------------------------------------------ 回合结束
function onTurnEnd(state, pid) {
  const p = state.players[pid];
  const units = getAllUnits(state, pid);
  // 猜忌：对相邻友军造成1伤害
  for (const u of units.filter(u => ['ys_yuan_shao', 'dz_li_jue', 'dz_guo_si', 'xl_ma_chao'].some(id => isId(u, id)))) {
    for (const f of adjacentUnits(state, u).filter(x => x.faction === pid)) damageUnit(state, f, 1, `${u.name}·猜忌`);
  }
  // 刚直：有刚愎、谗佞友军则受2伤害
  for (const u of units.filter(u => isId(u, 'ys_cui_yan') || isId(u, 'ys_tian_feng'))) {
    if (getAllUnits(state, pid).some(x => x !== u && (hasBadge(x, '刚愎') || hasBadge(x, '谗佞')))) damageUnit(state, u, 2, `${u.name}·刚直`);
  }
  // 张角·天道：将1张黄巾军加入所在阵线
  for (const zj of ownWith(state, pid, 'hj_zhang_jiao')) {
    const loc = findUnit(state, zj.instanceId);
    if (!loc) continue;
    const where = loc.zoneType === 'FRONTLINE' ? { zoneKey: loc.zoneKey } : { support: true };
    if (placeUnit(state, pid, makeCard(state, pid, 'hj_huang_jin_jun'), where)) log(state, pid, '张角·天道：黄巾军加入阵线');
  }
  // 张宝·大医：每个己方单位恢复至多2伤害
  for (const _ of ownWith(state, pid, 'hj_zhang_bao')) {
    for (const u of getAllUnits(state, pid)) u.hp = Math.min(u.maxHp, u.hp + 2);
    log(state, pid, '张宝·大医：己方单位各恢复2点');
  }
  // 袁术·奢靡：抽1张，弃1张
  for (const _ of ownWith(state, pid, 'yshu_yuan_shu')) {
    drawCard(state, pid);
    pickOrQueue(state, pid, 'f2Discard', null, p.hand, { source: '袁术·奢靡', prompt: '袁术·奢靡：选择弃置1张手牌' });
  }
  // 趁火打劫：己方回合结束时留在手里的弃掉
  for (const c of p.hand.filter(c => baseId(c.cardId) === 'yshu_chen_huo')) discardFromHand(state, pid, c, '趁火打劫');
  // 纪灵·压境：敌方回合结束时若在前线，敌方跳过下个抽牌阶段
  for (const jl of ownWith(state, opp(pid), 'yshu_ji_ling')) {
    if (findUnit(state, jl.instanceId)?.zoneType === 'FRONTLINE') { p.skipNextDraw = true; log(state, opp(pid), '纪灵·压境：对手跳过下个抽牌阶段'); break; }
  }
  // 杨奉·护驾：本回合未掳掠，获得守护直到下个己方回合开始
  for (const u of ownWith(state, pid, 'hj_yang_feng')) {
    if (u._luLueTurn !== state.turnNumber && !u.keywords.includes('守护')) { u.keywords.push('守护'); u._huJia = true; log(state, pid, '杨奉·护驾：获得守护'); }
  }
  // 氐人锐骑：己方回合结束时返回手牌
  for (const u of ownWith(state, pid, 'xl_di_ren')) returnToHand(state, u, '氐人锐骑');
  // 单骑入荆
  if (p._danQi === state.turnNumber) {
    const ids = [...new Set(p._entered?.turn === state.turnNumber ? p._entered.ids : [])];
    const u = ids.length === 1 ? findUnit(state, ids[0])?.unit : null;
    if (u && u.faction === pid) { buff(u, 1, 1); drawCard(state, pid); log(state, pid, `单骑入荆：【${u.name}】+1+1，抽1张牌`); }
    else log(state, pid, '单骑入荆：本回合进场单位不止1个，未生效');
  }
  // 锋不可当：回合结束复原生命上限
  const fx = fxOf(state, pid);
  for (const iid of fx.f2FengBuHp || []) {
    const u = findUnit(state, iid)?.unit;
    if (u) { u.maxHp -= 1; u.hp = Math.max(1, Math.min(u.hp, u.maxHp)); }
  }
  fx.f2FengBuHp = [];
}

// ------------------------------------------------------------------ 进场
function onEnter(state, unit) {
  const pid = unit.faction;
  const p = state.players[pid];
  unit._enteredTurn = state.turnNumber;
  if (!p._entered || p._entered.turn !== state.turnNumber) p._entered = { turn: state.turnNumber, ids: [] };
  p._entered.ids.push(unit.instanceId);
  // 刘表·镇南：每回合己方首个进场的单位防御+1
  if (p._zhenNan !== state.turnNumber && countOf(state, pid, 'lbiao_liu_biao') > 0) {
    p._zhenNan = state.turnNumber;
    buff(unit, 0, 1);
    log(state, pid, `刘表·镇南：【${unit.name}】防御+1`);
  }
  // 宋忠·授业：己方声望单位进场时+1+1
  if (unit.keywords.some(k => typeof k === 'string' && k.startsWith('声望'))) {
    for (const _ of ownWith(state, pid, 'lbiao_song_zhong')) { buff(unit, 1, 1); log(state, pid, `宋忠·授业：【${unit.name}】+1+1`); }
  }
  // 铁骑突击：本回合进场的马军可立即行动
  if (fxOf(state, pid).f2TieQi && unit.troopType === TROOP_TYPES.CAVALRY && unit.status[STATUS_TYPES.DEPLOYED_THIS_TURN]) unit.status[STATUS_TYPES.ACTIONS_USED] = 0;
  hengJiang(state, unit, 'FRONTLINE');
}

/** 黄祖·横江：敌军进入水域时，压制并攻击其1次；攻击鲁莽单位伤害翻倍 */
function hengJiang(state, unit, toZone) {
  if (toZone !== 'FRONTLINE' || !onBoard(state, unit)) return;
  const loc = findUnit(state, unit.instanceId);
  if (loc?.zoneType !== 'FRONTLINE' || unitTerrain(state, unit, loc)?.type !== 'WATER') return;
  for (const hz of ownWith(state, opp(unit.faction), 'lbiao_huang_zu')) {
    if (!onBoard(state, unit)) break;
    suppressUnit(state, unit, '黄祖·横江');
    const dmg = getAttackValue(state, hz) * (hasBadge(unit, '鲁莽') ? 2 : 1);
    damageUnit(state, unit, dmg, '黄祖·横江');
  }
}

// ------------------------------------------------------------------ 挂载
export function installFactions2() {
  Object.assign(CHOICE_SPECS, CHOICES);
  Object.assign(DEPLOY_TARGETS, TARGETS);
  Object.assign(DEPLOY_SKILLS, DEPLOY);
  Object.assign(TACTICS, TACTIC_SPECS);
  Object.assign(COUNTERS, COUNTER_SPECS);
  PLUGIN_HOOKS.onEnter.push(onEnter);
  PLUGIN_HOOKS.afterAttack.push(afterAttack);
  PLUGIN_HOOKS.onDeath.push(onDeath);
  PLUGIN_HOOKS.onTurnEnd.push(onTurnEnd);
  EXT.aura.push(statAuras);

  EXT.attack.push((atk, state, unit, loc) => {
    const units = getAllUnits(state, unit.faction);
    if (isId(unit, 'ys_chen_lin')) atk += state.players[unit.faction].prestige || 0; // 墨兵：战力=声望（卡面战力0）
    if (unit.troopType === TROOP_TYPES.CAVALRY && units.some(u => isId(u, 'xl_ma_teng'))) atk += 1; // 马腾·征西
    if (isId(unit, 'hj_hei_shan') && unitTerrain(state, unit, loc)?.type === 'MOUNTAIN') atk += 3;
    if (isId(unit, 'yshu_shou_chun') && state.players[unit.faction].provisionsCap <= 3) atk *= 2; // 寿春锐卒
    // 潘璋·暗袭：己方潜袭单位的反击伤害翻倍（敌方回合被攻击时）
    if (unit.faction !== state.activePlayer && hasKeyword(unit, '潜袭') && units.some(u => isId(u, 'wu_pan_zhang'))) atk *= 2;
    // 先登死士：敌方回合中，己方伏击单位战力翻倍
    if (unit.faction !== state.activePlayer && active(unit) && hasKeyword(unit, '伏击') && units.some(u => isId(u, 'ys_xian_deng'))) atk *= 2;
    return atk;
  });
  EXT.actionCost.push((cost, state, unit, loc) => {
    if (isId(unit, 'hj_zhang_yan') && unitTerrain(state, unit, loc)?.type === 'MOUNTAIN') return 0;
    if (hasKeyword(unit, '降将')) cost -= countOf(state, unit.faction, 'lbiao_cai_fu_ren');
    return cost;
  });
  EXT.deployCost.push((cost, state, owner, card) => {
    const id = baseId(card?.cardId);
    if (id === 'hj_zhang_liang') cost -= getAllUnits(state, owner).length;
    if (isXL(card)) cost -= countOf(state, owner, 'xl_wang_guo');
    if (card?.troopType === TROOP_TYPES.NAVY) cost -= countOf(state, owner, 'lbiao_zhang_yun');
    if (hasKeyword(card, '降将')) cost -= countOf(state, owner, 'lbiao_cai_fu_ren');
    return cost;
  });
  EXT.unitDamage.push((amount, state, unit, source) => {
    if (isId(unit, 'ys_wen_chou')) amount *= 2; // 文丑·勇夫
    if (isId(unit, 'lbiao_liu_cong') && !unit._shuShou) {
      unit._shuShou = true;
      removeUnitFromBoard(state, unit.instanceId);
      log(state, unit.faction, '刘琮·束手：一触即溃');
      return 0;
    }
    // 刘琦·合兵：伤害转由另一方承受
    if (unit._heBing && !state._heBingBusy) {
      const partner = findUnit(state, unit._heBing)?.unit;
      const liuQi = isId(unit, 'lbiao_liu_qi') ? unit : (partner && isId(partner, 'lbiao_liu_qi') ? partner : null);
      if (partner && liuQi && partner.faction === unit.faction) {
        state._heBingBusy = true;
        try { damageUnit(state, partner, amount, `${source}（合兵转移）`); } finally { state._heBingBusy = false; }
        return 0;
      }
    }
    return amount;
  });
  EXT.unitDamaged.push((state, unit) => { if (isId(unit, 'dz_niu_fu')) jingLuan(state, unit); });
  EXT.hqDamage.push((amount, state, pid) => (state.players[pid]._hqCapTurn === state.turnNumber ? Math.min(amount, 1) : amount));
  EXT.hqDamaged.push((state, pid) => {
    for (const _ of ownWith(state, opp(pid), 'lbiao_liu_biao')) { healHq(state, opp(pid), 2, true); log(state, opp(pid), '刘表·坐观：己方主城+2'); }
  });
  EXT.hqGain.push((state, pid, gained) => {
    for (const _ of ownWith(state, pid, 'lbiao_kuai_liang')) { state.players[pid].provisions += gained; log(state, pid, `蒯良·安民：获得${gained}粮草`); }
  });
  EXT.counter.push((can, state, attacker, defender) => {
    if (isId(defender, 'lbiao_liu_cong')) return false;
    if (isId(defender, 'dz_guo_si') && isStrategist(state, attacker)) return true;
    return can;
  });
  EXT.cannotAttack.push((state, unit) => isId(unit, 'xl_song_jian'));
  EXT.longRange.push((state, unit) => isId(unit, 'ys_qiang_nu'));
  EXT.hqAttackMult.push((m, state, unit) => (isId(unit, 'ys_jue_zi') ? m * 2 : m));
  EXT.ignoresJianZhen.push(unit => isId(unit, 'ys_gao_lan') || isId(unit, 'lbiao_huang_zhong') || isId(unit, 'yshu_sun_ce'));
  // 刘琦·合兵：对战伤害同样互相转移
  EXT.combatDamage.push((amount, state, unit) => {
    if (!unit._heBing || state._heBingBusy) return amount;
    const partner = findUnit(state, unit._heBing)?.unit;
    const linked = partner && partner.faction === unit.faction && (isId(unit, 'lbiao_liu_qi') || isId(partner, 'lbiao_liu_qi'));
    if (!linked) return amount;
    state._heBingBusy = true;
    try { damageUnit(state, partner, amount, '合兵转移'); } finally { state._heBingBusy = false; }
    log(state, unit.faction, `刘琦·合兵：【${unit.name}】受到的${amount}点伤害转由【${partner.name}】承受`);
    return 0;
  });
  // 诸葛亮·对策：己方军队成为攻击目标时+1+1
  EXT.attacked.push((state, defender) => {
    if (!defender || defender.troopType === TROOP_TYPES.STRATEGIST) return;
    for (const _ of ownWith(state, defender.faction, 'shu_zhu_ge_liang_cl')) { buff(defender, 1, 1); log(state, defender.faction, `诸葛亮·对策：【${defender.name}】+1+1`); }
  });
  EXT.discard.push(onDiscard);
  ACTIVE_SKILLS.yshu_yan_xiang = {
    name: '直谏', desc: '弃1张手牌，抽1张牌（每回合1次）', needsHandCard: true, handPrompt: '点一张手牌弃置',
    apply(state, unit, payload) {
      const card = state.players[unit.faction].hand.find(c => c.instanceId === payload?.cardId);
      if (!card) throw new Error('请选择要弃置的手牌');
      discardFromHand(state, unit.faction, card, '阎象·直谏');
      drawCard(state, unit.faction);
    }
  };
  const tieQi = (state, unit) => unit.troopType === TROOP_TYPES.CAVALRY && Boolean(state.turnEffects?.[unit.faction]?.f2TieQi);
  EXT.ignoresGuardian.push(tieQi);
  EXT.ignoresWeiWo.push(tieQi);
  EXT.taunt.push((state, unit) => isId(unit, 'ys_yan_liang') && canSkillTarget(unit));
  EXT.turnStart.push((state, pid) => {
    for (const u of ownWith(state, pid, 'ys_chun_yu_qiong')) {
      if (u._attackedOnTurn !== state.turnNumber - 1) {
        buff(u, -1, -1);
        log(state, pid, '淳于琼·骄惰：上回合未受攻击，-1-1');
        if (u.hp <= 0) removeUnitFromBoard(state, u.instanceId);
      }
    }
    // 杨奉·护驾到期
    for (const u of getAllUnits(state, pid).filter(x => x._huJia)) { u._huJia = false; const i = u.keywords.indexOf('守护'); if (i !== -1) u.keywords.splice(i, 1); }
  });
  EXT.tactic.push((state, owner) => {
    // 郭图·误策：双方使用战法时，使己方任一目标受到2点伤害
    for (const side of [owner, opp(owner)]) {
      for (const _ of ownWith(state, side, 'ys_guo_tu')) queueOwnTarget(state, side, 2, '郭图·误策');
    }
    // 贾诩·乱武：己方使用战法时，对1个敌方目标造成2伤害并抑制（目标由对手指定）
    for (const _ of ownWith(state, owner, 'dz_jia_xu')) {
      const list = getAllUnits(state, opp(owner)).filter(canSkillTarget);
      if (list.length) pickOrQueue(state, opp(owner), 'f2Sacrifice', null, list, { amount: 2, inhibit: true, source: '贾诩·乱武', prompt: '贾诩·乱武：选择己方1个单位受到2伤害并被抑制' });
      else damageHq(state, opp(owner), 2, '贾诩·乱武');
    }
  });
  // 袁绍·盟主：己方每次摸牌时，额外摸1张（额外摸的牌不再触发盟主，但会触发沮授等摸牌效果）
  EXT.draw.push((state, pid) => {
    if (state._mengZhu) return;
    const n = countOf(state, pid, 'ys_yuan_shao');
    if (!n) return;
    state._mengZhu = true;
    try { for (let i = 0; i < n; i++) drawCard(state, pid); } finally { state._mengZhu = false; }
  });
  EXT.draw.push((state, pid, card) => {
    const p = state.players[pid];
    if (!card || !p.hand.includes(card) || !p.deck.length || state._yuanMouBusy) return;
    if (!countOf(state, pid, 'ys_ju_shou')) return;
    const top = p.deck[0];
    pickOrQueue(state, pid, 'f2YuanMou', null, [{ instanceId: 'keep', name: `留下【${card.name}】` }, { instanceId: 'swap', name: `换成【${top.name}】` }], { drawnId: card.instanceId, topId: top.instanceId });
  });
  EXT.moved.push((state, unit, from, to) => {
    unit._acted = true;
    if (from === 'SUPPORT' && to === 'FRONTLINE' && (isId(unit, 'ys_yan_liang') || isId(unit, 'ys_wen_chou'))) { buff(unit, 1, 1); log(state, unit.faction, `${unit.name}·先锋：+1+1`); }
    if (isId(unit, 'hj_zhang_yan') && unit._feiYan !== state.turnNumber && unit.faction === state.activePlayer) feiYan(state, unit);
    hengJiang(state, unit, to);
  });
  EXT.youJi.push((state, unit) => {
    if (isId(unit, 'xl_qiang_hu')) { drawCard(state, unit.faction); log(state, unit.faction, '羌胡游骑：游击，抽1张牌'); }
    for (const _ of ownWith(state, unit.faction, 'xl_bei_gong')) { drawCard(state, unit.faction); log(state, unit.faction, '北宫伯玉·狼遁：抽1张牌'); }
  });
  EXT.luLue.push((state, pid, choice, opt, amount) => {
    const src = findUnit(state, choice?.sourceId)?.unit;
    if (!src) return;
    src._luLueTurn = state.turnNumber;
    if (isId(src, 'yshu_liu_kou') && placeUnit(state, pid, makeCard(state, pid, 'yshu_liu_kou'), 'SUPPORT')) log(state, pid, '流寇：掳掠后复制1个流寇');
    if (isId(src, 'dz_li_jue') && amount > 0) damageHq(state, opp(pid), amount, '李傕·焚城');
    if (isId(src, 'dz_yang_ding')) {
      pickOrQueue(state, opp(pid), 'f2Sacrifice', null, getAllUnits(state, opp(pid)).filter(canSkillTarget), { amount: 1, source: '杨定·驰阵', prompt: '杨定·驰阵：选择己方1个单位受到1伤害' });
    }
  });
  PRESTIGE_OVERFLOW_HOOKS.push((state, pid, overflow) => {
    for (const _ of ownWith(state, pid, 'ys_zheng_xuan')) damageHq(state, opp(pid), 2 * overflow, '郑玄·鸿儒');
  });
}
