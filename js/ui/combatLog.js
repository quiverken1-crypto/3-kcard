/**
 * combatLog.js — Real-Time Three Kingdoms Campaign Chronicle & Combat Log Controller
 * Three Kingdoms KARDS (Milestone 4)
 *
 * Implements:
 * 1. Event Translation: Maps 12+ domain engine events into martial Three Kingdoms chronicles.
 * 2. Visual Badging: Classifies logs into TURN, DEPLOY, COMBAT, TACTIC categories with custom badges.
 * 3. History Retention & Filtering: Real-time scrolling feed with tab filter and clear tools.
 */

import { escapeHtml, getCardDescription } from './cardRenderer.js';

import { seatArmy } from './seats.js';

export function getFactionName(faction) {
  if (faction === 'WEI' || faction === 'SHU') return seatArmy(faction);
  return faction || '中立军';
}

export function formatZoneName(zone) {
  if (!zone) return '战地';
  if (typeof zone !== 'string') return String(zone);
  if (zone === 'SUPPORT') return '支援阵线';
  if (zone.includes('LEFT')) return '左前线';
  if (zone.includes('CENTER')) return '中前线';
  if (zone.includes('RIGHT')) return '右前线';
  return zone;
}

export class CombatLogController {
  /**
   * @param {HTMLElement} containerEl - Container element (#combat-log-feed)
   * @param {object} [options={}]
   */
  constructor(containerEl, options = {}) {
    this.container = containerEl || document.getElementById('combat-log-feed');
    this.maxEntries = options.maxEntries || 200;
    this.filter = 'ALL'; // 'ALL' | 'COMBAT' | 'DEPLOY' | 'TACTIC'
    this.entries = [];
    this.feedEl = null;

    this.init();
  }

  init() {
    if (!this.container) return;

    // Check if the container is already the feed or an outer container
    if (this.container.id === 'combat-log-feed' || this.container.classList.contains('combat-log-stream')) {
      this.feedEl = this.container;
    } else {
      this.container.innerHTML = `
        <div class="combat-log-header">
          <span class="log-title">📜 战场演义实录</span>
          <div class="log-filter-tabs">
            <button class="filter-tab active" data-filter="ALL">全览</button>
            <button class="filter-tab" data-filter="COMBAT">交锋</button>
            <button class="filter-tab" data-filter="DEPLOY">调兵</button>
            <button class="filter-tab" data-filter="TACTIC">战法</button>
          </div>
        </div>
        <div class="combat-log-feed"></div>
      `;
      this.feedEl = this.container.querySelector('.combat-log-feed');

      this.container.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          this.container.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
          e.target.classList.add('active');
          this.setFilter(e.target.dataset.filter);
        });
      });
    }

    // Bind clear log button if present in DOM
    if (typeof document !== 'undefined') {
      const clearBtn = document.getElementById('btn-clear-log');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => this.clear());
      }
    }
  }

  pushEvent(event) {
    if (!event) return;
    const entry = this.formatEventToEntry(event);
    if (!entry) return;

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    if (this.shouldDisplay(entry) && this.feedEl) {
      this.renderEntry(entry);
    }
  }

  logEvents(events) {
    if (!Array.isArray(events)) return;
    for (const evt of events) {
      this.pushEvent(evt);
    }
  }

  logSystem(text) {
    this.pushEvent({
      type: 'SYSTEM_MESSAGE',
      payload: { message: text }
    });
  }

  clear() {
    this.entries = [];
    if (this.feedEl) {
      this.feedEl.innerHTML = '';
    }
  }

  formatEventToEntry(event) {
    if (!event) return null;
    let type = event.type || 'UNKNOWN';

    // Support flat engine events and nested { type, payload } structures
    const p = { ...(event.payload || {}) };
    for (const [key, val] of Object.entries(event)) {
      if (key !== 'payload' && key !== 'type' && p[key] === undefined) {
        p[key] = val;
      }
    }

    // Type aliases from rulesEngine / combat
    if (type === 'DEPLOY') type = 'UNIT_DEPLOYED';
    if (type === 'MOVE') type = 'UNIT_MOVED';
    if (type === 'FATIGUE') type = 'FATIGUE_DAMAGE';

    // 1. cardName / unitName mapping
    const cardObj = p.card || event.card;
    const resolvedCardName = p.cardName || p.unitName || (cardObj && typeof cardObj === 'object' ? cardObj.name : (typeof cardObj === 'string' ? cardObj : ''));
    if (resolvedCardName && !p.cardName) p.cardName = resolvedCardName;
    if (resolvedCardName && !p.unitName) p.unitName = resolvedCardName;

    // 2. attackerName mapping
    const attackerObj = p.attacker || event.attacker;
    const resolvedAttacker = p.attackerName || (attackerObj && typeof attackerObj === 'object' ? attackerObj.name : (typeof attackerObj === 'string' ? attackerObj : ''));
    if (resolvedAttacker && !p.attackerName) p.attackerName = resolvedAttacker;

    // 3. defenderName mapping
    const defenderObj = p.defender || event.defender;
    const resolvedDefender = p.defenderName || (defenderObj && typeof defenderObj === 'object' ? defenderObj.name : (typeof defenderObj === 'string' ? defenderObj : ''));
    if (resolvedDefender && !p.defenderName) p.defenderName = resolvedDefender;

    // 4. damage / counterDealt mapping
    const resolvedDamage = p.damageDealt ?? p.damage ?? p.attackerDamage ?? 0;
    if (p.damageDealt === undefined) p.damageDealt = resolvedDamage;
    if (p.damage === undefined) p.damage = resolvedDamage;
    if (p.counterDealt === undefined && (p.defenderDamage !== undefined || p.counterDamage !== undefined)) {
      p.counterDealt = p.defenderDamage ?? p.counterDamage ?? 0;
    }

    // 5. cost & discount mapping
    if (p.cost === undefined && event.cost !== undefined) p.cost = event.cost;
    if (p.prestigeDiscount === undefined && (p.discountApplied !== undefined || event.discountApplied !== undefined)) {
      p.prestigeDiscount = p.discountApplied ?? event.discountApplied ?? 0;
    }

    // 6. zone mapping
    const resolvedZone = p.targetZone || p.toZone || p.zone || event.targetZone || event.toZone;
    if (resolvedZone && !p.targetZone) p.targetZone = resolvedZone;
    if (resolvedZone && !p.toZone) p.toZone = resolvedZone;

    const resolvedFrom = p.fromZone || event.fromZone;
    if (resolvedFrom && !p.fromZone) p.fromZone = resolvedFrom;

    // 7. faction mapping
    if (!p.faction && (p.playerId || event.playerId)) {
      p.faction = p.playerId || event.playerId;
    }

    // 8. fatigueCount mapping
    if (p.fatigueCount === undefined && (p.count !== undefined || event.count !== undefined)) {
      p.fatigueCount = p.count ?? event.count;
    }

    const timestamp = typeof Date !== 'undefined'
      ? new Date().toLocaleTimeString('zh-CN', { hour12: false })
      : '00:00:00';

    let category = 'COMBAT';
    let text = '';
    let badge = '战';
    let cssClass = 'entry-combat';

    switch (type) {
      case 'TURN_STARTED':
        category = 'TURN';
        cssClass = 'entry-turn';
        badge = '回';
        text = `<strong>第 ${p.turnNumber || 1} 回合 · ${getFactionName(p.activePlayer)}</strong>　粮草 ${p.provisions || 0} · 声望 ${p.prestige || 0}`;
        break;

      case 'UNIT_DEPLOYED':
        category = 'DEPLOY';
        cssClass = 'entry-deploy';
        badge = '调';
        const discountText = p.prestigeDiscount > 0 ? ` (声望减免 -${p.prestigeDiscount})` : '';
        text = `【调兵遣将】<strong>${getFactionName(p.faction)}</strong> 遣【${escapeHtml(p.cardName || p.cardId)}】进驻 <em>${formatZoneName(p.targetZone || 'SUPPORT')}</em>，耗粮 ${p.cost ?? 0}${discountText}。`;
        break;

      case 'UNIT_MOVED':
        category = 'DEPLOY';
        cssClass = 'entry-move';
        badge = '军';
        text = `【行军推进】<strong>${getFactionName(p.faction)}</strong>【${escapeHtml(p.unitName || p.cardName)}】自 ${formatZoneName(p.fromZone || 'SUPPORT')} 进占 <em>${formatZoneName(p.toZone)}</em>！`;
        break;

      case 'TACTIC_PLAYED':
        category = 'TACTIC';
        cssClass = 'entry-tactic';
        badge = '策';
        text = `<strong>${getFactionName(p.faction)}</strong> 施放战法【${escapeHtml(p.cardName)}】${p.targetName ? `，目标【${escapeHtml(p.targetName)}】` : ''}`;
        break;

      case 'COUNTER_SET':
        category = 'TACTIC';
        cssClass = 'entry-counter';
        badge = '伏';
        text = p.playerId ? `【暗置反制】${getFactionName(p.faction)} 已设下反制战法。` : '【暗置反制】战法已设下。';
        break;

      case 'ABILITY_TRIGGERED':
        category = 'TACTIC';
        cssClass = 'entry-tactic';
        badge = '技';
        text = `【技能触发】${getFactionName(p.faction)}【${escapeHtml(p.cardName)}】在 ${escapeHtml(p.trigger)} 时发动：${(p.effects || []).map(escapeHtml).join('、')}`;
        break;

      case 'COMBAT_DAMAGE':
        category = 'COMBAT';
        if (p.ambushTriggered) {
          cssClass = 'entry-ambush';
          badge = '伏';
          text = `【伏兵暴起】守将【${escapeHtml(p.defenderName)}】设【伏击】猝然先制！击伤【${escapeHtml(p.attackerName)}】${p.counterDealt} 点！${p.attackerDied ? '攻方当场阵亡！' : ''}`;
        } else if (p.banished) {
          cssClass = 'entry-banish';
          badge = '斩';
          text = `【阵前斩将】【${escapeHtml(p.attackerName)}】神勇斩将，手起刀落直接阵斩【${escapeHtml(p.defenderName)}】！`;
        } else if (p.vanguardImmunity) {
          cssClass = 'entry-vanguard';
          badge = '登';
          text = `【先登破阵】【${escapeHtml(p.attackerName)}】先登破敌，击毙【${escapeHtml(p.defenderName)}】且免受反击！`;
        } else {
          cssClass = 'entry-combat';
          badge = '交';
          text = `【两军交锋】【${escapeHtml(p.attackerName)}】击伤【${escapeHtml(p.defenderName)}】${p.damageDealt} 点！守方反击造成 ${p.counterDealt} 点！` +
            (p.defenderDied ? ` 【${escapeHtml(p.defenderName)}】阵亡！` : '') +
            (p.attackerDied ? ` 【${escapeHtml(p.attackerName)}】力竭战死！` : '');
        }
        break;

      case 'ATTACK_HQ':
        category = 'COMBAT';
        cssClass = 'entry-hq';
        badge = '城';
        const stealTxt = p.provisionsStolen > 0 ? ` (攻心掠夺粮草 1 点!)` : '';
        text = p.damageDealt > 0
          ? `<strong>${getFactionName(p.faction)}</strong>【${escapeHtml(p.attackerName)}】攻城，造成 <strong>${p.damageDealt}</strong> 点伤害（余 ${p.hqHpRemaining ?? p.hqRemaining}）${stealTxt}`
          : `<strong>${getFactionName(p.faction)}</strong>【${escapeHtml(p.attackerName)}】攻城，伤害被主城防御抵消`;
        break;

      case 'OVERFLOW_DAMAGE':
        category = 'COMBAT';
        cssClass = 'entry-overflow';
        badge = '穿';
        text = `【矢石及远】攻城余威震荡，<strong>${p.damage}</strong> 点溢出伤害穿透波及敌军城池！`;
        break;

      case 'FIRE_ATTACK':
        category = 'TACTIC';
        cssClass = 'entry-fire';
        badge = '火';
        text = `【火烧连营】烈焰借风势蔓延！【${escapeHtml(p.attackerName)}】之火攻重创相邻敌阵 <strong>${p.splashDamage}</strong> 点！`;
        break;

      case 'COUNTER_TRIGGERED':
        category = 'TACTIC';
        cssClass = 'entry-counter';
        badge = '密';
        text = `【暗度陈仓】敌军踏入陷阱！<strong>${getFactionName(p.faction)}</strong> 反制战法【${escapeHtml(p.counterName)}】掀开！`;
        break;

      case 'FATIGUE_DAMAGE':
        category = 'COMBAT';
        cssClass = 'entry-fatigue';
        badge = '竭';
        text = `【兵疲粮绝】${getFactionName(p.faction)} 粮尽援绝！第 ${p.fatigueCount} 次士气透支，主城遭受 <strong>${p.damage}</strong> 点重创！`;
        break;

      case 'GAME_OVER':
        category = 'TURN';
        cssClass = 'entry-victory';
        badge = '胜';
        text = `🏆【天下归一】<strong>${getFactionName(p.winnerFaction || p.winner)}</strong> 平定天下，鼎定乾坤！`;
        break;
        break;

      case 'REPOSITION':
        category = 'DEPLOY';
        cssClass = 'entry-move';
        badge = '列';
        text = `${getFactionName(p.faction)}【${escapeHtml(p.unitName)}】调整站位`;
        break;

      case 'SKILL':
        category = 'TACTIC';
        cssClass = 'entry-skill';
        badge = '技';
        text = `<strong>${getFactionName(p.faction || event.playerId)}</strong> ${escapeHtml(event.message || p.message)}`;
        break;

      case 'SKILL_DAMAGE':
        category = 'COMBAT';
        cssClass = 'entry-combat';
        badge = '伤';
        text = `【${escapeHtml(event.source || '技能')}】对【${escapeHtml(event.unitName)}】造成 <strong>${event.damage}</strong> 点伤害`;
        break;

      case 'HQ_DAMAGED':
        category = 'COMBAT';
        cssClass = 'entry-combat';
        badge = '城';
        text = `${getFactionName(event.playerId)}主城受到【${escapeHtml(event.source || '技能')}】${event.damage} 点伤害（余 ${event.hqHpRemaining}）`;
        break;

      case 'SYSTEM_MESSAGE':
        category = 'TURN';
        cssClass = 'entry-turn';
        badge = '令';
        text = escapeHtml(p.message);
        break;

      case 'PRESTIGE_ADJUSTED':
        category = 'TURN';
        cssClass = 'entry-turn';
        badge = '望';
        text = `${getFactionName(p.gainer)} 争得声望（${getFactionName(p.gainer)} ${p.gainerPrestige ?? 0} · 对方 ${p.opponentPrestige ?? 0}）`;
        break;

      case 'CARD_DRAWN':
        return null; // 抽牌过于频繁，不计入战报

      case 'CARD_BURNED':
        category = 'TURN';
        cssClass = 'entry-fatigue';
        badge = '弃';
        text = `${getFactionName(p.faction)} 手牌已满，【${escapeHtml(p.cardName || '一张牌')}】被弃置`;
        break;

      case 'DRAW_SKIPPED':
        category = 'TURN';
        cssClass = 'entry-turn';
        badge = '回';
        text = `${getFactionName(p.faction)} 先手首回合不抽牌`;
        break;

      case 'JU_ZHONG_BUFF':
        category = 'TACTIC';
        cssClass = 'entry-skill';
        badge = '技';
        text = `【${escapeHtml(p.name)}】聚众：战力 ${p.newAtk}、生命 ${p.newHp}`;
        break;

      default: {
        const msg = event.message || p.message;
        if (typeof msg !== 'string' || !msg) return null; // 未知事件不再输出原始数据
        text = escapeHtml(msg);
      }
    }

    return {
      id: `log_${Date.now()}_${Math.random()}`,
      category,
      cssClass,
      badge,
      text,
      timestamp
    };
  }

  renderEntry(entry) {
    if (!this.feedEl) return;
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    const itemEl = doc.createElement('div');
    itemEl.className = `log-entry ${entry.cssClass}`;
    itemEl.dataset.id = entry.id;

    itemEl.innerHTML = `
<span class="log-badge">${entry.badge}</span><span class="log-text">${entry.text}</span>`;

    this.feedEl.appendChild(itemEl);
    // 界面上只保留最近的若干条，DOM 不再无限增长
    const cap = 120;
    while (this.feedEl.childElementCount > cap) this.feedEl.firstElementChild.remove();
    this.scrollToBottom();
  }

  scrollToBottom() {
    // 合并到下一帧只滚一次：连续记多条战报时不再每条都强制重排
    // 注意：读 scrollTop 会强制重排，这里只判断属性是否存在；战报抽屉收起时不滚动
    if (!this.feedEl || !('scrollTop' in this.feedEl) || this._scrollQueued) return;
    this._scrollQueued = true;
    const run = () => {
      this._scrollQueued = false;
      const el = this.feedEl;
      if (!el || el.closest?.('.collapsed')) return;
      el.scrollTop = el.scrollHeight;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
  }

  setFilter(filter) {
    this.filter = filter;
    if (!this.feedEl) return;
    this.feedEl.innerHTML = '';
    this.entries
      .filter(e => this.shouldDisplay(e))
      .forEach(e => this.renderEntry(e));
  }

  shouldDisplay(entry) {
    if (this.filter === 'ALL') return true;
    return entry.category === this.filter;
  }
}

export default CombatLogController;
