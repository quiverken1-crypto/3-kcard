/**
 * cardRenderer.js — Card, Token, Fan Geometry & Tooltip Rendering
 * Three Kingdoms KARDS (Milestone 4)
 *
 * Implements:
 * 1. renderHandCard: Generates interactive player hand cards with prestige discounts.
 * 2. renderHiddenCard: Renders opponent face-down masked cards.
 * 3. renderUnitOnBoard: Generates compact battlefield units with status badges and stats.
 * 4. CardInspector: Singleton hover tooltip with viewport clamping and keyword glossary.
 * 5. applyFanGeometry: Mathematically distributes 1~9 hand cards along a natural arc.
 */

import { KINGDOMS } from '../data/cardDB.js';
import { cardKingdom, kingdomOf } from './seats.js';

/** 词条释义：内置词条 + 自定义词条（registerKeyword 加入，不覆盖内置） */
export const KEYWORD_GLOSSARY = ({
  '奋战': '【奋战】每回合可以攻击2次。',
  '斩将': '【斩将】攻击时，若自身战力大于敌军则将其移除；对伏击、潜袭单位无效。',
  '冲阵': '【冲阵】首次攻击敌军时不受反击，而后失去冲阵；对伏击无效。',
  '先登': '【先登】攻击时先造成伤害，若将其击败则自身不受反击；对伏击、潜袭单位无效。',
  '矢石': '【矢石】攻击只会受到矢石单位的反击。',
  '攻心': '【攻心】攻击时，无视防御词条。',
  '掳掠': '【掳掠】攻击击败敌军并存活时，摸1张牌或补充等同于当前自身2倍行动花费的粮草。',
  '火攻': '【火攻】击败敌军后，对同一区域相邻目标传递等量伤害（无视坚阵），可连续传递。',
  '坚阵': '【坚阵X】受到对战伤害时伤害减少X（上限3），无法减免能力造成的伤害。',
  '守护': '【守护】保护相邻的非守护目标（含主城）不被敌军优先攻击。',
  '帷幄': '【帷幄】首次行动前无法成为攻击目标，对攻心无效。',
  '警戒': '【警戒】无法成为敌方战法或反制战法的指向目标。',
  '伏击': '【伏击】每回合首次被攻击时先造成伤害，若敌军因此被消灭则自己不受伤害。',
  '突袭': '【突袭】进场的回合可以立即行动。',
  '潜袭': '【潜袭】背面进场，行动花费视为1，不受战法影响；交战时揭示。',
  '游击': '【游击】可从前线移动回支援阵线。',
  '奇袭': '【奇袭】部署时可直接部署在没有敌方单位的前线。',
  '补给': '【补给】在场时，己方粮草上限额外+1，可叠加。',
  '声望': '【声望X】进场/使用时己方声望+X（对手有声望则改为扣减对手）。',
  '奇谋': '【奇谋X】在场时，己方战法和反制战法花费-X，可叠加。',
  '治军': '【治军】相同兵种的其他友军行动花费-1。',
  '督战': '【督战】相邻友方军队（不含谋士）战力+1。',
  '降将': '【降将】可组入其他势力的牌组；被击败后进入敌方弃牌区。',
  '聚众': '【聚众】回合开始时+1+1，受到伤害后失去聚众。',
  '幕僚': '【幕僚】己方回合结束时，若位于支援阵线，己方主城恢复1点生命。',
  '护卫': '【护卫】同区域友军被攻击时，改由护卫单位承受此次攻击（谋士与铁骑同样适用）。',
  '侦查': '【侦查X】进场时查看己方牌库顶X张牌，费用过高的牌将被置于牌库底。',
  '使节': '【使节】在场时己方主城免受伤害。',
  '溢出转移': '【溢出转移】击杀敌军后溢出伤害转移到敌方主城。'
});
const BUILTIN_KEYWORDS = Object.freeze(Object.keys(KEYWORD_GLOSSARY));
export const builtinKeywords = () => [...BUILTIN_KEYWORDS];
export function registerKeyword(name, description) {
  if (!name || BUILTIN_KEYWORDS.includes(name)) return;
  KEYWORD_GLOSSARY[name] = `【${name}】${description || '自定义词条'}`;
}

export const TRAIT_GLOSSARY = Object.freeze({
  '名士': '性格·名士',
  '狂傲': '性格·狂傲：受【诱敌深入】伤害翻倍',
  '鲁莽': '性格·鲁莽：受【诱敌深入】伤害翻倍',
  '二心': '性格·二心：可被【策反】无视花费控制',
  '皇叔': '性格·皇叔',
  '皇亲': '性格·皇亲',
  '暴虐': '性格·暴虐',
  '枭雄': '性格·枭雄'
});

/** 卡面插画（取自魏蜀图鉴） */
const COMMON_ART = new Set(['shipo', 'shanjia', 'cefan', 'shengdong', 'jueshui', 'chengsheng', 'youdi', 'tuchi', 'tuqi', 'andu']);
const NO_ART = new Set(['shu_huang_quan', 'shu_yi_shou_wei_gong', 'shu_fu_tong', 'wu_pan_zhang', 'wu_sun_quan', 'wu_zhou_tai', 'wu_cheng_pu', 'lb_chen_gong', 'lb_lv_bu', 'wei_guo_jia_x']);
export function getCardArtUrl(card) {
  const id = String(card?.cardId || '').replace(/_[0-9]+$/, '');
  const m = id.match(/^(wei|shu|wu|lb)_([a-z_]+)$/);
  if (!m || NO_ART.has(id)) return '';
  if (COMMON_ART.has(m[2])) return `assets/cards/common_${m[2]}.webp`;
  return `assets/cards/${id}.webp`;
}

function artStyle(card) {
  const url = getCardArtUrl(card);
  return url ? ` style="background-image:url('${url}')"` : '';
}

function traitsHtml(card, cls = 'card-traits') {
  const badges = Array.isArray(card?.badges) ? card.badges : [];
  if (!badges.length) return '';
  return `<div class="${cls}">${badges.map(b => `<span class="trait-tag trait-${b}" title="${escapeHtml(TRAIT_GLOSSARY[b] || b)}">${escapeHtml(b)}</span>`).join('')}</div>`;
}

const LEGACY_CARD_DESCRIPTIONS = Object.freeze({});

export function getTroopTypeLabel(troopType, cardType) {
  if (cardType === 'TACTIC') return '战法';
  if (cardType === 'COUNTER') return '反制';
  const map = {
    'INFANTRY': '步兵',
    'CAVALRY': '骑兵',
    'ARCHER': '器械',
    'NAVY': '水军',
    'STRATEGIST': '谋士'
  };
  return Object.hasOwn(map, troopType) ? map[troopType] : '单位';
}

export function getTroopTypeIcon(troopType, cardType) {
  if (cardType === 'TACTIC') return '📜';
  if (cardType === 'COUNTER') return '🪤';
  const map = {
    'INFANTRY': '🛡️',
    'CAVALRY': '🐎',
    'ARCHER': '⚙️',
    'NAVY': '⛵',
    'STRATEGIST': '🪶'
  };
  return Object.hasOwn(map, troopType) ? map[troopType] : '⚔️';
}

export function getMiniKeywordBadge(kw) {
  if (!kw) return '';
  const str = String(kw || '');
  return str.charAt(0);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getCardDescription(card) {
  const description = card?.skill?.description?.trim();
  // 工坊里标“待实现”的文字技能：对局中暂不生效，卡面注明
  if (description) return card.pending ? `${description}（技能待实现）` : description;
  if (LEGACY_CARD_DESCRIPTIONS[card?.cardId]) return LEGACY_CARD_DESCRIPTIONS[card.cardId];
  const keywords = Array.isArray(card?.keywords) ? card.keywords : [];
  return keywords.length ? keywords.map(kw => KEYWORD_GLOSSARY[kw.replace(/[0-9]/g, '')] || `【${kw}】当前对局尚未实现此词条效果。`).join(' ') : '无特殊能力';
}

/** 手牌卡面上去掉与词条标签重复的“【奋战】【声望】。”前缀 */
export function stripKeywordPrefix(text) {
  const t = String(text || '').replace(/^(【[^】]+】)+[。．.]?\s*/, '');
  return t || text;
}

export function showCardDetails(card) {
  if (!card || card.isHidden || card.status?.isFaceDown) return;
  const doc = typeof document !== 'undefined' ? document : globalThis.document;
  const modal = doc?.getElementById('modal-card-inspector');
  if (!modal) return;
  CardInspector.hide();
  const setText = (id, value) => { const el = doc.getElementById(id); if (el) el.textContent = value; };
  setText('inspector-card-name', card.name || '无名卡牌');
  setText('inspector-faction-badge', `势力：${KINGDOMS[cardKingdom(card)]?.name || ''}`);
  setText('inspector-troop-badge', `类别：${getTroopTypeLabel(card.troopType, card.type)}`);
  setText('inspector-cost-badge', `粮草：${card.cost ?? 0}`);
  setText('inspector-action-cost-badge', card.type === 'UNIT' ? `行动：${card.actionCost ?? 1}` : '即时战法');
  setText('inspector-skill-text', getCardDescription(card));
  setText('inspector-flavor-text', card.flavor || '暂无卡牌背景');
  const glossary = doc.getElementById('inspector-keywords-glossary');
  if (glossary) {
    const keywords = Array.isArray(card.keywords) ? card.keywords : [];
    glossary.replaceChildren(...keywords.map(kw => {
      const item = doc.createElement('p');
      item.textContent = KEYWORD_GLOSSARY[kw.replace(/[0-9]/g, '')] || `【${kw}】`;
      return item;
    }));
    if (!keywords.length) glossary.textContent = '无词条';
  }
  const preview = doc.getElementById('inspector-card-preview-slot');
  if (preview) {
    const clone = renderHandCard(card);
    clone.querySelector('.card-info-button')?.remove();
    preview.replaceChildren(clone);
  }
  modal.classList.remove('hidden');
}

/**
 * Generates an interactive hand card DOM element.
 * @param {object} card - CardInstance object
 * @param {object} [options={}] - Options (isOpponent, prestigeDiscount, etc.)
 * @returns {HTMLElement}
 */
export function renderHandCard(card, options = {}) {
  const doc = typeof document !== 'undefined' ? document : globalThis.document;
  if (!doc) return null;

  const isOpponent = Boolean(options.isOpponent || card.isHidden);
  if (isOpponent) {
    return renderHiddenCard(card, options);
  }

  const el = doc.createElement('div');
  const faction = cardKingdom(card);
  const cardType = (card.type || 'unit').toLowerCase();
  el.className = `card card-hand game-card card-${faction} faction-${faction} type-${cardType}`;
  el.dataset.instanceId = card.instanceId || '';
  el.dataset.cardId = card.cardId || '';
  el.dataset.cardType = card.type || 'UNIT';
  el.dataset.troopType = card.troopType || 'NONE';

  // Calculate dynamic prestige discount if applicable
  const originalCost = card.cost ?? 0;
  const discount = (card.type === 'UNIT' && options.prestigeDiscount) ? options.prestigeDiscount : 0;
  const effectiveCost = Math.max(0, originalCost - discount);
  const isDiscounted = discount > 0;

  // Cost Badges
  const costHtml = `
    <div class="card-cost-seal card-cost-badge ${isDiscounted ? 'cost-discounted' : ''}" title="部署粮草消耗: ${effectiveCost}">
      <span class="cost-value">${effectiveCost}</span>
      ${isDiscounted ? `<span class="cost-original">${originalCost}</span>` : ''}
    </div>
  `;

  // Action Cost Badge (Units only)
  const actionCostHtml = card.type === 'UNIT' ? `
    <div class="card-action-cost-badge" title="行动粮草消耗: ${card.actionCost ?? 1}">
      ⚡${card.actionCost ?? 1}
    </div>
  ` : '';

  // Troop Banner
  const troopLabel = getTroopTypeLabel(card.troopType, card.type);
  const troopIcon = getTroopTypeIcon(card.troopType, card.type);
  const troopHtml = `
    <div class="card-troop-banner troop-${(card.troopType || 'none').toLowerCase()}">
      <span class="troop-crest-icon">${troopIcon}</span>
      <span class="troop-label">${troopLabel}</span>
    </div>
  `;

  // Keywords
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const keywordsHtml = keywords.length > 0 ? `
    <div class="card-keywords-container keyword-tag-list">
      ${keywords.map(kw => `<span class="keyword-badge keyword-chip" data-keyword="${kw}">${kw}</span>`).join('')}
    </div>
  ` : '';

  // Skill description text
  const skillDesc = getCardDescription(card);

  // Stats Footer (for Units)
  const statsHtml = card.type === 'UNIT' ? `
    <div class="card-footer-stats card-stats-footer">
      <div class="stat-disc stat-badge stat-atk" title="攻击力: ${card.atk}">
        <span class="stat-value">${card.atk}</span>
      </div>
      <div class="stat-disc stat-badge stat-hp" title="生命值: ${card.hp}/${card.maxHp || card.hp}">
        <span class="stat-value">${card.hp}</span>
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="card-inner-frame">
      <div class="card-header card-header-bar">
        ${costHtml}
        <div class="card-name-banner card-title-text" title="${escapeHtml(card.name)}">
          ${escapeHtml(card.name)}
        </div>
        ${actionCostHtml}
      </div>
      ${troopHtml}
      <div class="card-art-frame">
        <div class="card-art-placeholder faction-bg${getCardArtUrl(card) ? ' has-art' : ''}"${artStyle(card)}></div>
        ${traitsHtml(card)}
      </div>
      <div class="card-body card-text-pane">
        ${keywordsHtml}
        <div class="card-description">
          <p>${escapeHtml(stripKeywordPrefix(skillDesc))}</p>
        </div>
      </div>
      ${statsHtml}
    </div>
  `;

  // Attach hover inspector events if in browser
  attachInspectorEvents(el, card);

  return el;
}

/**
 * Renders masked opponent hand card (face-down).
 * @param {object} card - Masked card object
 * @param {object} options
 * @returns {HTMLElement}
 */
export function renderHiddenCard(card, options = {}) {
  const doc = typeof document !== 'undefined' ? document : globalThis.document;
  if (!doc) return null;

  const el = doc.createElement('div');
  const faction = kingdomOf(options.faction || 'WEI');
  el.className = `card card-hand card-hidden game-card faction-${faction} card-${faction}`;
  el.dataset.instanceId = card?.instanceId || '';
  el.dataset.isHidden = 'true';

  el.innerHTML = `
    <div class="card-back-pattern">
      <div class="card-back-border">
        <div class="card-back-crest">
          <span class="crest-character">${KINGDOMS[faction]?.name || ''}</span>
        </div>
      </div>
    </div>
  `;
  return el;
}

/**
 * Generates a compact battlefield unit element.
 * @param {object} unit - Runtime Unit CardInstance
 * @param {object} [options={}] - Options
 * @returns {HTMLElement}
 */
export function renderUnitOnBoard(unit, options = {}) {
  const doc = typeof document !== 'undefined' ? document : globalThis.document;
  if (!doc) return null;

  const el = doc.createElement('div');
  const faction = cardKingdom(unit);
  // 潜袭翻面：己方可见真身，只对对手隐藏
  const ownStealth = Boolean(unit.status?.isFaceDown && !unit.isHidden && options.viewerFaction && unit.faction === options.viewerFaction);
  const isFaceDown = unit.isHidden || (unit.status?.isFaceDown && !ownStealth);

  // Face-down stealth unit (潜袭)
  if (isFaceDown) {
    el.className = `board-unit unit-token unit-facedown faction-${faction}`;
    el.dataset.instanceId = unit.instanceId || '';
    el.dataset.isFaceDown = 'true';
    el.innerHTML = `
      <div class="unit-facedown-token">
        <span class="stealth-icon">🌫️</span>
        <span class="stealth-label">潜行伏兵</span>
      </div>
    `;
    return el;
  }

  // Active Unit
  const isSuppressed = unit.status?.suppressed;
  const isInhibited = unit.status?.inhibited;
  const isDamaged = unit.hp < (unit.maxHp || unit.hp);
  const shownAtk = options.effectiveAtk ?? unit.atk;
  const isAtkBuffed = unit.baseAtk !== undefined && shownAtk > unit.baseAtk;
  const isAtkDebuffed = unit.baseAtk !== undefined && shownAtk < unit.baseAtk;

  const statusClasses = [
    `board-unit`,
    `unit-token`,
    `faction-${faction}`,
    `troop-${(unit.troopType || 'infantry').toLowerCase()}`,
    isSuppressed ? 'status-suppressed' : '',
    isInhibited ? 'status-inhibited' : '',
    options.canAct ? 'status-can-act' : 'status-exhausted',
    options.isSelected ? 'unit-acting-active state-selected' : '',
    options.isValidTarget ? 'state-valid-target' : '',
    options.isBlockedTarget ? 'state-blocked-target' : '',
    ownStealth ? 'unit-stealthed' : ''
  ].filter(Boolean).join(' ');

  el.className = statusClasses;
  el.dataset.instanceId = unit.instanceId || '';
  el.dataset.cardId = unit.cardId || '';
  el.dataset.faction = unit.faction || '';

  // Compact Keyword Badges on Board
  const keywordBadges = (unit.keywords || []).map(kw => {
    return `<span class="unit-kw-mini" title="${escapeHtml(KEYWORD_GLOSSARY[kw.replace(/[0-9]/g, '')] || kw)}">${escapeHtml(kw)}</span>`;
  }).join('');

  // Status Overlays
  let statusOverlay = '';
  if (isSuppressed) {
    statusOverlay += `<div class="unit-status-tag tag-suppressed" title="压制中：无法主动移动或攻击">⛓️压制</div>`;
  }
  if (isInhibited) {
    statusOverlay += `<div class="unit-status-tag tag-inhibited" title="抑制中：所有词条失效，数值重置">🚫抑制</div>`;
  }

  el.innerHTML = `
    <div class="unit-card-core">
      <div class="unit-header-bar">
        <span class="unit-troop-mini">${getTroopTypeIcon(unit.troopType, 'UNIT')}</span>
        <span class="unit-name-text">${escapeHtml(unit.name)}</span>
        <span class="unit-action-cost" title="行动消耗: ${options.actionCost ?? unit.actionCost ?? 1}">⚡${options.actionCost ?? unit.actionCost ?? 1}</span>
      </div>
      
      <div class="unit-portrait-mini${getCardArtUrl(unit) ? ' has-art' : ''}"${artStyle(unit)}>
        ${traitsHtml(unit, 'unit-traits')}
        ${options.terrainTag ? `<div class="unit-terrain-tag">${escapeHtml(options.terrainTag)}</div>` : ''}
        ${statusOverlay}
        <div class="unit-kw-row">${keywordBadges}</div>
      </div>

      <div class="unit-stats-bar">
        <div class="unit-stat-pill unit-atk ${isAtkBuffed ? 'val-buffed' : ''} ${isAtkDebuffed ? 'val-debuffed' : ''}">
          <span class="icon">⚔️</span>
          <span class="val">${options.effectiveAtk ?? unit.atk}</span>
        </div>
        <div class="unit-stat-pill unit-hp ${isDamaged ? 'val-damaged' : ''}">
          <span class="icon">🛡️</span>
          <span class="val">${unit.hp}</span>
        </div>
      </div>
    </div>
  `;

  if (ownStealth) {
    el.insertAdjacentHTML('beforeend', '<span class="stealth-own-badge" title="潜伏中：仅你可见，对手看到的是伏兵">🌫️潜伏</span>');
  }

  // Attach hover inspector
  attachInspectorEvents(el, ownStealth ? { ...unit, status: { ...unit.status, isFaceDown: false } } : unit);

  return el;
}

/**
 * Computes and applies mathematical fan geometry across hand card DOM nodes.
 * Formula from explorer_m4_1:
 * angle = delta * angleStep
 * x = delta * spacingStep
 * y = delta^2 * 3.2px
 * z = 10 + i
 * @param {HTMLElement[]} cardElements
 */
export function applyFanGeometry(cardElements) {
  if (!cardElements || cardElements.length === 0) return;
  const N = cardElements.length;

  const angleStep = N === 1 ? 0 : (N <= 5 ? 4.5 : 3.2);
  let spacingStep = 0;
  if (N > 1) {
    if (N <= 4) spacingStep = 75;
    else if (N <= 7) spacingStep = 58;
    else spacingStep = 46;
  }

  cardElements.forEach((el, i) => {
    const delta = i - (N - 1) / 2;
    const angle = delta * angleStep;
    const x = delta * spacingStep;
    const y = (delta * delta) * 3.2;
    const z = 10 + i;

    el.style.setProperty('--fan-offset-x', `${x.toFixed(1)}px`);
    el.style.setProperty('--fan-offset-y', `${y.toFixed(1)}px`);
    el.style.setProperty('--fan-angle', `${angle.toFixed(1)}deg`);
    el.style.setProperty('--fan-z-index', String(z));
  });
}

function attachInspectorEvents(el, card) {
  if (!el || typeof el.addEventListener !== 'function') return;

  const infoButton = el.querySelector('.card-info-button');
  if (infoButton) {
    infoButton.addEventListener('pointerdown', e => e.stopPropagation());
    infoButton.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      showCardDetails(card);
    });
  }
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCardDetails(card);
  });
  el.addEventListener('dblclick', e => {
    e.preventDefault();
    // 触屏上“再点一次确认”会被浏览器识别为双击：只在鼠标、且没有正在选择目标时打开详情
    const body = globalThis.document?.body;
    if (lastPointerType !== 'mouse' || body?.classList.contains('is-selecting') || body?.classList.contains('tactic-targeting')) return;
    showCardDetails(card);
  });

  // 悬停显示技能说明
  let hoverTimer = null;
  const hide = () => { clearTimeout(hoverTimer); hoverTimer = null; CardInspector.hide(); };
  el.addEventListener('pointerenter', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (card?.isHidden || card?.status?.isFaceDown) return;
    const doc = globalThis.document;
    if (doc?.body?.classList.contains('is-dragging')) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (doc?.body?.classList.contains('is-dragging') || !el.isConnected) return;
      CardInspector.show(card, el.getBoundingClientRect());
    }, 220);
  });
  el.addEventListener('pointerleave', e => { if (!e.pointerType || e.pointerType === 'mouse') hide(); });
  el.addEventListener('pointerdown', hide);

}

/**
 * Singleton Card Inspector Tooltip
 */
let lastPointerType = 'mouse';
globalThis.document?.addEventListener?.('pointerdown', e => { lastPointerType = e.pointerType || 'mouse'; }, true);

export class CardInspector {
  static tooltipEl = null;

  static init() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc || !doc.body) return;
    if (this.tooltipEl) return;

    this.tooltipEl = doc.createElement('div');
    this.tooltipEl.className = 'card-inspector-tooltip hidden';
    (doc.getElementById('game-app') || doc.body).appendChild(this.tooltipEl);
  }

  static show(card, anchorRect) {
    if (!card || card.isHidden) return;
    if (!this.tooltipEl) this.init();
    if (!this.tooltipEl) return;

    const keywords = Array.isArray(card.keywords) ? card.keywords : [];
    const glossaryEntries = [];

    for (const kw of keywords) {
      const baseKey = kw.replace(/[0-9]/g, '');
      const definition = KEYWORD_GLOSSARY[kw] || KEYWORD_GLOSSARY[baseKey];
      if (definition) {
        glossaryEntries.push(definition);
      }
    }

    const faction = cardKingdom(card);
    const troopLabel = getTroopTypeLabel(card.troopType, card.type);

    this.tooltipEl.innerHTML = `
      <div class="inspector-card faction-${faction}">
        <div class="inspector-header">
          <span class="inspector-faction-badge">${KINGDOMS[cardKingdom(card)]?.army || ''}</span>
          <h3 class="inspector-name">${escapeHtml(card.name)}</h3>
          <span class="inspector-troop-badge">${troopLabel}</span>
        </div>

        <div class="inspector-cost-bar">
          <span>部署 <strong>${card.cost ?? 0}</strong></span>
          ${card.type === 'UNIT' ? `<span>行动 <strong>${card.actionCost ?? 1}</strong></span>
          <span>战力 <strong>${card.atk}</strong></span>
          <span>生命 <strong>${card.hp}/${card.maxHp || card.hp}</strong></span>` : `<span>${card.type === 'COUNTER' ? '反制战法（盖伏）' : '战法（即时）'}</span>`}
        </div>

        <div class="inspector-body">
          ${traitsHtml(card, 'inspector-traits')}
          <div class="inspector-skill">
            <h4>技能</h4>
            <p>${escapeHtml(getCardDescription(card))}</p>
          </div>

          ${glossaryEntries.length > 0 ? `
            <div class="inspector-glossary">
              <h4>词条释义</h4>
              <ul>
                ${glossaryEntries.map(g => `<li>${escapeHtml(g)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${card.flavor ? `
            <div class="inspector-flavor">
              <p>“${escapeHtml(card.flavor)}”</p>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.tooltipEl.classList.remove('hidden');
    if (anchorRect) {
      this.positionTooltip(anchorRect);
    }
  }

  static hide() {
    if (this.tooltipEl) {
      this.tooltipEl.classList.add('hidden');
    }
  }

  static positionTooltip(anchorRect) {
    if (!this.tooltipEl) return;
    const margin = 16;
    const tt = this.tooltipEl;
    const ttRect = (typeof tt.getBoundingClientRect === 'function')
      ? tt.getBoundingClientRect()
      : { width: 300, height: 260 };

    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    let left = anchorRect.right + margin;
    let top = anchorRect.top;
    // 手牌区（屏幕下方）的卡牌：说明框显示在卡牌上方
    if (anchorRect.top > winH * 0.62) {
      left = anchorRect.left + anchorRect.width / 2 - ttRect.width / 2;
      top = anchorRect.top - ttRect.height - 10;
    }

    if (left + ttRect.width > winW - margin) {
      left = anchorRect.left - ttRect.width - margin;
    }
    if (left < margin) {
      left = margin;
    }

    if (top + ttRect.height > winH - margin) {
      top = winH - ttRect.height - margin;
    }
    if (top < margin) {
      top = margin;
    }

    tt.style.left = `${Math.round(left)}px`;
    tt.style.top = `${Math.round(top)}px`;
  }
}
