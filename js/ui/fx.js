/**
 * fx.js — Combat Special Effects Engine
 * Three Kingdoms KARDS
 *
 * Exports:
 *   FX.damage(x, y, amount, type)     — floating damage number
 *   FX.slash(fromEl, toEl)            — sword slash arc + impact flash
 *   FX.fire(x, y)                     — fire shockwave + embers
 *   FX.skillTrigger(el, skillName, type) — skill ring + badge popup
 *   FX.hqHit(el, amount)              — main city hit pulse
 *   FX.showTriggerHint(text)          — bottom hint bar (how to trigger)
 *   FX.hideTriggerHint()
 */

/** Internal: get document safely */
const _doc = () => (typeof document !== 'undefined' ? document : null);

/** Internal: get element center coords in viewport */
function _center(el) {
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Internal: append element, auto-remove after animation */
function _spawn(el, parent = document.body, durationMs = 1400) {
  parent.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

// ============================================================
// 1. Floating Damage Numbers
// ============================================================
export function damage(x, y, amount, type = 'fx-damage') {
  const doc = _doc(); if (!doc) return;
  const el = doc.createElement('div');
  el.className = `floating-combat-text ${type}`;
  el.textContent = type === 'fx-damage' ? `-${amount}` : String(amount);
  el.style.left = `${x + (Math.random() * 20 - 10)}px`;
  el.style.top  = `${y}px`;
  _spawn(el, doc.body, 1400);
}

/** Show floating text at element center */
export function damageAt(el, amount, type = 'fx-damage') {
  const { x, y } = _center(el);
  damage(x, y, amount, type);
}

// ============================================================
// 2. Slash Attack Effect (sword arc + impact flash)
// ============================================================
export function slash(fromEl, toEl) {
  const doc = _doc(); if (!doc) return;

  const from = _center(fromEl);
  const to   = _center(toEl);

  // --- Impact flash on defender ---
  if (toEl) {
    const flash = doc.createElement('div');
    flash.className = 'fx-impact-flash';
    // toEl must be position:relative for absolute child
    toEl.style.position = 'relative';
    toEl.appendChild(flash);
    setTimeout(() => flash.remove(), 420);
  }

  // --- Slash mark at target ---
  const mark = doc.createElement('div');
  mark.className = 'fx-slash-mark';
  mark.style.left = `${to.x}px`;
  mark.style.top  = `${to.y}px`;
  // SVG slash cross
  mark.innerHTML = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <line x1="10" y1="10" x2="70" y2="70" stroke="#f56565" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
    <line x1="70" y1="10" x2="10" y2="70" stroke="#fc8181" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
  </svg>`;
  _spawn(mark, doc.body, 500);

  // --- SVG trajectory arc ---
  const svg = doc.getElementById('targeting-svg-layer');
  if (svg) {
    const svgRect = svg.getBoundingClientRect();
    const sx = from.x - svgRect.left;
    const sy = from.y - svgRect.top;
    const ex = to.x   - svgRect.left;
    const ey = to.y   - svgRect.top;
    const mx = (sx + ex) / 2;
    const my = Math.min(sy, ey) - 40;

    const path = doc.getElementById('targeting-curve');
    if (path) {
      path.setAttribute('d', `M ${sx},${sy} Q ${mx},${my} ${ex},${ey}`);
      path.classList.add('targeting-attack', 'curve-attack');
      setTimeout(() => {
        path.setAttribute('d', '');
        path.classList.remove('targeting-attack', 'curve-attack');
      }, 500);
    }
  }

  // --- Shake the attacker element ---
  if (fromEl) {
    fromEl.classList.add('anim-shake');
    setTimeout(() => fromEl.classList.remove('anim-shake'), 400);
  }

  // --- Shake the defender ---
  if (toEl) {
    setTimeout(() => {
      toEl.classList.add('anim-impact-shake');
      setTimeout(() => toEl.classList.remove('anim-impact-shake'), 450);
    }, 80);
  }
}

// ============================================================
// 3. Fire Attack Shockwave + Embers (火攻)
// ============================================================
export function fireball(fromEl, toEl) {
  const doc = _doc(); if (!doc || !toEl) return;
  const from = _center(fromEl);
  const to = _center(toEl);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { fire(to.x, to.y); return; }
  const orb = doc.createElement('div');
  orb.className = 'fx-fireball-projectile';
  orb.style.left = `${from.x - 13}px`;
  orb.style.top = `${from.y - 13}px`;
  doc.body.appendChild(orb);
  const finish = () => { orb.remove(); fire(to.x, to.y); };
  if (typeof orb.animate === 'function') {
    const animation = orb.animate([
      { transform: 'translate(0, 0) scale(.55)', opacity: .7 },
      { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(1.25)`, opacity: 1 }
    ], { duration: 420, easing: 'cubic-bezier(.25,.7,.35,1)', fill: 'forwards' });
    animation.finished.then(finish).catch(() => orb.remove());
  } else {
    orb.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px)`;
    setTimeout(finish, 420);
  }
}

export function fire(x, y) {
  const doc = _doc(); if (!doc) return;

  // Shockwave
  const wave = doc.createElement('div');
  wave.className = 'fx-fire-shockwave';
  wave.style.left = `${x}px`;
  wave.style.top  = `${y}px`;
  _spawn(wave, doc.body, 700);

  // Embers
  const COUNT = 10;
  for (let i = 0; i < COUNT; i++) {
    const ember = doc.createElement('div');
    ember.className = 'fx-ember';
    ember.style.left = `${x}px`;
    ember.style.top  = `${y}px`;
    const angle = (Math.PI * 2 * i) / COUNT + Math.random() * 0.5;
    const dist  = 40 + Math.random() * 50;
    ember.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    ember.style.setProperty('--dy', `${Math.sin(angle) * dist - 60}px`);
    ember.style.setProperty('--dur', `${0.55 + Math.random() * 0.45}s`);
    ember.style.background = Math.random() > 0.5 ? '#f6ad55' : '#fc8181';
    _spawn(ember, doc.body, 1100);
  }
}

/** Fire at element center */
export function fireAt(el) {
  const { x, y } = _center(el);
  fire(x, y);
}

// ============================================================
// 4. Skill Trigger Ring + Badge (技能触发特效)
// ============================================================
const SKILL_TYPE_MAP = {
  '奋战': 'fx-skill-attack',  '斩将': 'fx-skill-attack',
  '冲阵': 'fx-skill-attack',  '先登': 'fx-skill-vanguard',
  '矢石': 'fx-skill-attack',  '攻心': 'fx-skill-attack',
  '火攻': 'fx-skill-fire',    '守护': 'fx-skill-defense',
  '伏击': 'fx-skill-ambush',  '帷幄': 'fx-skill-defense',
  '警戒': 'fx-skill-defense', '坚阵': 'fx-skill-defense',
  '突袭': 'fx-skill-attack',  '游击': 'fx-skill-defense',
  '潜袭': 'fx-skill-defense', '奇袭': 'fx-skill-attack',
};

export function skillTrigger(el, skillName, type) {
  const doc = _doc(); if (!doc) return;
  const fxType = type || SKILL_TYPE_MAP[skillName] || 'fx-skill-attack';

  // Ring on unit element
  if (el) {
    el.style.position = 'relative';
    const ring = doc.createElement('div');
    ring.className = `fx-skill-trigger ${fxType}`;
    el.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
    el.classList.add('anim-burn');
    setTimeout(() => el.classList.remove('anim-burn'), 900);
  }

  // Skill name badge floating up
  const { x, y } = _center(el);
  const badge = doc.createElement('div');
  badge.className = 'fx-skill-badge';
  badge.textContent = `【${skillName}】`;
  badge.style.left = `${x}px`;
  badge.style.top  = `${y - 10}px`;
  _spawn(badge, doc.body, 1100);
}

// ============================================================
// 5. HQ Hit Pulse (主城受击)
// ============================================================
export function hqHit(hqEl, amount) {
  const doc = _doc(); if (!doc) return;
  if (hqEl) {
    hqEl.classList.add('anim-hq-hit');
    setTimeout(() => hqEl.classList.remove('anim-hq-hit'), 650);
  }
  if (amount) {
    const { x, y } = _center(hqEl);
    damage(x, y - 20, amount, 'fx-hq');
  }
}

// ============================================================
// 6. Skill Trigger Hint Bar (底部提示栏 — 技能如何触发)
// ============================================================
let _stackEl = null;

/** 技能/事件提示：顶部居中小条，自动堆叠淡出，不遮挡战场操作 */
export function showTriggerHint(text, durationMs = 3200) {
  const doc = _doc(); if (!doc) return;
  if (!_stackEl || !_stackEl.isConnected) {
    _stackEl = doc.createElement('div');
    _stackEl.className = 'toast-stack';
    (doc.getElementById('game-app') || doc.body).appendChild(_stackEl);
  }
  const item = doc.createElement('div');
  item.className = 'toast-item';
  item.innerHTML = text;
  _stackEl.appendChild(item);
  while (_stackEl.childElementCount > 4) _stackEl.firstElementChild.remove();
  requestAnimationFrame(() => item.classList.add('visible'));
  setTimeout(() => {
    item.classList.remove('visible');
    setTimeout(() => item.remove(), 400);
  }, durationMs);
}

export function hideTriggerHint() {
  if (_stackEl) _stackEl.replaceChildren();
}

// ============================================================
// 7. Convenience: full combat sequence (slash + damage + skill FX)
// ============================================================
export function playCombat({ attackerEl, defenderEl, damage: dmg, skills = [], isCounter = false, isFire = false }) {
  const doc = _doc(); if (!doc) return;

  // Slash trajectory
  slash(attackerEl, defenderEl);

  // Damage float (delayed slightly so slash is visible first)
  setTimeout(() => {
    if (dmg != null && dmg > 0) {
      damageAt(defenderEl, dmg, isCounter ? 'fx-counter' : 'fx-damage');
    }
  }, 150);

  // Fire FX
  if (isFire) {
    setTimeout(() => {
      const { x, y } = _center(defenderEl);
      fire(x, y);
    }, 280);
  }

  // Skill badges
  skills.forEach((skill, i) => {
    setTimeout(() => {
      skillTrigger(attackerEl, skill);
    }, 60 + i * 200);
  });
}

// ============================================================
// 8. Keyword Trigger Hint Texts (static lookup)
// ============================================================
export const TRIGGER_HINTS = {
  '奋战': '【奋战】每回合可攻击<strong>2次</strong>，每次攻击消耗1行动粮草。',
  '斩将': '【斩将】攻击战力 <strong>低于</strong> 己方时直接<strong>移除</strong>，无反击。伏击/潜袭下无效。',
  '冲阵': '【冲阵】<strong>首次攻击</strong>免反击，使用后词条消耗。遇伏击时无效。',
  '先登': '【先登】<strong>先手出击</strong>；若击杀目标则<strong>免反击</strong>。遇伏击时仍被反击。',
  '矢石': '【矢石】<strong>仅被同样具有矢石的单位</strong>反击，远程特性。',
  '攻心': '【攻心】无视目标一切防御词条（坚阵、守护、帷幄均失效）。',
  '火攻': '【火攻】击杀目标后，<strong>将等额伤害</strong>传递至相邻单位或主城，穿透坚阵。',
  '守护': '【守护】当有敌人攻击<strong>相邻友军或主城</strong>时，守护单位强制拦截该攻击。',
  '伏击': '【伏击】<strong>首次被攻击</strong>时先手反击；若反击致敌死亡，自身不受伤害。',
  '帷幄': '【帷幄】本单位<strong>首次行动之前</strong>免疫战法与定向技能。',
  '警戒': '【警戒】<strong>永久免疫</strong>定向战法与反制战法的指向。',
  '坚阵': '【坚阵X】每次受到的伤害减少<strong>X点</strong>（最高坚阵3）。',
  '突袭': '【突袭】部署当回合即可<strong>移动或攻击</strong>，无需等待休整。',
  '潜袭': '【潜袭】<strong>背面进场</strong>，免疫战法；被攻击或主动行动时翻面揭示。',
  '游击': '【游击】可<strong>撤退至己方支援阵线</strong>；首次被攻击时可选择脱离。',
  '奇袭': '【奇袭】可从手牌<strong>直接部署至空置前线区域</strong>，绕过支援线中转。',
  '补给': '【补给】在场时为己方<strong>额外粮仓 +1</strong>，优先被消耗。',
  '声望': '【声望X】进场时争夺天下声望X点（对手有则偷扣，无则自增）。',
  '奇谋': '【奇谋X】己方施放战法粮草消耗减少X点。',
  '治军': '【治军】同兵种友军<strong>行动粮草-1</strong>。',
  '督战': '【督战】相邻己方军事单位<strong>攻击+1</strong>（谋士不受益）。',
};

/** Show hint for a specific keyword at unit position */
export function hintForKeyword(keyword, el) {
  const prefix = Object.keys(TRIGGER_HINTS).find(k => keyword.startsWith(k));
  if (prefix) {
    showTriggerHint(TRIGGER_HINTS[prefix]);
  }
}

// Default export object for convenience
export default {
  damage, damageAt,
  slash, fireball, fire, fireAt,
  skillTrigger,
  hqHit,
  showTriggerHint, hideTriggerHint, hintForKeyword,
  playCombat,
  TRIGGER_HINTS,
};
