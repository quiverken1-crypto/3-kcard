/**
 * factionPicker.js — 势力下拉抽屉
 * 势力越来越多，一排按钮放不下：收成一个按钮，点开是一格一格的势力抽屉。
 *   const el = factionDropdown(document, { options: [['wei', '魏', '魏武军'], ...], current: 'wei', onSelect: k => ... })
 * options 每项：[key, 印章字, 名称]；key 为 'RANDOM' 时印章显示“?”。
 */
import { escapeHtml } from './cardRenderer.js';

let openPanel = null;
function closeOpen() {
  if (!openPanel) return;
  openPanel.wrap.classList.remove('open');
  openPanel.btn.setAttribute('aria-expanded', 'false');
  openPanel = null;
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', e => { if (openPanel && !openPanel.wrap.contains(e.target)) closeOpen(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpen(); });
}

const seal = (key, ch) => `<span class="db-seal fp-seal seal-${escapeHtml(key)}">${escapeHtml(ch || '?')}</span>`;

export function factionDropdown(doc, { options = [], current = null, onSelect = () => {}, label = '势力', compact = false } = {}) {
  const wrap = doc.createElement('div');
  wrap.className = `faction-picker${compact ? ' compact' : ''}`;
  const cur = options.find(o => o[0] === current) || options[0] || ['', '?', '—'];
  wrap.innerHTML = `
    <button type="button" class="fp-trigger" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(label)}：${escapeHtml(cur[2])}">
      ${seal(cur[0], cur[1])}<span class="fp-name">${escapeHtml(cur[2])}</span><i class="fp-caret" aria-hidden="true"></i>
    </button>
    <div class="fp-panel" role="listbox" aria-label="${escapeHtml(label)}">
      ${options.map(([k, ch, name]) => `<button type="button" role="option" class="fp-opt k-${escapeHtml(k)}${k === cur[0] ? ' active' : ''}" aria-selected="${k === cur[0]}" data-k="${escapeHtml(k)}">${seal(k, ch)}<span>${escapeHtml(name)}</span></button>`).join('')}
    </div>`;
  const btn = wrap.querySelector('.fp-trigger');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = !wrap.classList.contains('open');
    closeOpen();
    if (willOpen) {
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      openPanel = { wrap, btn };
      wrap.querySelector('.fp-opt.active')?.scrollIntoView?.({ block: 'nearest' });
    }
  });
  wrap.querySelectorAll('.fp-opt').forEach(o => o.addEventListener('click', e => {
    e.stopPropagation();
    closeOpen();
    onSelect(o.dataset.k);
  }));
  return wrap;
}
