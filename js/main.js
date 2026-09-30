/**
 * main.js — Main Application Entry Point, Coordinator & Lifecycle Director
 * Three Kingdoms KARDS (Milestone 4)
 *
 * Implements:
 * 1. AppCoordinator: Central router & state manager.
 * 2. 4 Play Modes: Solo vs Bot, Bot vs Bot sandbox, LAN WebRTC Host, LAN WebRTC Join.
 * 3. Bidirectional wiring: InteractionController -> RulesEngine / HostSync / ClientSync.
 * 4. Reactive UI driver: updates boardRenderer, cardRenderer, combatLog, HUD, and timers.
 * 5. Autonomous Heuristic Bot step loop with visual animation delays.
 * 6. Opening Mulligan & Match Over banner dialogs.
 */

import { FACTIONS, PHASES, ACTION_TYPES } from './engine/constants.js';
import { RulesEngine } from './engine/rulesEngine.js';
import { startTurn } from './engine/state.js';
import { HeuristicBot, executeBotTurnAsync } from './bot/heuristicBot.js';
import { HostSyncManager, ClientSyncManager } from './network/syncProtocol.js';

import { InteractionController, explainAttackError } from './ui/interaction.js';
import { NetworkModalController } from './ui/networkModal.js';
import { renderBoard, renderResourceHUD, fitHandStrip } from './ui/boardRenderer.js';
import { CardInspector, renderHandCard, escapeHtml, getCardDescription } from './ui/cardRenderer.js';
import { CombatLogController } from './ui/combatLog.js';
import FX from './ui/fx.js';
import { BattleFx } from './ui/battleFx.js';
import { AudioDirector } from './ui/audioDirector.js';
import { TurnClock } from './ui/turnClock.js';
import { HQ_CARDS } from './data/terrains.js';
import { KINGDOMS } from './data/cardDB.js';
import { setSeatKingdoms, seatArmy } from './ui/seats.js';
import { preloadAssets } from './ui/preloader.js';
import { DeckBuilder } from './ui/deckBuilder.js';
import { Workshop } from './ui/workshop.js';
import './api.js'; // 开放接口：window.SGK
import { loadCustom, setKeywordRegistrar, customFactions, onCustomChange, registerGuest } from './data/customContent.js';
import { registerKeyword } from './ui/cardRenderer.js';
import { listDecks, getDeck, validateDeck, deckStats, deckCardDefs, lastDeckId, rememberDeckFor, dualPresets, generateDualDeck, DUAL, customPayloadFor } from './data/deckStore.js';
import { createCard, createKingdomDeck } from './engine/state.js';

const KINGDOM_KEYS = ['wei', 'shu', 'wu', 'lb', 'gsz', 'ys', 'hj', 'dz', 'xl', 'lbiao', 'yshu'];

/** 自定义势力的印章/主城配色 */
function injectFactionStyles() {
  const doc = globalThis.document;
  if (!doc) return;
  let el = doc.getElementById('custom-faction-styles');
  if (!el) { el = doc.createElement('style'); el.id = 'custom-faction-styles'; doc.head.appendChild(el); }
  const safe = c => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#6b7280');
  el.textContent = customFactions().map(f => `.seal-${f.key},.db-seal-${f.key}{background:${safe(f.color)};color:#fff}.hq-card-${f.key}{border-color:${safe(f.color)}}`).join('\n');
}
const randomOther = k => { const o = KINGDOM_KEYS.filter(x => x !== k); return o[Math.floor(Math.random() * o.length)]; };

export const APP_MODE = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  SOLO_VS_BOT: 'SOLO_VS_BOT',
  BOT_VS_BOT: 'BOT_VS_BOT',
  P2P_HOST: 'P2P_HOST',
  P2P_CLIENT: 'P2P_CLIENT'
});

function createMatchSeed() {
  const value = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(value);
    return value[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

export class AppCoordinator {
  constructor() {
    this.mode = APP_MODE.UNINITIALIZED;
    this.localPlayerId = FACTIONS.WEI;
    this.opponentPlayerId = FACTIONS.SHU;

    // Core engines & sync
    this.rulesEngine = null;
    this.hostSync = null;
    this.clientSync = null;
    this.bot = null;
    this.peerConnection = null;

    // UI Controllers
    this.interaction = null;
    this.networkModal = null;
    this.combatLog = null;
    this.audio = null;
    this.turnClock = new TurnClock({ onExpire: () => this._handleTurnTimeout() });
    this.clockTurnKey = null;
    this.clockInterval = null;

    // Sandbox timer / cancellation
    this.sandboxTimer = null;
    this.isSandboxRunning = false;

    // Log tracking
    this.lastProcessedLogIndex = 0;

    // Mulligan selection state
    this.mulliganSelectedIndices = new Set();

    // Statistics tracking
    this.matchStats = {
      turns: 0,
      kills: 0,
      provisionsUsed: 0
    };
  }

  async init() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    // 1. Initialize Card Inspector Tooltip
    CardInspector.init();
    this.battleFx = new BattleFx({ getLocalPlayer: () => this.localPlayerId });

    // 2. Initialize Combat Log Controller
    const logFeedEl = doc.getElementById('combat-log-feed');
    this.combatLog = new CombatLogController(logFeedEl);

    // 3. Initialize Interaction Controller
    this.interaction = new InteractionController({
      rootContainer: doc.getElementById('battlefield-main'),
      svgOverlay: doc.getElementById('targeting-svg-layer'),
      targetingCurve: doc.getElementById('targeting-curve'),
      onAction: (action) => this.handleUserAction(action)
    });

    // 4. Initialize Network / Mode Selection Modal
    this.networkModal = new NetworkModalController({
      modalEl: doc.getElementById('modal-network'),
      onStartSolo: (cfg) => this.startSoloMatch(cfg),
      onStartSandbox: (cfg) => this.startSandboxMatch(cfg),
      onP2PConnected: (cfg) => this.startP2PMatch(cfg)
    });

    // 自定义内容（工坊）：先注册自定义势力/主城/词条，再建卡组编辑器
    try { setKeywordRegistrar(registerKeyword); loadCustom(); }
    catch (error) { console.warn('自定义内容加载失败：', error); }
    injectFactionStyles();
    onCustomChange(() => injectFactionStyles());
    this.deckBuilder = new DeckBuilder({ onChange: () => this._refreshDeckSelect?.() });
    this.workshop = new Workshop({ onChange: () => this._refreshDeckSelect?.() });
    this.audio = new AudioDirector();
    this.audio.setScene('lobby');
    this.audio.armUnlock(doc);
    this._runPreloader(doc);
    this._bindTouchControls(doc);

    // 5. Wire Drawer & Global Controls
    this._bindGlobalControls();
    this.clockInterval = setInterval(() => this._tickTurnClock(), 250);
    this.clockInterval.unref?.();

    // 6. 主页 + 战场自适应缩放
    this._bindHomeScreen();
    this._setupBoardFit();
    this.showHome();

    // 卡组分享链接：?deck=SGK1-… 直接打开导入
    try {
      const deckCode = new URLSearchParams(globalThis.location?.search || '').get('deck');
      if (deckCode) {
        this.deckBuilder.renderImport(deckCode);
        const u = new URL(globalThis.location.href);
        u.searchParams.delete('deck');
        globalThis.history?.replaceState(null, '', u.toString());
      }
    } catch { /* ignore */ }

    // 邀请链接：?room=1234 直接进入联机并加入房间
    try {
      const room = new URLSearchParams(globalThis.location?.search || '').get('room');
      if (room && /^\d{4,6}$/.test(room)) {
        const params = new URLSearchParams(globalThis.location.search);
        this.networkModal?.showAndJoin(room, params.get('net'));
        const u = new URL(globalThis.location.href);
        u.searchParams.delete('room');
        u.searchParams.delete('net');
        globalThis.history?.replaceState(null, '', u.toString());
      }
    } catch { /* ignore */ }
  }

  /** 手机：取消按钮、全屏、竖屏提示 */
  _bindTouchControls(doc) {
    const on = (id, fn) => doc.getElementById(id)?.addEventListener('click', fn);
    on('touch-cancel', (e) => { e.stopPropagation(); this.interaction?.cancelAll?.(); });
    const isIOS = /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent || '') || (globalThis.navigator?.platform === 'MacIntel' && globalThis.navigator?.maxTouchPoints > 1);
    const standalone = globalThis.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)')?.matches || globalThis.navigator?.standalone;
    const goFull = async () => {
      const el = doc.documentElement;
      const canFs = el.requestFullscreen || el.webkitRequestFullscreen;
      // iPhone 的 Safari 不支持网页全屏：引导“添加到主屏幕”
      if (!canFs || (isIOS && !doc.fullscreenElement)) {
        if (!canFs || isIOS) { doc.getElementById('ios-install')?.classList.remove('hidden'); return; }
      }
      try {
        if (!doc.fullscreenElement) await (el.requestFullscreen?.({ navigationUI: 'hide' }) || el.webkitRequestFullscreen?.());
        else await doc.exitFullscreen?.();
      } catch { doc.getElementById('ios-install')?.classList.remove('hidden'); }
      setTimeout(() => this._fitBoard(), 300);
    };
    on('btn-fullscreen', goFull);
    on('home-btn-install', goFull);
    on('ios-install-close', () => doc.getElementById('ios-install')?.classList.add('hidden'));
    if (standalone) doc.body.classList.add('is-standalone');
    // 手机布局：横屏矮屏 → m-land；竖屏手机 → m-land + m-port
    // 用实际可见高度（扣掉浏览器地址栏/标签栏）排版
    const applyLayout = () => {
      const vv = globalThis.visualViewport;
      const w = Math.round(vv?.width || globalThis.innerWidth), h = Math.round(vv?.height || globalThis.innerHeight);
      doc.documentElement.style.setProperty('--app-h', `${h}px`);
      const port = h > w && w <= 600;
      const land = (w >= h && h <= 540) || port;
      doc.body.classList.toggle('m-land', land);
      doc.body.classList.toggle('m-port', port);
      setTimeout(() => { this._fitBoard(); fitHandStrip(); }, 50);
    };
    this._applyLayout = applyLayout;
    globalThis.addEventListener?.('resize', applyLayout);
    globalThis.visualViewport?.addEventListener?.('resize', applyLayout);
    applyLayout();
    // 离线缓存：第二次打开秒开
    try {
      const loc = globalThis.location;
      if (globalThis.navigator?.serviceWorker && (loc.protocol === 'https:' || loc.hostname === 'localhost')) {
        globalThis.navigator.serviceWorker.register('sw.js').catch(() => {});
      }
    } catch { /* ignore */ }
    // 选中/瞄准时显示“取消”按钮
    // 切到后台：暂停动画、音乐，省电
    const onVis = () => {
      const hidden = doc.hidden;
      doc.body.classList.toggle('page-hidden', hidden);
      this.audio?.setBackground?.(hidden);
    };
    doc.addEventListener('visibilitychange', onVis);
    setInterval(() => {
      if (doc.hidden) return;
      const busy = Boolean(this.interaction?._isBusySelecting?.()) && !doc.body.classList.contains('at-home');
      doc.body.classList.toggle('is-selecting', busy);
    }, 150);
    const refit = () => { for (const ms of [120, 400, 900]) setTimeout(() => { this._applyLayout?.(); this._fitBoard(); }, ms); };
    globalThis.addEventListener?.('orientationchange', refit);
    doc.addEventListener('fullscreenchange', refit);
  }

  /** 启动时预加载全部卡图/音效/音乐，显示进度；可跳过，剩余在后台继续 */
  _runPreloader(doc) {
    const box = doc.getElementById('boot-loader');
    if (!box) return;
    const fill = doc.getElementById('boot-bar-fill');
    const label = doc.getElementById('boot-label');
    const pct = doc.getElementById('boot-pct');
    const skip = doc.getElementById('boot-skip');
    let chip = null;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      box.classList.add('done');
      setTimeout(() => box.remove(), 600);
    };
    setTimeout(() => skip?.classList.remove('hidden'), 2500);
    skip?.addEventListener('click', () => {
      close();
      this.audio?.loadMusicInBackground?.();
      chip = doc.createElement('div');
      chip.className = 'bg-load-chip';
      doc.body.appendChild(chip);
    });
    preloadAssets({
      audio: this.audio,
      onProgress: ({ ratio, label: l }) => {
        const p = Math.round(ratio * 100);
        if (fill) fill.style.width = `${p}%`;
        if (pct) pct.textContent = `${p}%`;
        if (label) label.textContent = ratio >= 1 ? '加载完成' : `正在加载${l}…`;
        box.setAttribute('aria-valuenow', String(p));
        if (chip) chip.textContent = `资源加载 ${p}%`;
      }
    }).then(() => {
      this.audio?.loadMusicInBackground?.();
      if (chip) { chip.textContent = '资源已就绪'; setTimeout(() => chip.remove(), 1500); }
      setTimeout(close, 250);
    });
  }

  _bindHomeScreen() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;
    const on = (id, fn) => doc.getElementById(id)?.addEventListener('click', fn);
    on('home-btn-pve', () => this._pickHq({ lan: false }, (k, hq, enemy, deckId, mode) => this.startSoloMatch({ faction: 'WEI', kingdom: k, hq, enemyKingdom: enemy, deckId, mode })));
    on('home-btn-pvp', () => this.networkModal.show('tab-host'));
    on('home-btn-eve', () => this.startSandboxMatch({ stepSpeedMs: 750 }));
    on('home-btn-rules', () => doc.getElementById('modal-rulebook')?.classList.remove('hidden'));
    on('home-btn-decks', () => this.deckBuilder.open());
    on('home-btn-editor', () => this.workshop.open());
    on('btn-game-over-home', () => this.showHome());
    on('btn-go-home', () => this.showHome());
    const gallery = doc.getElementById('home-gallery');
    if (gallery && !gallery.childElementCount) {
      const ids = ['wei_cao_cao', 'shu_liu_bei', 'wei_zhang_liao', 'shu_guan_yu', 'wei_xia_hou_dun', 'shu_zhao_yun', 'wei_xu_chu', 'shu_zhang_fei', 'wei_guo_jia', 'shu_zhu_ge_liang', 'wei_cao_ren', 'shu_ma_chao'];
      for (const id of ids) {
        const tile = doc.createElement('div');
        tile.className = `home-tile ${id.startsWith('wei') ? 'tile-wei' : 'tile-shu'}`;
        tile.style.backgroundImage = `url('assets/cards/${id}.webp')`;
        gallery.appendChild(tile);
      }
    }
  }

  /** 主城选择弹窗 */
  _pickHq({ lan = false, onCancel = null } = {}, onPick) {
    const doc = globalThis.document;
    const modal = doc?.getElementById('modal-hq-pick');
    const box = doc?.getElementById('hq-pick-options');
    const BUILTIN = ['wei', 'shu', 'wu', 'lb', 'gsz', 'ys', 'hj', 'dz', 'xl', 'lbiao', 'yshu'];
    // 自定义势力：有主城即可选择，但需要一套合法卡组才能开局（人机对手只用内置势力）
    const ALL = [...BUILTIN, ...customFactions().map(f => f.key).filter(key => KINGDOMS[key] && HQ_CARDS[key]?.length)];
    let kingdom = ALL.includes(this._lastKingdom) ? this._lastKingdom : 'wei';
    let enemy = 'RANDOM';
    let mode = this._lastMode || 'single';
    if (!modal || !box) { onPick(kingdom, 'RANDOM', 'RANDOM', null, mode); return; }
    const T = { PLAIN: '平原', WATER: '水域', FOREST: '林地', MOUNTAIN: '山地', PASS: '险关' };
    const close = () => { modal.classList.add('hidden'); this._refreshDeckSelect = null; };
    const deckBox = doc.getElementById('hq-pick-deck');
    let deckId = null;
    const fillDecks = () => {
      if (!deckBox) return;
      const decks = listDecks({ mode, kingdom }).filter(d => validateDeck(d).ok);
      const want = lastDeckId(kingdom, mode);
      deckId = decks.some(d => d.id === deckId) ? deckId : (decks.find(d => d.id === want) || decks[0])?.id || null;
      if (!decks.length) {
        deckBox.innerHTML = `<span class="hqp-deck-empty">${BUILTIN.includes(kingdom) ? '将使用默认卡组' : '还没有合法卡组，点“管理”去组一套'}</span>`;
        return;
      }
      deckBox.replaceChildren(...decks.map(d => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = `hqp-deck${d.id === deckId ? ' active' : ''}`;
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(d.id === deckId));
        const { byType } = deckStats(d);
        b.innerHTML = `<span class="hqp-deck-name">${d.official ? '<i class="hqp-deck-tag">官方</i>' : ''}${escapeHtml(d.name.replace(/（推荐）$/, ''))}</span>
          <span class="hqp-deck-meta">单位${byType.UNIT} · 战法${byType.TACTIC} · 反制${byType.COUNTER}</span>`;
        b.onclick = () => { deckId = d.id; fillDecks(); };
        return b;
      }));
      deckBox.querySelector('.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    this._refreshDeckSelect = fillDecks;
    const editBtn = doc.getElementById('hq-pick-deck-edit');
    if (editBtn) editBtn.onclick = () => { this.deckBuilder.codexKingdom = kingdom; this.deckBuilder.mode = mode; this.deckBuilder.open('mine'); };
    const done = (hq) => {
      if (!BUILTIN.includes(kingdom) && !deckId) { FX.showTriggerHint(`【${KINGDOMS[kingdom]?.name || '自定义'}】需要先组一套合法卡组`); return; }
      if (deckId) rememberDeckFor(kingdom, mode, deckId);
      close(); this._lastKingdom = kingdom; this._lastMode = mode; onPick(kingdom, hq, enemy, deckId, mode);
    };
    const chips = (container, opts, current, onSel) => {
      if (!container) return;
      container.replaceChildren(...opts.map(([k, label]) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = `enemy-chip k-${k}${k === current ? ' active' : ''}`;
        b.textContent = label;
        b.onclick = () => onSel(k);
        return b;
      }));
    };
    const draw = () => {
      chips(doc.getElementById('hq-pick-mode-options'), [['single', '单阵营'], ['dual', '双阵营·测试']], mode, m => { mode = m; draw(); });
      const selfLabel = doc.getElementById('hq-pick-self-label');
      if (selfLabel) selfLabel.textContent = mode === 'dual' ? '主阵营' : '我方';
      chips(doc.getElementById('hq-pick-self-options'), ALL.map(k => [k, KINGDOMS[k].name]), kingdom, k => { kingdom = k; if (enemy === k) enemy = 'RANDOM'; draw(); });
      fillDecks();
      for (const id of ['hq-pick-enemy-label', 'hq-pick-enemy-options']) { const el = doc.getElementById(id); if (el) el.style.display = lan ? 'none' : ''; }
      chips(doc.getElementById('hq-pick-enemy-options'), [['RANDOM', '随机'], ...BUILTIN.filter(k => k !== kingdom).map(k => [k, KINGDOMS[k].name])], enemy, k => { enemy = k; draw(); });
      box.replaceChildren(...HQ_CARDS[kingdom].map(hq => {
        const card = doc.createElement('button');
        card.className = `hq-card hq-card-${kingdom}`;
        card.innerHTML = `<span class="hq-card-name">${hq.name}</span>
          <span class="hq-card-terrains">${hq.terrains.map(t => `<i class="terrain-chip chip-${t.toLowerCase()}">${T[t]}</i>`).join('')}</span>
          <span class="hq-card-shield">${mode === 'dual' ? DUAL.HQ_HP : hq.hp}</span>
          <span class="hq-card-grain">粮草 1–10</span>`;
        card.onclick = () => done(hq.id);
        return card;
      }));
    };
    const title = modal.querySelector('.hq-pick-title');
    if (title) title.textContent = lan ? '联机 · 整军备战' : '出征 · 整军备战';
    draw();
    doc.getElementById('hq-pick-random').onclick = () => done('RANDOM');
    const cancelBtn = doc.getElementById('hq-pick-cancel');
    cancelBtn.textContent = onCancel ? '离开房间' : '返回';
    cancelBtn.onclick = () => { close(); onCancel?.(); };
    modal.classList.remove('hidden');
  }

  showHome() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;
    this._teardownCurrentMode();
    this.mode = APP_MODE.UNINITIALIZED;
    this.rulesEngine = null;
    this.bot = null;
    for (const id of ['modal-hq-pick', 'modal-game-over', 'modal-network', 'overlay-mulligan', 'modal-game-menu', 'modal-confirm', 'modal-rulebook', 'modal-discard', 'modal-card-inspector']) doc.getElementById(id)?.classList.add('hidden');
    CardInspector.hide();
    this.combatLog?.clear();
    doc.getElementById('side-drawer')?.classList.add('collapsed');
    doc.getElementById('home-screen')?.classList.remove('hidden');
    doc.body.classList.add('at-home');
    this.audio?.setScene('lobby');
  }

  _hideHome() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    doc?.getElementById('home-screen')?.classList.add('hidden');
    doc?.body?.classList.remove('at-home');
    requestAnimationFrame(() => this._fitBoard());
  }

  /** 战场按视口等比缩放，保证完整显示、无需上下滚动 */
  _setupBoardFit() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const viewport = doc?.getElementById('battlefield-main');
    if (!viewport) return;
    const fit = () => this._fitBoard();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(viewport);
    window.addEventListener('resize', fit);
    fit();
  }

  /**
   * 战场按可用区域等比缩放（transform 实现，各浏览器表现一致，包括 iOS Safari）；
   * 缩放后再用实际尺寸校验一遍，保证不会被上下/左右裁掉。
   */
  _fitBoard() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const viewport = doc?.getElementById('battlefield-main');
    const board = viewport?.querySelector('.board-aspect-wrapper');
    if (!viewport || !board || doc.body.classList.contains('at-home')) return;
    const cs = getComputedStyle(viewport);
    const availW = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    Object.assign(board.style, { transform: 'none', marginLeft: '0px', marginTop: '0px', marginRight: '0px', marginBottom: '0px', transformOrigin: 'top left' });
    const naturalW = board.offsetWidth;
    const naturalH = board.offsetHeight;
    if (!naturalW || !naturalH || availW <= 0 || availH <= 0) return;
    let scale = Math.max(0.25, Math.min(availW / naturalW, availH / naturalH, 1.8));
    const apply = () => Object.assign(board.style, {
      transform: `scale(${scale.toFixed(4)})`,
      marginRight: `${(naturalW * (scale - 1)).toFixed(1)}px`,
      marginBottom: `${(naturalH * (scale - 1)).toFixed(1)}px`
    });
    apply();
    for (let i = 0; i < 3; i++) {
      const r = board.getBoundingClientRect();
      const over = Math.max(r.width / availW, r.height / availH);
      if (!(over > 1.005)) break;
      scale = Math.max(0.25, scale / over * 0.995);
      apply();
    }
    this._boardScale = scale;
  }


  _bindGlobalControls() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    for (const id of ['btn-open-card-editor', 'btn-open-card-editor-start']) {
      doc.getElementById(id)?.addEventListener('click', () => this.workshop.open());
    }
    const updateAudioControls = () => {
      const muted = this.audio?.muted;
      const drawerButton = doc.getElementById('btn-audio-toggle');
      const lobbyButton = doc.getElementById('btn-audio-toggle-lobby');
      if (drawerButton) { drawerButton.textContent = muted ? '🔇' : '🔊'; drawerButton.setAttribute('aria-label', muted ? '开启音频' : '关闭音频'); }
      if (lobbyButton) lobbyButton.textContent = muted ? '🔇 音乐关闭' : '🔊 音乐开启';
      const homeButton = doc.getElementById('home-btn-audio');
      const homeLabel = homeButton?.querySelector('.hl-label');
      if (homeLabel) homeLabel.textContent = muted ? '已静音' : '音乐';
      homeButton?.classList.toggle('is-off', Boolean(muted));
    };
    for (const id of ['btn-audio-toggle', 'btn-audio-toggle-lobby', 'home-btn-audio']) {
      doc.getElementById(id)?.addEventListener('click', () => { this.audio.setMuted(!this.audio.muted); updateAudioControls(); });
    }
    const volume = doc.getElementById('audio-volume');
    if (volume) {
      volume.value = String(Math.round(this.audio.volume * 100));
      volume.addEventListener('input', () => this.audio.setVolume(Number(volume.value) / 100));
    }
    updateAudioControls();
    for (const [id, scene] of [['music-file-lobby', 'lobby'], ['music-file-match', 'match']]) {
      doc.getElementById(id)?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const status = doc.getElementById('local-music-status');
        try {
          this.audio.setLocalTrack(scene, file);
          if (status) status.textContent = `已设置${scene === 'lobby' ? '连接页' : '对局'}配乐：${file.name}。仅在当前浏览器会话播放。`;
        } catch (error) { if (status) status.textContent = `导入失败：${error.message}`; }
      });
    }

    // 战报抽屉
    const drawer = doc.getElementById('side-drawer');
    const toggleLog = () => {
      drawer?.classList.toggle('collapsed');
      doc.getElementById('btn-open-log')?.classList.toggle('active', !drawer?.classList.contains('collapsed'));
      requestAnimationFrame(() => this._fitBoard());
    };
    doc.getElementById('btn-open-log')?.addEventListener('click', toggleLog);
    doc.getElementById('btn-close-drawer')?.addEventListener('click', () => { if (!drawer?.classList.contains('collapsed')) toggleLog(); });
    this._toggleLog = toggleLog;
    this._bindGameMenu();

    // Network Modal Button in Drawer
    const openNetBtn = doc.getElementById('btn-open-network');
    if (openNetBtn) {
      openNetBtn.addEventListener('click', () => this.networkModal.show('tab-host'));
    }

    // Rulebook Modal
    const cardModal = doc.getElementById('modal-card-inspector');
    cardModal?.querySelector('[data-close="modal-card-inspector"]')?.addEventListener('click', () => cardModal.classList.add('hidden'));
    cardModal?.addEventListener('click', e => {
      if (e.target === cardModal) cardModal.classList.add('hidden');
    });
    doc.addEventListener('keydown', e => {
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') {
        // 优先关闭最上层弹窗；其次交给交互层取消选择；最后开关军令菜单
        const layers = ['modal-confirm', 'modal-card-inspector', 'modal-rulebook', 'modal-discard', 'modal-card-editor', 'modal-game-menu'];
        for (const id of layers) {
          const el = doc.getElementById(id);
          if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
        }
        if (this.interaction?._isBusySelecting?.()) return;
        if (this._inMatch()) this._openGameMenu();
      } else if ((e.key === 'l' || e.key === 'L') && this._inMatch()) {
        this._toggleLog?.();
      }
    });

    // Rulebook Modal
    const rulesBtn = doc.getElementById('btn-open-rules');
    const rulebookModal = doc.getElementById('modal-rulebook');
    if (rulesBtn && rulebookModal) {
      rulesBtn.addEventListener('click', () => rulebookModal.classList.remove('hidden'));
    }
    if (rulebookModal) {
      rulebookModal.querySelectorAll('[data-close="modal-rulebook"], .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => rulebookModal.classList.add('hidden'));
      });
    }

    // Discard Viewer Modal
    const discardBtn = doc.getElementById('btn-open-discard');
    const discardModal = doc.getElementById('modal-discard');
    if (discardBtn && discardModal) {
      discardBtn.addEventListener('click', () => this._openDiscardModal());
    }
    if (discardModal) {
      discardModal.querySelectorAll('[data-close="modal-discard"], .modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => discardModal.classList.add('hidden'));
      });
    }

    // Mulligan Overlay Buttons
    this._bindMulliganDialog();

    // 结算：再战 / 返回主页
    doc.getElementById('btn-restart-game')?.addEventListener('click', () => {
      doc.getElementById('modal-game-over')?.classList.add('hidden');
      this._restartLastMatch();
    });
  }

  _inMatch() {
    const doc = globalThis.document;
    return this.mode !== APP_MODE.UNINITIALIZED && !doc?.body?.classList.contains('at-home');
  }

  _restartLastMatch() {
    if (this.lastMatch?.kind === 'sandbox') this.startSandboxMatch(this.lastMatch.cfg || {});
    else if (this.lastMatch?.kind === 'p2p') this.showHome();
    else this.startSoloMatch({ ...(this.lastMatch?.cfg || {}), faction: this.localPlayerId });
  }

  _openGameMenu() {
    const doc = globalThis.document;
    const menu = doc?.getElementById('modal-game-menu');
    if (!menu) return;
    const state = this.getCurrentState();
    const over = !state || state.phase === PHASES.GAME_OVER;
    const surrender = doc.getElementById('menu-surrender');
    if (surrender) surrender.disabled = over || this.mode === APP_MODE.BOT_VS_BOT;
    const restart = doc.getElementById('menu-restart');
    if (restart) {
      restart.disabled = this.lastMatch?.kind === 'p2p';
      restart.title = restart.disabled ? '联机对局请返回主页重新建立连接' : '';
    }
    menu.classList.remove('hidden');
  }

  _confirm(title, text, onYes) {
    const doc = globalThis.document;
    const modal = doc?.getElementById('modal-confirm');
    if (!modal) { onYes(); return; }
    doc.getElementById('confirm-title').textContent = title;
    doc.getElementById('confirm-text').textContent = text;
    const yes = doc.getElementById('confirm-yes');
    const no = doc.getElementById('confirm-no');
    const close = () => { modal.classList.add('hidden'); yes.onclick = null; no.onclick = null; };
    yes.onclick = () => { close(); onYes(); };
    no.onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.classList.remove('hidden');
  }

  _bindGameMenu() {
    const doc = globalThis.document;
    if (!doc) return;
    const menu = doc.getElementById('modal-game-menu');
    const hideMenu = () => menu?.classList.add('hidden');
    const on = (id, fn) => doc.getElementById(id)?.addEventListener('click', fn);
    on('btn-open-menu', () => this._openGameMenu());
    on('menu-resume', hideMenu);
    menu?.addEventListener('click', e => { if (e.target === menu) hideMenu(); });
    on('menu-rules', () => doc.getElementById('modal-rulebook')?.classList.remove('hidden'));
    on('menu-restart', () => this._confirm('重新开始', '放弃当前战局，以相同阵营重新开局？', () => { hideMenu(); this._restartLastMatch(); }));
    on('menu-surrender', () => this._confirm('俯首认输', '主公确定认输吗？本局将判负。', () => { hideMenu(); this._handleSurrender(); }));
    on('menu-home', () => {
      const state = this.getCurrentState();
      const ongoing = state && state.phase !== PHASES.GAME_OVER && this.mode !== APP_MODE.BOT_VS_BOT;
      const go = () => { hideMenu(); this.showHome(); };
      if (ongoing) this._confirm('返回主页', '当前战局尚未结束，返回主页将放弃本局。', go); else go();
    });
  }

  _bindMulliganDialog() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    const overlay = doc.getElementById('overlay-mulligan');
    const confirmBtn = doc.getElementById('btn-confirm-mulligan') || doc.getElementById('btn-mulligan-confirm');
    const keepBtn = doc.getElementById('btn-keep-mulligan') || doc.getElementById('btn-mulligan-keep');

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (overlay) overlay.classList.add('hidden');
        const indices = Array.from(this.mulliganSelectedIndices || []);
        this.handleUserAction({
          type: ACTION_TYPES.MULLIGAN,
          playerId: this.localPlayerId,
          payload: { cardIndices: indices }
        });
      });
    }

    if (keepBtn) {
      keepBtn.addEventListener('click', () => {
        if (overlay) overlay.classList.add('hidden');
        this.handleUserAction({
          type: ACTION_TYPES.MULLIGAN,
          playerId: this.localPlayerId,
          payload: { cardIndices: [] }
        });
      });
    }
  }

  showMulliganDialog() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;
    const overlay = doc.getElementById('overlay-mulligan');
    if (!overlay) return;

    const state = this.getCurrentState();
    const player = state?.players?.[this.localPlayerId];
    if (!player) return;

    this.mulliganSelectedIndices = new Set();
    const container = doc.getElementById('mulligan-cards-container');
    const countSpan = doc.getElementById('mulligan-selected-count');

    if (container) {
      container.innerHTML = '';
      player.hand.forEach((card, idx) => {
        const cardEl = renderHandCard(card);
        cardEl.dataset.handIndex = String(idx);
        cardEl.addEventListener('click', () => {
          if (this.mulliganSelectedIndices.has(idx)) {
            this.mulliganSelectedIndices.delete(idx);
            cardEl.classList.remove('selected');
          } else {
            this.mulliganSelectedIndices.add(idx);
            cardEl.classList.add('selected');
          }
          if (countSpan) countSpan.textContent = String(this.mulliganSelectedIndices.size);
        });
        container.appendChild(cardEl);
      });
    }

    if (countSpan) countSpan.textContent = '0';
    overlay.classList.remove('hidden');
  }

  _animateBoardShift(container, before) {
    if (!before.size || globalThis.document?.body?.classList.contains('is-dragging')) return;
    const els = [...container.querySelectorAll('.board-unit[data-instance-id]')];
    const now = new Set(els.map(el => el.dataset.instanceId));
    const removed = [...before.keys()].some(id => !now.has(id));
    const delay = removed ? 820 : 0;
    const scale = this._boardScale || 1;
    const moving = [];
    for (const el of els) {
      const r0 = before.get(el.dataset.instanceId);
      if (!r0) continue;
      const r1 = el.getBoundingClientRect();
      const dx = (r0.left - r1.left) / scale, dy = (r0.top - r1.top) / scale;
      if (Math.abs(dx) + Math.abs(dy) < 2) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      moving.push(el);
    }
    if (!moving.length) return;
    const play = () => requestAnimationFrame(() => {
      for (const el of moving) {
        if (!el.isConnected) continue;
        el.style.transition = 'transform 280ms ease-out';
        el.style.transform = '';
        setTimeout(() => { if (el.isConnected) el.style.transition = ''; }, 320);
      }
    });
    if (delay) setTimeout(play, delay); else requestAnimationFrame(play);
  }

  // ==========================================
  // 结算中途的目标选择（孙权·御将 / 法正·谋主）：提示条 + 场上高亮，15 秒不选则随机
  // ==========================================
  _syncChoiceBar(state) {
    const doc = globalThis.document;
    if (!doc) return;
    const me = this.localPlayerId;
    const opp = me === 'WEI' ? 'SHU' : 'WEI';
    const mine = state?.players?.[me]?.pendingChoices?.[0] || null;
    const theirs = !mine ? (state?.players?.[opp]?.pendingChoices?.[0] || null) : null;
    const choice = this.mode === APP_MODE.BOT_VS_BOT ? null : (mine || (this.mode === APP_MODE.SOLO_VS_BOT ? null : theirs));
    let bar = doc.getElementById('choice-bar');
    doc.querySelectorAll('.choice-target').forEach(el => el.classList.remove('choice-target'));
    doc.body.classList.toggle('choice-active', Boolean(mine));
    this._activeChoice = mine;
    if (!choice) { bar?.classList.add('hidden'); return; }
    if (!bar) {
      bar = doc.createElement('div');
      bar.id = 'choice-bar';
      bar.className = 'choice-bar';
      doc.body.appendChild(bar);
      this._bindChoiceInput(doc);
    }
    this._choiceSeenAt ||= {};
    this._choiceSeenAt[choice.id] ||= Date.now();
    if (mine) {
      const sel = mine.pool === 'hand' ? '.card-hand' : '.board-unit';
      for (const id of mine.targetIds) doc.querySelectorAll(`${sel}[data-instance-id="${id}"]`).forEach(el => el.classList.add('choice-target'));
    }
    doc.body.classList.toggle('choice-hand', Boolean(mine && mine.pool === 'hand'));
    if (bar.dataset.choiceId !== choice.id) {
      bar.dataset.choiceId = choice.id;
      const nameOf = id => {
        for (const pid of ['WEI', 'SHU']) {
          const all = [...(state.battlefield.support[pid]?.slots || []), ...['LEFT', 'CENTER', 'RIGHT'].flatMap(k => state.battlefield.frontline[k].units)];
          const u = all.find(x => x.instanceId === id);
          if (u) return `${u.name} ${u.atk}/${u.hp}`;
        }
        return null;
      };
      const chips = mine ? mine.targetIds.map(id => ({ id, label: mine.labels?.[id] && mine.pool !== 'board' ? mine.labels[id] : nameOf(id) })).filter(c => c.label)
        .map(c => `<button type="button" class="choice-chip" data-id="${c.id}">${escapeHtml(c.label)}</button>`).join('') : '';
      bar.innerHTML = mine
        ? `<div class="choice-head"><b>【${escapeHtml(choice.source)}】</b>${escapeHtml(choice.prompt)}<span class="choice-timer">15</span></div>
           <div class="choice-chips">${chips}<button type="button" class="choice-chip choice-random">🎲 随机</button></div>`
        : `<div class="choice-head">对方正在选择【${escapeHtml(choice.source)}】的目标…<span class="choice-timer">15</span></div>`;
      bar.querySelectorAll('.choice-chip').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        this._submitChoice(btn.classList.contains('choice-random') ? null : btn.dataset.id);
      }));
    }
    bar.classList.remove('hidden');
    this._tickChoiceTimer();
  }

  _submitChoice(targetId) {
    const c = this._activeChoice;
    if (!c || this._choiceSent === c.id) return;
    this._choiceSent = c.id;
    this.handleUserAction({ type: ACTION_TYPES.CHOOSE_TARGET, playerId: this.localPlayerId, payload: targetId ? { choiceId: c.id, targetId } : { choiceId: c.id, random: true } });
    setTimeout(() => { if (this._choiceSent === c.id) this._choiceSent = null; }, 3000);
  }

  _bindChoiceInput(doc) {
    doc.getElementById('hand-container')?.addEventListener('pointerdown', e => {
      const c = this._activeChoice;
      if (!c || c.pool !== 'hand') return;
      e.stopPropagation();
      e.preventDefault();
      const id = e.target?.closest?.('.card-hand')?.dataset?.instanceId;
      if (id && c.targetIds.includes(id)) this._submitChoice(id);
    }, true);
    // 选择期间，点场上高亮单位 = 选它；其它战场操作暂停
    doc.getElementById('battlefield-main')?.addEventListener('pointerdown', e => {
      if (!this._activeChoice) return;
      e.stopPropagation();
      e.preventDefault();
      const id = e.target?.closest?.('.board-unit')?.dataset?.instanceId;
      if (id && this._activeChoice.targetIds.includes(id)) this._submitChoice(id);
      else FX.showTriggerHint(`请先为【${this._activeChoice.source}】选择目标`);
    }, true);
  }

  /** 15 秒倒计时：自己的选择到时随机；联机房主替掉线/超时的对方随机 */
  _tickChoiceTimer() {
    const doc = globalThis.document;
    const state = this.getCurrentState();
    if (!doc || !state) return;
    const now = Date.now();
    this._choiceSeenAt ||= {};
    const LIMIT = 15000;
    const bar = doc.getElementById('choice-bar');
    const me = this.localPlayerId;
    const opp = me === 'WEI' ? 'SHU' : 'WEI';
    // 1) 技能目标选择
    const mine = state.players?.[me]?.pendingChoices?.[0];
    const theirs = state.players?.[opp]?.pendingChoices?.[0];
    const shown = mine || theirs;
    if (shown && bar && !bar.classList.contains('hidden')) {
      const left = Math.max(0, Math.ceil((LIMIT - (now - (this._choiceSeenAt[shown.id] ||= now))) / 1000));
      const t = bar.querySelector('.choice-timer');
      if (t) { t.textContent = `⏳ ${left}s`; t.classList.toggle('urgent', left <= 5); }
    }
    if (mine && this.mode !== APP_MODE.BOT_VS_BOT && now - (this._choiceSeenAt[mine.id] ||= now) >= LIMIT) this._submitChoice(null);
    if (theirs && this.mode === APP_MODE.P2P_HOST && now - (this._choiceSeenAt[theirs.id] ||= now) >= LIMIT + 2000 && this._hostForced !== theirs.id) {
      this._hostForced = theirs.id;
      this.hostSync?.dispatchAction({ type: ACTION_TYPES.CHOOSE_TARGET, playerId: opp, payload: { choiceId: theirs.id, random: true } });
    }
    // 2) 选牌（豪杰归心）
    const pick = state.players?.[me]?.pendingPick;
    if (pick?.cards?.length && this.mode !== APP_MODE.BOT_VS_BOT) {
      const key = `pick:${pick.cards.map(c => c.instanceId).join(',')}`;
      const since = (this._choiceSeenAt[key] ||= now);
      const left = Math.max(0, Math.ceil((LIMIT - (now - since)) / 1000));
      const el = doc.getElementById('card-pick-timer');
      if (el) { el.textContent = `⏳ ${left}s 后随机`; el.classList.toggle('urgent', left <= 5); }
      if (now - since >= LIMIT && this._pickSent !== key) {
        this._pickSent = key;
        doc.getElementById('overlay-card-pick')?.classList.add('hidden');
        this.handleUserAction({ type: ACTION_TYPES.PICK_CARDS, playerId: me, payload: { random: true } });
      }
    }
    const oppPick = state.players?.[opp]?.pendingPick;
    if (oppPick && this.mode === APP_MODE.P2P_HOST) {
      const key = `opick:${state.turnNumber}:${oppPick.count ?? oppPick.cards?.length}`;
      const since = (this._choiceSeenAt[key] ||= now);
      if (now - since >= LIMIT + 2000 && this._hostForced !== key) {
        this._hostForced = key;
        this.hostSync?.dispatchAction({ type: ACTION_TYPES.PICK_CARDS, playerId: opp, payload: { random: true } });
      }
    }
  }

  /** 己方有待选择的牌（豪杰归心）时弹出选择框；只有自己看得到翻出的牌 */
  _syncPickModal(state) {
    const doc = globalThis.document;
    const overlay = doc?.getElementById('overlay-card-pick');
    if (!overlay) return;
    const pick = state?.players?.[this.localPlayerId]?.pendingPick;
    if (!pick || !pick.cards?.length || this.mode === APP_MODE.BOT_VS_BOT) {
      overlay.classList.add('hidden');
      this._pickKey = null;
      return;
    }
    const key = pick.cards.map(c => c.instanceId).join(',');
    if (key === this._pickKey && !overlay.classList.contains('hidden')) return;
    this._pickKey = key;
    const selected = new Set();
    const box = doc.getElementById('card-pick-container');
    const countEl = doc.getElementById('card-pick-count');
    doc.getElementById('card-pick-max').textContent = String(pick.max);
    doc.getElementById('card-pick-title').textContent = `【${pick.source}】翻看 ${pick.cards.length} 张`;
    doc.getElementById('card-pick-subtitle').textContent = `选择至多 ${pick.max} 张加入手牌，其余弃置（只有你能看到）`;
    box.innerHTML = '';
    for (const card of pick.cards) {
      const el = renderHandCard(card);
      el.addEventListener('click', () => {
        if (selected.has(card.instanceId)) { selected.delete(card.instanceId); el.classList.remove('selected'); }
        else if (selected.size < pick.max) { selected.add(card.instanceId); el.classList.add('selected'); }
        else FX.showTriggerHint(`最多选择 ${pick.max} 张`);
        countEl.textContent = String(selected.size);
      });
      box.appendChild(el);
    }
    countEl.textContent = '0';
    const btn = doc.getElementById('btn-confirm-pick');
    btn.onclick = () => {
      overlay.classList.add('hidden');
      this.handleUserAction({ type: ACTION_TYPES.PICK_CARDS, playerId: this.localPlayerId, payload: { cardIds: [...selected] } });
    };
    overlay.classList.remove('hidden');
  }

  _teardownCurrentMode() {
    this.isSandboxRunning = false;
    this._surrendered = false;
    if (this._lobbyTimer) { clearInterval(this._lobbyTimer); this._lobbyTimer = null; }
    this.turnClock.stop();
    this.clockTurnKey = null;
    if (this.sandboxTimer) {
      clearTimeout(this.sandboxTimer);
      clearInterval(this.sandboxTimer);
      this.sandboxTimer = null;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.disconnect();
      } catch (err) {
        console.warn('Error disconnecting peer:', err);
      }
      this.peerConnection = null;
    }

    if (this.hostSync) {
      try {
        if (typeof this.hostSync.removeAllListeners === 'function') {
          this.hostSync.removeAllListeners();
        }
      } catch (err) {
        console.warn('Error cleaning hostSync:', err);
      }
      this.hostSync = null;
    }

    if (this.clientSync) {
      try {
        if (typeof this.clientSync.removeAllListeners === 'function') {
          this.clientSync.removeAllListeners();
        }
      } catch (err) {
        console.warn('Error cleaning clientSync:', err);
      }
      this.clientSync = null;
    }

    this.lastProcessedLogIndex = 0;
  }

  // ==========================================
  // Mode Initializers
  // ==========================================

  _newMatchOptions(hqs = {}, kingdoms = {}, decks = {}, mode = 'single') {
    const k = { WEI: kingdoms.WEI || 'wei', SHU: kingdoms.SHU || 'shu' };
    setSeatKingdoms(k);
    const opts = {
      autoInit: true, seed: createMatchSeed(), shuffleDecks: true, randomTerrains: true,
      weiHq: hqs.WEI || 'RANDOM', shuHq: hqs.SHU || 'RANDOM',
      weiKingdom: k.WEI, shuKingdom: k.SHU
    };
    // 选定的卡组（官方预设或自组）：覆盖该座位的默认卡组
    const dual = mode === 'dual';
    if (dual) opts.initialHp = DUAL.HQ_HP;
    for (const seat of ['WEI', 'SHU']) {
      let deck = decks[seat];
      const ok = deck && deck.kingdom === k[seat] && (deck.mode || 'single') === mode && validateDeck(deck).ok;
      if (!ok) deck = dual ? this._defaultDualDeck(k[seat]) : null;
      if (!deck) continue;
      const pre = seat === 'WEI' ? 'wei' : 'shu';
      opts[`${pre}Deck`] = deckCardDefs(deck).map(def => createCard(def, { faction: seat, kingdom: def.kingdom || k[seat] }));
      opts[`${pre}Reserve`] = [deck.kingdom, deck.subKingdom].filter(Boolean).flatMap(x => createKingdomDeck(x, seat).reservePool);
    }
    return opts;
  }

  /** 双阵营默认卡组：该势力做主阵营的推荐预设 */
  _defaultDualDeck(kingdom) {
    return dualPresets().find(d => d.kingdom === kingdom) || generateDualDeck(kingdom, KINGDOM_KEYS.find(x => x !== kingdom));
  }

  startSoloMatch(cfg = {}) {
    this._teardownCurrentMode();
    this._hideHome();
    this.lastMatch = { kind: 'solo', cfg };
    this.mode = APP_MODE.SOLO_VS_BOT;
    this.audio?.setScene('match');
    this.localPlayerId = cfg.faction || FACTIONS.WEI;
    this.opponentPlayerId = this.localPlayerId === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;

    const myKingdom = cfg.kingdom || (this.localPlayerId === FACTIONS.WEI ? 'wei' : 'shu');
    const enemyKingdom = (!cfg.enemyKingdom || cfg.enemyKingdom === 'RANDOM') ? randomOther(myKingdom) : cfg.enemyKingdom;
    this.lastMatch.cfg = { ...cfg, kingdom: myKingdom, enemyKingdom };
    this.rulesEngine = new RulesEngine(this._newMatchOptions(
      { [this.localPlayerId]: cfg.hq || 'RANDOM' },
      { [this.localPlayerId]: myKingdom, [this.opponentPlayerId]: enemyKingdom },
      { [this.localPlayerId]: cfg.deckId ? getDeck(cfg.deckId) : null },
      cfg.mode || 'single'
    ));
    this.lastProcessedLogIndex = 0;

    if (cfg.enableMulligan) {
      this.showMulliganDialog();
    } else if (this.rulesEngine.state.phase === PHASES.MULLIGAN) {
      startTurn(this.rulesEngine.state, this.rulesEngine.state.firstPlayer);
    }
    this.bot = new HeuristicBot(this.opponentPlayerId, {
      temperature: cfg.difficulty === 'HARD' ? 0.2 : 0.0
    });

    this.matchStats = { turns: 0, kills: 0, provisionsUsed: 0 };

    if (this.combatLog) {
      this.combatLog.clear();
      this.combatLog.logSystem(`对局开始！玩家统领【${seatArmy(this.localPlayerId)}】，对手为【${seatArmy(this.opponentPlayerId)}】。`);
    }

    this._updateCombatLog();
    this.render();
    this._checkTurnState();
  }

  startSandboxMatch(cfg = {}) {
    this._teardownCurrentMode();
    this._hideHome();
    this.lastMatch = { kind: 'sandbox', cfg };
    this.mode = APP_MODE.BOT_VS_BOT;
    this.audio?.setScene('match');
    this.localPlayerId = FACTIONS.WEI;
    this.opponentPlayerId = FACTIONS.SHU;
    this.isSandboxRunning = true;

    const kA = KINGDOM_KEYS[Math.floor(Math.random() * KINGDOM_KEYS.length)];
    this.rulesEngine = new RulesEngine(this._newMatchOptions({}, { WEI: kA, SHU: randomOther(kA) }));
    this.lastProcessedLogIndex = 0;

    if (this.rulesEngine.state.phase === PHASES.MULLIGAN) {
      startTurn(this.rulesEngine.state, this.rulesEngine.state.firstPlayer);
    }
    const botWei = new HeuristicBot(FACTIONS.WEI);
    const botShu = new HeuristicBot(FACTIONS.SHU);

    this.matchStats = { turns: 0, kills: 0, provisionsUsed: 0 };

    if (this.combatLog) {
      this.combatLog.clear();
      this.combatLog.logSystem('🤖 AI 对决沙盒演练开启！观察魏蜀双方战术推演。');
    }

    this._updateCombatLog();
    if (this.interaction) {
      this.interaction.state = 'DISABLED';
    }
    this.render();

    const stepSpeedMs = cfg.stepSpeedMs || 750;
    this._runSandboxLoop(botWei, botShu, stepSpeedMs);
  }

  startP2PMatch({ peerConnection, isHost, localFaction }) {
    this._hideHome();
    this.lastMatch = { kind: 'p2p' };
    this._teardownCurrentMode();
    this.mode = isHost ? APP_MODE.P2P_HOST : APP_MODE.P2P_CLIENT;
    this.audio?.setScene('match');
    this.peerConnection = peerConnection;
    this.localPlayerId = localFaction || (isHost ? FACTIONS.WEI : FACTIONS.SHU);
    this.opponentPlayerId = this.localPlayerId === FACTIONS.WEI ? FACTIONS.SHU : FACTIONS.WEI;
    this.matchStats = { turns: 0, kills: 0, provisionsUsed: 0 };
    this.lastProcessedLogIndex = 0;

    // Ping-Pong Heartbeat RTT Display
    peerConnection.on?.('heartbeat', ({ rtt }) => {
      this._updateLatencyBadge(rtt);
    });
    peerConnection.on?.('transport', ({ p2p }) => {
      FX.showTriggerHint(p2p ? '⚡ 已打洞成功，P2P 直连对战' : '已切换为服务器中转');
    });

    peerConnection.on?.('close', ({ reason }) => {
      if (this.mode !== APP_MODE.P2P_HOST && this.mode !== APP_MODE.P2P_CLIENT) return;
      FX.showTriggerHint(`⚠️ 联机连接已断开：${escapeHtml(reason || '对方离开')}`);
      this.showHome();
    });

    this.rulesEngine = null; this.hostSync = null; this.clientSync = null; this.bot = null;
    const ch = peerConnection.channel;
    const listen = (fn) => {
      if (typeof ch?.addEventListener === 'function') ch.addEventListener('message', fn);
      else if (typeof ch?.on === 'function') ch.on('message', fn);
    };
    const unlisten = (fn) => {
      if (typeof ch?.removeEventListener === 'function') ch.removeEventListener('message', fn);
      else if (typeof ch?.off === 'function') ch.off('message', fn);
    };
    const parse = (ev) => { try { const d = ev && typeof ev === 'object' && 'data' in ev ? ev.data : ev; return typeof d === 'string' ? JSON.parse(d) : d; } catch { return null; } };
    const send = (obj) => { try { if (!ch || ch.readyState === undefined || ch.readyState === 'open') ch?.send(JSON.stringify(obj)); } catch { /* ignore */ } };
    const kName = k => KINGDOMS[k]?.name || k;
    const leave = () => this.showHome();

    this.combatLog?.clear();
    this.combatLog?.logSystem('🔗 已连入房间，双方选择势力与主城后开局。');
    FX.showTriggerHint('已连入房间，请选择势力与主城');

    // 先连房间，再选势力：双方各自选择，主机收齐后开局
    let myPick = null;
    let theirPick = null;
    let started = false;
    const onLobby = (ev) => {
      const msg = parse(ev);
      if (!msg || msg.type !== 'LOBBY_PICK') return;
      // 对方卡组里的自定义卡/势力：只登记到本局内存
      if (msg.deck?.x && !theirPick) {
        const { remap } = registerGuest(msg.deck.x);
        if (Object.keys(remap).length) msg.deck.cards = Object.fromEntries(Object.entries(msg.deck.cards || {}).map(([id, n]) => [remap[id] || id, n]));
      } else if (theirPick?.deck && msg.deck) msg.deck.cards = theirPick.deck.cards;
      if (!theirPick) FX.showTriggerHint(`对方已选定【${kName(msg.kingdom)}】${myPick ? '' : '，等你选择…'}`);
      theirPick = msg;
      if (isHost) tryStart();
    };
    const tryStart = () => {
      if (started || !myPick || !theirPick) return;
      started = true;
      unlisten(onLobby);
      const known = k => KINGDOM_KEYS.includes(k) || (KINGDOMS[k] && HQ_CARDS[k]?.length);
      const ours = known(myPick.kingdom) ? myPick.kingdom : 'wei';
      const theirs = known(theirPick.kingdom) ? theirPick.kingdom : 'shu';
      // 模式以房主为准；对方卡组模式不符或不合法时，用该势力的默认卡组
      const mode = myPick.mode === 'dual' ? 'dual' : 'single';
      const deckOf = (pick, k) => (pick.deck && pick.deck.kingdom === k && (pick.deck.mode || 'single') === mode && validateDeck(pick.deck).ok ? pick.deck : null);
      if ((theirPick.mode || 'single') !== mode) FX.showTriggerHint(`对方选择的模式与房主不同，按房主的${mode === 'dual' ? '双阵营' : '单阵营'}模式开局`);
      this._beginHostMatch(peerConnection, { WEI: myPick.hq || 'RANDOM', SHU: theirPick.hq || 'RANDOM' }, { WEI: ours, SHU: theirs },
        { WEI: deckOf(myPick, ours), SHU: deckOf(theirPick, theirs) }, mode);
    };
    listen(onLobby);
    if (!isHost) this._beginClientMatch(peerConnection);

    this._pickHq({ lan: true, onCancel: leave }, (k, hq, _enemy, deckId, mode) => {
      const d = deckId ? getDeck(deckId) : null;
      myPick = { type: 'LOBBY_PICK', kingdom: k, hq, mode, deck: d ? { kingdom: d.kingdom, subKingdom: d.subKingdom, mode: d.mode, name: d.name, cards: d.cards, x: customPayloadFor(d) } : null };
      if (!theirPick) FX.showTriggerHint('已选定，等待对方选择…');
      send(myPick);
      if (isHost) { tryStart(); return; }
      // 客机：持续发送所选势力直到主机开局（防丢包）
      this._lobbyTimer = setInterval(() => {
        if (this.clientSync?.state) { clearInterval(this._lobbyTimer); this._lobbyTimer = null; unlisten(onLobby); return; }
        send(myPick);
      }, 1000);
    });
  }

  _beginHostMatch(peerConnection, hqs, kingdoms, decks = {}, mode = 'single') {
    {
      this.rulesEngine = new RulesEngine(this._newMatchOptions(hqs, kingdoms, decks, mode));
      if (this.rulesEngine.state.phase === PHASES.MULLIGAN) startTurn(this.rulesEngine.state, this.rulesEngine.state.firstPlayer);
      this.hostSync = new HostSyncManager({
        rulesEngine: this.rulesEngine,
        channel: peerConnection.channel,
        hostFaction: this.localPlayerId,
        clientFaction: this.opponentPlayerId
      });

      this.hostSync.on('actionApplied', (packet) => {
        if (packet.events && this.combatLog) {
          this.combatLog.logEvents(packet.events);
        }
        this._presentSkillEvents(packet.events || []);
        this.render();
        this._checkTurnState();
        this._syncTurnClock(true);
      });

      if (this.combatLog) {
        this.combatLog.clear();
        this.combatLog.logSystem(`🏰 联机对局开始！我方【${seatArmy(this.localPlayerId)}】对阵【${seatArmy(this.opponentPlayerId)}】。`);
      }
      this.hostSync.broadcastMatchStart();
      this.render();
      this._checkTurnState();
    }
  }

  _beginClientMatch(peerConnection) {
    {
      this.clientSync = new ClientSyncManager({
        channel: peerConnection.channel,
        clientFaction: this.localPlayerId
      });

      this.clientSync.on('stateUpdated', () => {
        this.render();
        this._checkTurnState();
      });

      this.clientSync.on('actionApplied', (packet) => {
        if (packet.events && this.combatLog) {
          this.combatLog.logEvents(packet.events);
        }
        this._presentSkillEvents(packet.events || []);
        this.render();
        this._checkTurnState();
        this._syncTurnClock(true);
      });

      this.clientSync.on('actionRejected', ({ reason }) => {
        FX.showTriggerHint(`⚠️ 行动被主机拒绝：${escapeHtml(explainAttackError(reason))}`);
        this.render();
      });

      if (this.combatLog) {
        this.combatLog.clear();
        this.combatLog.logSystem('🚩 客机端就绪！已连接至主机，同步权威状态中...');
      }
    }
  }

  // ==========================================
  // Action Dispatch Routing & Combat Log Feed
  // ==========================================

  _updateCombatLog() {
    const state = this.getCurrentState();
    const fullLog = state?.combatLog;
    if (!Array.isArray(fullLog)) return;

    if (this.lastProcessedLogIndex < fullLog.length) {
      const newEvents = fullLog.slice(this.lastProcessedLogIndex);
      this.lastProcessedLogIndex = fullLog.length;
      if (this.combatLog && newEvents.length > 0) {
        this.combatLog.logEvents(newEvents);
      }
      this._presentSkillEvents(newEvents);
    }
  }

  _presentSkillEvents(events) {
    this.audio?.playEvents(events);
    this.battleFx?.present(events);
    for (const event of events) {
      const name = escapeHtml(event.card?.name || event.cardName || '');
      if (event.type === 'TACTIC_PLAYED') FX.showTriggerHint(`📜 【${name}】：${escapeHtml(getCardDescription(event.card))}`);
      else if (event.type === 'COUNTER_SET' && event.playerId === this.localPlayerId) FX.showTriggerHint('🪤 反制牌已设伏，等待触发');
      else if (event.type === 'COUNTER_TRIGGERED') FX.showTriggerHint(`🪤 【${escapeHtml(event.counterName || '反制')}】触发！`);
      else if (event.type === 'ABILITY_TRIGGERED') FX.showTriggerHint(`✨ 【${escapeHtml(event.cardName || '自定义技能')}】${escapeHtml(event.trigger)} 已触发`);
      else if (event.type === 'SKILL' && event.message) FX.showTriggerHint(`✨ ${escapeHtml(event.message)}`);
      else if (event.type === 'FIRE_ATTACK') FX.showTriggerHint('🔥 【火攻】触发，波及相邻敌军！');
      else if (event.type === 'DEPLOY' && event.card?.keywords?.some(kw => ['声望', '补给', '奇袭', '突袭'].some(prefix => kw.startsWith(prefix)))) {
        const immediate = event.card.keywords.filter(kw => ['声望', '补给', '奇袭', '突袭'].some(prefix => kw.startsWith(prefix)));
        FX.showTriggerHint(`⚔️ 【${escapeHtml(event.card.name)}】${immediate.map(kw => `【${escapeHtml(kw)}】`).join('')}已就绪`);
      }
      else if (event.type === 'COMBAT_DAMAGE') {
        const triggered = [
          [event.banished, '斩将'], [event.ambushTriggered, '伏击'],
          [event.vanguardImmunity, '先登'], [event.chargeImmunity, '冲阵'],
          [event.rangedImmunity, '矢石'], [event.guixinTriggered, '归心'],
          [event.splashDamage > 0, '火攻'], [event.overflowDamage > 0, '溢出转移']
        ].filter(([active]) => active).map(([, name]) => `【${name}】`);
        if (triggered.length) FX.showTriggerHint(`⚔️ 技能触发：${triggered.join('')}`);
      } else if (event.type === 'ATTACK_HQ' && event.provisionsStolen > 0) FX.showTriggerHint('⚔️ 【攻心】触发：夺取敌方 1 点粮草！');
    }
  }

  _presentCombatFX(event) {
    if (event.type !== 'COMBAT_DAMAGE' && event.type !== 'ATTACK_HQ') return;
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const from = doc?.querySelector(`.board-unit[data-instance-id="${event.attackerId}"]`);
    const to = event.type === 'ATTACK_HQ'
      ? doc?.getElementById(event.playerId === this.localPlayerId ? 'slot-opp-hq' : 'slot-friendly-hq')
      : doc?.querySelector(`.board-unit[data-instance-id="${event.defenderId}"]`);
    if (!to) return;
    if (event.attackStyle === 'FIREBALL') FX.fireball(from, to);
    else FX.slash(from, to);
  }

  async handleUserAction(action) {
    if (this.mode === APP_MODE.SOLO_VS_BOT) {
      try {
        const result = this.rulesEngine.dispatch(action);
        this._updateCombatLog();
        this.render();
        this._checkTurnState();
        this._syncTurnClock(true);
        return result;
      } catch (err) {
        FX.showTriggerHint(`⚠️ 行动失败：${escapeHtml(explainAttackError(err.message))}`);
        this.render();
      }
    } else if (this.mode === APP_MODE.P2P_HOST) {
      this.hostSync?.dispatchAction(action);
    } else if (this.mode === APP_MODE.P2P_CLIENT) {
      try {
        await this.clientSync?.sendAction(action);
      } catch (err) {
        FX.showTriggerHint(`⚠️ 网络发送失败：${escapeHtml(err.message)}`);
        this.render();
      }
    }
  }

  // ==========================================
  // Turn State Machine & Bot Execution Loop
  // ==========================================

  _syncTurnClock(force = false) {
    const state = this.getCurrentState();
    const isHumanMatch = this.mode === APP_MODE.P2P_HOST || this.mode === APP_MODE.P2P_CLIENT ||
      (this.mode === APP_MODE.SOLO_VS_BOT && (state?.phase === PHASES.MULLIGAN || state?.activePlayer === this.localPlayerId));
    if (!state || ![PHASES.ACTION, PHASES.MULLIGAN].includes(state.phase) || !isHumanMatch) {
      this.turnClock.stop();
      this.clockTurnKey = null;
      this._renderTurnClock();
      return;
    }
    const key = `${state.turnNumber}:${state.activePlayer}:${state.phase}`;
    if (key !== this.clockTurnKey) {
      this.clockTurnKey = key;
      this.turnClock.start();
      this._totalWarned = false;
    } else if (force) {
      this.turnClock.restartStep();
    }
    this._renderTurnClock();
  }

  _tickTurnClock() {
    if (globalThis.document?.hidden) return;
    this.turnClock.tick();
    this._renderTurnClock();
    try { this._tickChoiceTimer(); } catch { /* ignore */ }
  }

  _renderTurnClock() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const wrapper = doc?.getElementById('turn-timer');
    const label = doc?.getElementById('turn-timer-text');
    const fill = doc?.getElementById('turn-timer-fill');
    const clock = this.turnClock;
    const seconds = clock.remainingSeconds();
    const total = clock.totalRemainingSeconds();
    const compact = doc?.body?.classList.contains('m-port');
    if (label) label.textContent = clock.deadline ? (compact ? `${seconds}s` : `00:${String(seconds).padStart(2, '0')}`) : (compact ? '--' : '--:--');
    const totalEl = doc?.getElementById('turn-timer-total');
    if (totalEl) totalEl.textContent = clock.deadline ? `回合 ${total}s` : '';
    if (fill) fill.style.width = `${Math.min(100, (seconds / (clock.stepMs / 1000)) * 100)}%`;
    const totalWarn = Boolean(clock.deadline) && clock.isTotalWarning();
    wrapper?.classList.toggle('warning', Boolean(clock.deadline) && seconds <= 10);
    wrapper?.classList.toggle('total-warning', totalWarn);
    if (totalWarn && !this._totalWarned) {
      this._totalWarned = true;
      const state = this.getCurrentState();
      const mine = state?.activePlayer === this.localPlayerId || state?.phase === PHASES.MULLIGAN;
      FX.showTriggerHint(mine ? '⏳ 本回合总时间只剩 30 秒！' : '⏳ 对方本回合总时间只剩 30 秒');
      if (mine) { doc?.body?.classList.add('clock-alarm'); setTimeout(() => doc?.body?.classList.remove('clock-alarm'), 2600); }
    }
  }

  _handleTurnTimeout() {
    const state = this.getCurrentState();
    if (!state || ![PHASES.ACTION, PHASES.MULLIGAN].includes(state.phase)) return;
    if (state.phase === PHASES.MULLIGAN) {
      const doc = typeof document !== 'undefined' ? document : globalThis.document;
      doc?.getElementById('overlay-mulligan')?.classList.add('hidden');
      const mulligan = { type: ACTION_TYPES.MULLIGAN, playerId: state.firstPlayer, payload: { cardIndices: [] } };
      if (this.mode === APP_MODE.SOLO_VS_BOT) this.handleUserAction(mulligan);
      else if (this.mode === APP_MODE.P2P_HOST) this.hostSync?.dispatchAction(mulligan);
      return;
    }
    const action = { type: ACTION_TYPES.END_TURN, playerId: state.activePlayer, payload: {} };
    if (this.mode === APP_MODE.SOLO_VS_BOT && state.activePlayer === this.localPlayerId) {
      FX.showTriggerHint('⏱ 时间到，自动结束回合');
      this.handleUserAction(action);
    } else if (this.mode === APP_MODE.P2P_HOST) {
      FX.showTriggerHint('⏱ 时间到，房主自动结束当前回合');
      const result = this.hostSync?.dispatchAction(action);
      if (result?.success === false) this._syncTurnClock(true);
    }
  }

  _checkTurnState() {
    const state = this.getCurrentState();
    if (!state) return;

    if (state.phase === PHASES.GAME_OVER) {
      this._syncTurnClock();
      this._handleGameOver(state.winner);
      return;
    }

    this._syncTurnClock();

    const isLocalTurn = state.activePlayer === this.localPlayerId && state.phase === PHASES.ACTION;
    if (this.interaction) {
      this.interaction.setContext(state, this.localPlayerId);
    }

    // End Turn Button State
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const endTurnBtn = doc?.getElementById('btn-end-turn');
    if (endTurnBtn) {
      endTurnBtn.disabled = !isLocalTurn;
      endTurnBtn.classList?.toggle('state-active', isLocalTurn);
      endTurnBtn.classList?.toggle('state-waiting', !isLocalTurn);
      const textSpan = doc.getElementById('end-turn-text');
      if (textSpan) {
        textSpan.textContent = isLocalTurn ? '结束回合' : '敌方行动中...';
      }
    }

    // Execute Bot Turn if Solo Mode
    if (this.mode === APP_MODE.SOLO_VS_BOT && state.activePlayer === this.opponentPlayerId && state.phase === PHASES.ACTION) {
      this._executeBotTurn();
    }
  }

  async _executeBotTurn() {
    if (!this.bot || !this.rulesEngine) return;
    if (this.interaction) {
      this.interaction.state = 'DISABLED';
    }

    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    const statusBanner = doc?.getElementById('phase-name-text');
    if (statusBanner) statusBanner.textContent = 'AI 运筹帷幄中...';

    await executeBotTurnAsync(this.rulesEngine, this.bot, {
      stepDelayMs: 800,
      onActionCallback: () => {
        this._updateCombatLog();
        this.render();
      }
    });

    this.render();
    this._checkTurnState();
  }

  async _runSandboxLoop(botWei, botShu, stepSpeedMs) {
    while (this.isSandboxRunning && this.rulesEngine?.state?.phase !== PHASES.GAME_OVER) {
      const activePlayer = this.rulesEngine.state.activePlayer;
      const activeBot = activePlayer === FACTIONS.WEI ? botWei : botShu;
      const action = activeBot.chooseBestAction(this.rulesEngine.state);

      if (!action || action.type === 'END_TURN') {
        this.rulesEngine.dispatch({ type: ACTION_TYPES.END_TURN, playerId: activePlayer, payload: {} });
      } else {
        this.rulesEngine.dispatch(action);
      }

      this._updateCombatLog();
      this.render();

      await new Promise(r => setTimeout(r, stepSpeedMs));
    }

    if (this.rulesEngine?.state?.phase === PHASES.GAME_OVER) {
      this._handleGameOver(this.rulesEngine.state.winner);
    }
  }

  // ==========================================
  // Render Pipeline
  // ==========================================

  getCurrentState() {
    if (this.mode === APP_MODE.P2P_CLIENT) {
      return this.clientSync?.state || null;
    }
    return this.rulesEngine?.state || null;
  }

  render() {
    const state = this.getCurrentState();
    if (!state) return;
    setSeatKingdoms({ WEI: state.players?.WEI?.kingdom, SHU: state.players?.SHU?.kingdom });

    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    // 1. Render Battlefield Grid (Support lines, 3 Frontline zones)
    const bfContainer = doc.getElementById('battlefield-main');
    if (bfContainer) {
      // 记录重绘前每张单位卡的位置：有单位阵亡/离场时，其余单位先原地不动，
      // 等阵亡动画播完再滑动补位（FLIP）
      const before = new Map();
      bfContainer.querySelectorAll('.board-unit[data-instance-id]').forEach(el => before.set(el.dataset.instanceId, el.getBoundingClientRect()));
      renderBoard(bfContainer, state, this.localPlayerId, {
        player: state.players?.[this.localPlayerId]
      });
      this._animateBoardShift(bfContainer, before);
    }

    // 2. Render Top & Bottom HUDs
    renderResourceHUD(state, this.localPlayerId);

    // 3. Update Interaction Controller Context
    if (this.interaction) {
      this.interaction.setContext(state, this.localPlayerId);
      this.interaction.refreshSelection?.();
    }
    this._syncPickModal(state);
    this._syncChoiceBar(state);
  }

  // ==========================================
  // Discard Viewer & Game Over
  // ==========================================

  _openDiscardModal() {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    const discardModal = doc.getElementById('modal-discard');
    const gridEl = doc.getElementById('discard-cards-grid');
    const countEl = doc.getElementById('discard-viewer-count');
    if (!discardModal || !gridEl) return;

    const state = this.getCurrentState();
    const player = state?.players?.[this.localPlayerId];
    const discard = player?.discard || [];

    if (countEl) countEl.textContent = String(discard.length);
    gridEl.innerHTML = '';

    discard.forEach(card => {
      const cardEl = renderHandCard(card);
      gridEl.appendChild(cardEl);
    });

    discardModal.classList.remove('hidden');
  }

  _handleGameOver(winner) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;

    const isVictory = winner === this.localPlayerId;
    const modal = doc.getElementById('modal-game-over');
    if (!modal) return;

    const titleEl = doc.getElementById('game-over-title');
    const reasonEl = doc.getElementById('game-over-reason');
    const bannerEl = doc.getElementById('game-over-banner');

    if (titleEl) {
      titleEl.textContent = isVictory ? '大捷 · 统一天下' : '溃败 · 兵家常事';
    }
    if (reasonEl) {
      reasonEl.textContent = this._surrendered
        ? '主公俯首认输，暂且退兵，来日再战。'
        : isVictory
          ? `敌方主城陷落，${seatArmy(winner)}一统天下！`
          : '主城失守，胜败乃兵家常事，重整旗鼓再战！';
    }
    if (bannerEl) {
      bannerEl.className = `game-over-banner ${isVictory ? 'banner-victory' : 'banner-defeat'}`;
    }

    const state = this.getCurrentState();
    const turnsEl = doc.getElementById('stat-turns');
    if (turnsEl) turnsEl.textContent = String(state?.turnNumber || 1);
    const log = state?.combatLog || [];
    const me = this.localPlayerId;
    const kills = log.filter(e => (e.type === 'COMBAT_DAMAGE' && ((e.playerId === me && e.defenderDied) || (e.playerId !== me && e.attackerDied)))).length;
    const spent = log.filter(e => e.type === 'DEPLOY' && e.playerId === me).reduce((sum, e) => sum + (e.cost || 0), 0);
    const killsEl = doc.getElementById('stat-kills');
    if (killsEl) killsEl.textContent = String(kills);
    const provEl = doc.getElementById('stat-provisions');
    if (provEl) provEl.textContent = String(spent);
    const restart = doc.getElementById('btn-restart-game');
    if (restart) restart.textContent = this.lastMatch?.kind === 'p2p' ? '返回主页重新联机' : '再战一局';

    doc.getElementById('modal-game-menu')?.classList.add('hidden');
    this.turnClock.stop();
    this._renderTurnClock();
    modal.classList.remove('hidden');
  }

  _handleSurrender() {
    const state = this.getCurrentState();
    if (!state || state.phase === PHASES.GAME_OVER) return;
    this.isSandboxRunning = false;
    this._surrendered = true;
    state.winner = this.opponentPlayerId;
    state.phase = PHASES.GAME_OVER;
    this.render();
    this._handleGameOver(this.opponentPlayerId);
  }

  _updateLatencyBadge(rtt) {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    if (!doc) return;
    const rttBadge = doc.getElementById('network-rtt-badge');
    const rttVal = doc.getElementById('rtt-val-text');
    if (rttVal) rttVal.textContent = `${rtt}ms`;
    if (rttBadge) {
      rttBadge.className = `latency-badge ${rtt < 50 ? 'rtt-good' : (rtt < 150 ? 'rtt-medium' : 'rtt-poor')}`;
    }
  }
}

// Auto-bootstrap when loaded in browser
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new AppCoordinator();
    if (typeof window !== 'undefined') {
      window.__TK_APP__ = app;
    }
    app.init().catch(err => console.error('App bootstrap error:', err));
  });
}

export default AppCoordinator;
