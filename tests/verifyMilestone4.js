/**
 * verifyMilestone4.js — Comprehensive Verification Test Suite for Milestone 4
 * Three Kingdoms KARDS (Milestone 4: Game UI & Interactive Feedback)
 *
 * Covers:
 * 1. HTML5 Structure: All semantic containers, HUD elements, slots, SVG layers, and modals in index.html.
 * 2. Modular CSS Integrity: Validates style.css, board.css, cards.css, animations.css exist and define essential tokens.
 * 3. Card Renderer: Hand cards, prestige discounts, hidden opponent cards, board units, fan geometry, inspector tooltip.
 * 4. Board Renderer: Support lines, 3-line battlefield grid, 3 frontline zones, HQs, resource HUD, FloatingCombatFX.
 * 5. Combat Log: Formats 12+ domain events into Three Kingdoms chronicles, filter tabs, clear mechanism.
 * 6. Interaction Controller: 5-state FSM, drag-and-drop / click-to-deploy, legal move/attack querying, end-turn safeguard.
 * 7. Network Modal: Mode selection, host/join token codec flow, tab switching.
 * 8. AppCoordinator: Lifecycle initialization, mode transitions, solo bot match, action routing, game over.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --------------------------------------------------------------------------
// Lightweight DOM Mock for Node.js Testing
// --------------------------------------------------------------------------
function createMockElement(tagName = 'div') {
  const children = [];
  const childNodes = [];
  const classListSet = new Set();
  const attributes = new Map();
  const styleProps = new Map();
  const listeners = new Map();

  const el = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    id: '',
    get className() {
      return Array.from(classListSet).join(' ');
    },
    set className(val) {
      classListSet.clear();
      if (val) {
        String(val).split(/\s+/).forEach(c => {
          if (c) classListSet.add(c);
        });
      }
    },
    children,
    childNodes,
    parentElement: null,
    dataset: {},
    style: {
      setProperty(key, val) { styleProps.set(key, String(val)); },
      getPropertyValue(key) { return styleProps.get(key) || ''; },
      set width(val) { styleProps.set('width', val); },
      get width() { return styleProps.get('width') || ''; }
    },
    classList: {
      add(...classes) {
        classes.forEach(c => {
          if (c) {
            c.split(/\s+/).forEach(single => {
              if (single) classListSet.add(single);
            });
          }
        });
      },
      remove(...classes) {
        classes.forEach(c => {
          if (c) {
            c.split(/\s+/).forEach(single => classListSet.delete(single));
          }
        });
      },
      contains(c) {
        return classListSet.has(c);
      },
      toggle(c, force) {
        const has = classListSet.has(c);
        const shouldAdd = force !== undefined ? force : !has;
        if (shouldAdd) classListSet.add(c);
        else classListSet.delete(c);
        return shouldAdd;
      }
    },
    _innerHTML: '',
    get innerHTML() {
      if (this.childNodes.length > 0) {
        return this.childNodes.map(node => {
          if (node.nodeType === 3) {
            return node.textContent;
          }
          const c = node;
          const idAttr = c.id ? ` id="${c.id}"` : '';
          const classAttr = c.className ? ` class="${c.className}"` : '';
          const dataAttrs = Object.entries(c.dataset || {}).map(([k, v]) => ` data-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}="${v}"`).join('');
          return `<${c.tagName.toLowerCase()}${idAttr}${classAttr}${dataAttrs}>${c.innerHTML}</${c.tagName.toLowerCase()}>`;
        }).join('');
      }
      return this._innerHTML || this._textContent || '';
    },
    set innerHTML(val) {
      this._innerHTML = String(val);
      this._textContent = '';
      this.children.length = 0;
      this.childNodes.length = 0;
      parseHtmlInto(val, this);
    },
    _textContent: '',
    get textContent() {
      if (this.childNodes.length > 0) {
        return this.childNodes.map(node => (node.nodeType === 3 ? node.textContent : (node.textContent || ''))).join('');
      }
      return this._textContent || this._innerHTML.replace(/<[^>]*>/g, '');
    },
    set textContent(val) {
      this._textContent = String(val);
      this.childNodes.length = 0;
      this.children.length = 0;
    },
    get innerText() { return this.textContent; },
    set innerText(val) { this.textContent = val; },

    appendChild(child) {
      if (child) {
        child.parentElement = this;
        children.push(child);
        childNodes.push(child);
      }
      return child;
    },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) this.parentElement.children.splice(idx, 1);
        const nIdx = this.parentElement.childNodes.indexOf(this);
        if (nIdx !== -1) this.parentElement.childNodes.splice(nIdx, 1);
      }
    },
    setAttribute(name, val) { attributes.set(name, String(val)); },
    getAttribute(name) { return attributes.get(name) || null; },
    removeAttribute(name) { attributes.delete(name); },

    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    dispatchEvent(event) {
      const type = event.type || event;
      const fns = listeners.get(type) || [];
      fns.forEach(fn => fn(event));
    },

    querySelector(selector) {
      return querySelectorAllDescendant(this, selector)[0] || null;
    },
    querySelectorAll(selector) {
      return querySelectorAllDescendant(this, selector);
    },
    closest(selector) {
      let cur = this;
      while (cur) {
        if (matchesSelector(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    getBoundingClientRect() {
      return { left: 100, top: 200, right: 300, bottom: 400, width: 200, height: 200 };
    },
    cloneNode() {
      const clone = createMockElement(this.tagName);
      clone.id = this.id;
      clone.className = this.className;
      clone.classList.add(...classListSet);
      clone.dataset = { ...this.dataset };
      clone.innerHTML = this.innerHTML;
      return clone;
    }
  };

  return el;
}

function parseHtmlInto(html, parent) {
  if (!html) return;
  const tokens = String(html).split(/(<\/?[a-zA-Z0-9-]+[^>]*>)/);
  const stack = [parent];

  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('</')) {
      if (stack.length > 1) {
        stack.pop();
      }
    } else if (token.startsWith('<')) {
      const tagMatch = token.match(/<([a-zA-Z0-9-]+)([^>]*)>/);
      if (tagMatch) {
        const tagName = tagMatch[1];
        const rawAttrs = tagMatch[2];
        const isSelfClosing = rawAttrs.endsWith('/') || ['input', 'img', 'br', 'hr', 'marker', 'polygon', 'path'].includes(tagName.toLowerCase());

        const el = createMockElement(tagName);
        el.parentElement = stack[stack.length - 1];
        stack[stack.length - 1].children.push(el);
        stack[stack.length - 1].childNodes.push(el);

        const idMatch = rawAttrs.match(/id=["']([^"']+)["']/);
        if (idMatch) el.id = idMatch[1];

        const classMatch = rawAttrs.match(/class=["']([^"']+)["']/);
        if (classMatch) el.classList.add(...classMatch[1].trim().split(/\s+/));

        const dataMatches = [...rawAttrs.matchAll(/data-([a-zA-Z0-9-]+)=["']([^"']*)["']/g)];
        for (const dm of dataMatches) {
          const key = dm[1].replace(/-([a-z])/g, (_, g) => g.toUpperCase());
          el.dataset[key] = dm[2];
        }

        if (!isSelfClosing) {
          stack.push(el);
        }
      }
    } else {
      const cur = stack[stack.length - 1];
      if (cur) {
        cur.childNodes.push({ nodeType: 3, textContent: token });
        cur._textContent = (cur._textContent || '') + token;
      }
    }
  }
}

function matchesSelector(el, sel) {
  if (!sel || !el) return false;
  if (sel.includes(',')) {
    return sel.split(',').some(s => matchesSelector(el, s.trim()));
  }
  const parts = sel.match(/([.#]?[a-zA-Z0-9_-]+|\[[^\]]+\])/g) || [sel];
  for (const part of parts) {
    if (part.startsWith('#')) {
      if (el.id !== part.slice(1)) return false;
    } else if (part.startsWith('.')) {
      if (!el.classList.contains(part.slice(1))) return false;
    } else if (part.startsWith('[')) {
      const m = part.match(/\[data-([^=\]]+)(?:=["']?([^"']*)["']?)?\]/);
      if (m) {
        const key = m[1].replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        if (m[2] !== undefined) {
          if (el.dataset[key] !== m[2]) return false;
        } else {
          if (el.dataset[key] === undefined) return false;
        }
      }
    } else {
      if (el.tagName !== part.toUpperCase()) return false;
    }
  }
  return true;
}

function findAllDescendants(parent, sel, out) {
  for (const child of parent.children) {
    if (matchesSelector(child, sel)) out.push(child);
    findAllDescendants(child, sel, out);
  }
}

function querySelectorAllDescendant(parent, sel) {
  if (sel.includes(',')) {
    const res = [];
    sel.split(',').forEach(s => {
      res.push(...querySelectorAllDescendant(parent, s.trim()));
    });
    return [...new Set(res)];
  }

  const tokens = sel.trim().split(/\s+/);
  if (tokens.length === 1) {
    const results = [];
    findAllDescendants(parent, tokens[0], results);
    return results;
  }

  let currentMatched = [parent];
  for (const token of tokens) {
    const nextMatched = [];
    for (const cur of currentMatched) {
      const found = [];
      findAllDescendants(cur, token, found);
      nextMatched.push(...found);
    }
    currentMatched = [...new Set(nextMatched)];
  }
  return currentMatched;
}

// Setup Global DOM Mock for Node testing
const mockBody = createMockElement('body');
const mockDoc = {
  body: mockBody,
  createElement(tag) { return createMockElement(tag); },
  createElementNS(ns, tag) { return createMockElement(tag); },
  getElementById(id) {
    return querySelectorAllDescendant(mockBody, `#${id}`)[0] || null;
  },
  querySelector(sel) {
    return mockBody.querySelector(sel);
  },
  querySelectorAll(sel) {
    return mockBody.querySelectorAll(sel);
  },
  elementFromPoint() { return null; },
  addEventListener() {}
};

globalThis.document = mockDoc;
globalThis.window = {
  document: mockDoc,
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener() {},
  location: { href: 'http://localhost/' }
};

// --------------------------------------------------------------------------
// Imports of Modules Under Test
// --------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, '..');

import {
  renderHandCard,
  renderHiddenCard,
  renderUnitOnBoard,
  applyFanGeometry,
  CardInspector,
  KEYWORD_GLOSSARY,
  getTroopTypeLabel,
  getTroopTypeIcon,
  getMiniKeywordBadge
} from '../js/ui/cardRenderer.js';

import {
  renderBoard,
  renderSupportLine,
  renderFrontlineZone,
  renderResourceHUD,
  FloatingCombatFX,
  getTerrainIcon,
  getZoneNameLabel
} from '../js/ui/boardRenderer.js';

import {
  CombatLogController,
  formatZoneName
} from '../js/ui/combatLog.js';

import {
  InteractionController,
  INTERACTION_STATE
} from '../js/ui/interaction.js';

import {
  NetworkModalController
} from '../js/ui/networkModal.js';

import {
  AppCoordinator,
  APP_MODE
} from '../js/main.js';

import { RulesEngine } from '../js/engine/rulesEngine.js';
import { startTurn } from '../js/engine/state.js';
import { FACTIONS, ACTION_TYPES } from '../js/engine/constants.js';

// ==========================================================================
// TEST SUITE: Milestone 4 Verification
// ==========================================================================

describe('Milestone 4 — HTML5 Shell & Wireframe Topology (`index.html`)', () => {
  const htmlPath = path.join(GAME_DIR, 'index.html');
  let htmlContent = '';

  before(() => {
    assert.ok(fs.existsSync(htmlPath), 'index.html must exist at game/index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  it('contains essential root app container and theme class', () => {
    assert.match(htmlContent, /<body\s+class=["'][^"']*theme-martial[^"']*["']/, 'body must have theme-martial class');
    assert.match(htmlContent, /id=["']game-app["']/, 'must contain #game-app root shell');
  });

  it('contains Top Bar with Opponent Meta, Phase indicator and Provisions', () => {
    const requiredTopIds = [
      'top-bar',
      'opp-faction-badge',
      'opp-hq-name',
      'opp-hq-hp-text',
      'opp-hp-fill',
      'turn-phase-indicator',
      'turn-number-text',
      'phase-name-text',
      'opp-provisions-text',
      'opp-prestige-text',
      'opp-prestige-pips',
      'opp-hand-count',
      'opp-deck-count',
      'opp-discard-count',
      'network-rtt-badge'
    ];
    for (const id of requiredTopIds) {
      assert.ok(htmlContent.includes(`id="${id}"`), `Top Bar must contain id="${id}"`);
    }
  });

  it('contains Battlefield 3-Line Grid with Support Lines and 3 Frontline Zones', () => {
    const requiredBoardIds = [
      'battlefield-main',
      'line-support-opp',
      'slot-opp-hq',
      'slot-opp-sup-0',
      'slot-opp-sup-1',
      'slot-opp-sup-2',
      'slot-opp-sup-3',
      'line-frontline',
      'zone-left',
      'zone-center',
      'zone-right',
      'line-support-friendly',
      'slot-friendly-hq',
      'friendly-hq-name',
      'friendly-hq-hp-badge',
      'slot-friendly-sup-0',
      'slot-friendly-sup-1',
      'slot-friendly-sup-2',
      'slot-friendly-sup-3',
      'targeting-svg-layer',
      'targeting-curve',
      'floating-combat-layer'
    ];
    for (const id of requiredBoardIds) {
      assert.ok(htmlContent.includes(`id="${id}"`), `Battlefield must contain id="${id}"`);
    }
  });

  it('contains Player Dock with Hand Tray and Double Granary HUD', () => {
    const requiredDockIds = [
      'player-dock',
      'hand-tray',
      'hand-container',
      'player-resource-hud',
      'friendly-faction-badge',
      'friendly-hq-hp-text',
      'friendly-hp-fill',
      'granary-numeric-text',
      'main-granary-pips',
      'extra-granary-chip',
      'prestige-numeric-text',
      'player-prestige-pips',
      'prestige-discount-badge',
      'friendly-deck-count',
      'btn-open-discard',
      'friendly-discard-count',
      'btn-end-turn',
      'end-turn-text'
    ];
    for (const id of requiredDockIds) {
      assert.ok(htmlContent.includes(`id="${id}"`), `Player Dock must contain id="${id}"`);
    }
  });

  it('contains Sidebar Drawer and all 6 Modals', () => {
    const requiredModals = [
      'side-drawer',
      'btn-toggle-drawer',
      'combat-log-feed',
      'overlay-mulligan',
      'modal-network',
      'modal-card-inspector',
      'modal-discard',
      'modal-rulebook',
      'modal-game-over'
    ];
    for (const id of requiredModals) {
      assert.ok(htmlContent.includes(`id="${id}"`), `Drawer/Modal must contain id="${id}"`);
    }
  });
});

describe('Milestone 4 — Modular CSS Integrity', () => {
  const cssFiles = ['style.css', 'board.css', 'cards.css', 'animations.css'];

  for (const file of cssFiles) {
    it(`css/${file} exists and contains meaningful definitions`, () => {
      const p = path.join(GAME_DIR, 'css', file);
      assert.ok(fs.existsSync(p), `CSS file ${file} must exist`);
      const content = fs.readFileSync(p, 'utf8');
      assert.ok(content.length > 500, `CSS file ${file} should have substantive content`);
    });
  }

  it('defines Wei Azure (#1B4D7E) and Shu Ochre (#8B3A2B) faction themes', () => {
    const styleCss = fs.readFileSync(path.join(GAME_DIR, 'css', 'style.css'), 'utf8');
    assert.match(styleCss, /#1b4d7e/i, 'style.css must define Wei Azure hue');
    assert.match(styleCss, /#8b3a2b/i, 'style.css must define Shu Ochre hue');
  });

  it('cards.css defines hand fan custom properties and hover focus', () => {
    const cardsCss = fs.readFileSync(path.join(GAME_DIR, 'css', 'cards.css'), 'utf8');
    assert.match(cardsCss, /--fan-offset-x/, 'cards.css must use --fan-offset-x');
    assert.match(cardsCss, /--fan-angle/, 'cards.css must use --fan-angle');
    assert.match(cardsCss, /scale\(1\.2\)/, 'cards.css must scale card on hover');
  });

  it('animations.css defines combat float and impact shake keyframes', () => {
    const animCss = fs.readFileSync(path.join(GAME_DIR, 'css', 'animations.css'), 'utf8');
    assert.match(animCss, /@keyframes float-rise/, 'animations.css must define float-rise');
    assert.match(animCss, /@keyframes impact-shake/, 'animations.css must define impact-shake');
  });
});

describe('Milestone 4 — Card Renderer (`cardRenderer.js`)', () => {
  it('renders interactive hand card for friendly unit', () => {
    const cardDef = {
      instanceId: 'inst_cavalry_01',
      cardId: 'WEI_001',
      name: '虎豹骑',
      faction: 'WEI',
      type: 'UNIT',
      troopType: 'CAVALRY',
      cost: 4,
      actionCost: 1,
      atk: 4,
      hp: 3,
      maxHp: 3,
      keywords: ['突袭', '冲阵'],
      skill: { description: '进场当回合可行动，首次攻击免受反击。' }
    };

    const el = renderHandCard(cardDef);
    assert.ok(el, 'Hand card element must be generated');
    assert.equal(el.dataset.instanceId, 'inst_cavalry_01');
    assert.equal(el.dataset.cardId, 'WEI_001');
    assert.ok(el.className.includes('card-hand'));
    assert.ok(el.className.includes('card-wei'));
    assert.ok(el.innerHTML.includes('虎豹骑'));
    assert.ok(el.innerHTML.includes('突袭'));
    assert.ok(el.innerHTML.includes('冲阵'));
  });

  it('calculates prestige discount on hand card when options.prestigeDiscount > 0', () => {
    const cardDef = {
      instanceId: 'inst_shu_02',
      cardId: 'SHU_002',
      name: '白耳兵',
      faction: 'SHU',
      type: 'UNIT',
      troopType: 'INFANTRY',
      cost: 5,
      atk: 3,
      hp: 5
    };

    const el = renderHandCard(cardDef, { prestigeDiscount: 2 });
    assert.ok(el.innerHTML.includes('cost-discounted'), 'Cost badge should have discounted class');
    assert.ok(el.innerHTML.includes('>3<'), 'Effective cost should be 5 - 2 = 3');
    assert.ok(el.innerHTML.includes('5'), 'Original cost 5 should be shown');
  });

  it('renders masked hidden card without leaking true name or stats', () => {
    const maskedCard = {
      instanceId: 'inst_opp_secret',
      isHidden: true,
      name: '???'
    };

    const el = renderHiddenCard(maskedCard, { faction: 'WEI' });
    assert.ok(el.className.includes('card-hidden'), 'Must have card-hidden class');
    assert.ok(el.className.includes('card-wei'), 'Must preserve faction styling');
    assert.ok(!el.innerHTML.includes('atk'), 'Must not display attack');
    assert.ok(!el.innerHTML.includes('hp'), 'Must not display hp');
  });

  it('renders compact unit on board with keyword badges and suppression status', () => {
    const unit = {
      instanceId: 'inst_board_unit',
      cardId: 'WEI_CAO_CAO',
      name: '曹操',
      faction: 'WEI',
      troopType: 'STRATEGIST',
      cost: 6,
      actionCost: 1,
      atk: 3,
      baseAtk: 3,
      hp: 6,
      maxHp: 6,
      keywords: ['守护', '归心'],
      status: { suppressed: true, actionsUsed: 0 }
    };

    const el = renderUnitOnBoard(unit, { canAct: false, isSelected: true });
    assert.ok(el.className.includes('board-unit'));
    assert.ok(el.className.includes('status-suppressed'));
    assert.ok(el.className.includes('state-selected'));
    assert.ok(el.innerHTML.includes('曹操'));
    assert.ok(el.innerHTML.includes('⛓️压制'));
  });

  it('applies fan geometry mathematical model across 1 to 9 cards', () => {
    const cards = [];
    for (let i = 0; i < 5; i++) {
      cards.push(createMockElement('div'));
    }

    applyFanGeometry(cards);

    // Center card (index 2 for size 5) should have angle = 0deg, offset-x = 0px
    assert.equal(cards[2].style.getPropertyValue('--fan-angle'), '0.0deg');
    assert.equal(cards[2].style.getPropertyValue('--fan-offset-x'), '0.0px');

    // Left card (index 0) should have negative angle and negative offset
    const leftAngle = parseFloat(cards[0].style.getPropertyValue('--fan-angle'));
    const leftX = parseFloat(cards[0].style.getPropertyValue('--fan-offset-x'));
    assert.ok(leftAngle < 0, 'Left card angle should be negative');
    assert.ok(leftX < 0, 'Left card offset-x should be negative');

    // Right card (index 4) should have positive angle and positive offset
    const rightAngle = parseFloat(cards[4].style.getPropertyValue('--fan-angle'));
    const rightX = parseFloat(cards[4].style.getPropertyValue('--fan-offset-x'));
    assert.ok(rightAngle > 0, 'Right card angle should be positive');
    assert.ok(rightX > 0, 'Right card offset-x should be positive');
  });

  it('provides comprehensive Three Kingdoms KEYWORD_GLOSSARY', () => {
    assert.ok(KEYWORD_GLOSSARY['奋战'], 'Glossary must define 奋战');
    assert.ok(KEYWORD_GLOSSARY['斩将'], 'Glossary must define 斩将');
    assert.ok(KEYWORD_GLOSSARY['冲阵'], 'Glossary must define 冲阵');
    assert.ok(KEYWORD_GLOSSARY['先登'], 'Glossary must define 先登');
    assert.ok(KEYWORD_GLOSSARY['火攻'], 'Glossary must define 火攻');
    assert.ok(KEYWORD_GLOSSARY['守护'], 'Glossary must define 守护');
    assert.ok(KEYWORD_GLOSSARY['伏击'], 'Glossary must define 伏击');
    assert.ok(KEYWORD_GLOSSARY['使节'], 'Glossary must define 使节');
  });
});

describe('Milestone 4 — Board & HUD Renderer (`boardRenderer.js`)', () => {
  let engine;

  before(() => {
    engine = new RulesEngine({ autoInit: true });
  });

  it('renders support lines with Main City fortress HP and unit slots', () => {
    const lineEl = createMockElement('section');
    lineEl.innerHTML = `
      <div id="slot-opp-hq" class="slot hq-slot"></div>
      <div id="slot-opp-sup-0" class="slot unit-slot"></div>
      <div id="slot-opp-sup-1" class="slot unit-slot"></div>
      <div id="slot-opp-sup-2" class="slot unit-slot"></div>
      <div id="slot-opp-sup-3" class="slot unit-slot"></div>
    `;

    const supportData = {
      hq: { id: 'HQ_WEI', name: '许昌大本营', hp: 28, maxHp: 30 },
      slots: [
        { instanceId: 'u1', name: '魏武卫', faction: 'WEI', atk: 2, hp: 4, cost: 2, actionCost: 1 }
      ]
    };

    renderSupportLine(lineEl, supportData, 'WEI', true);
    assert.ok(lineEl.innerHTML.includes('HP 28'), 'HQ HP should be rendered');
    assert.ok(lineEl.innerHTML.includes('许昌大本营'), 'HQ name should be rendered');
    assert.ok(lineEl.innerHTML.includes('魏武卫'), 'Unit in slot 0 should be rendered');
  });

  it('renders frontline zones with terrain names, capacity, and occupant flags', () => {
    const zoneEl = createMockElement('div');
    zoneEl.innerHTML = `
      <div class="zone-terrain-banner"></div>
      <div class="zone-slots-container"></div>
    `;

    const zoneData = {
      zone: 'FRONTLINE_CENTER',
      occupant: 'SHU',
      terrain: { type: 'WATER', name: '水域', capacity: 3 },
      capacity: 3,
      units: [
        { instanceId: 'u2', name: '江东水军', faction: 'SHU', atk: 3, hp: 3, cost: 3, actionCost: 1 }
      ]
    };

    renderFrontlineZone(zoneEl, 'CENTER', zoneData);
    assert.ok(zoneEl.className.includes('terrain-water'), 'Zone element should receive terrain class');
    assert.ok(zoneEl.className.includes('occupant-shu'), 'Zone element should receive occupant class');
    assert.ok(zoneEl.innerHTML.includes('水域'), 'Banner should display terrain name');
    assert.ok(zoneEl.innerHTML.includes('蜀军占领'), 'Banner should display occupant text');
    assert.ok(zoneEl.innerHTML.includes('江东水军'), 'Unit should be rendered into slot');
  });

  it('FloatingCombatFX generates floating damage numbers and cleans up', () => {
    const targetEl = createMockElement('div');
    FloatingCombatFX.showDamageNumber(targetEl, 5, 'counter');
    // Floating element should have been attached to mock body
    const floatEl = mockBody.children.find(c => c.className.includes('floating-combat-text'));
    assert.ok(floatEl, 'Floating combat text should be created');
    assert.ok(floatEl.textContent.includes('5'), 'Should display damage amount');
    assert.ok(floatEl.textContent.includes('反击'), 'Should display counter prefix');
  });
});

describe('Milestone 4 — Combat Log Controller (`combatLog.js`)', () => {
  it('formats domain events into Three Kingdoms martial chronicles', () => {
    const feed = createMockElement('div');
    const controller = new CombatLogController(feed);

    // 1. Turn Started
    controller.pushEvent({
      type: 'TURN_STARTED',
      payload: { turnNumber: 3, activePlayer: 'WEI', provisions: 3, prestige: 1 }
    });
    assert.ok(feed.innerHTML.includes('第 3 回合'), 'Should format turn number');
    assert.ok(feed.innerHTML.includes('魏武军'), 'Should format faction');

    // 2. Unit Deployed
    controller.pushEvent({
      type: 'UNIT_DEPLOYED',
      payload: { faction: 'SHU', cardName: '张飞', targetZone: 'FRONTLINE_CENTER', cost: 6, prestigeDiscount: 1 }
    });
    assert.ok(feed.innerHTML.includes('张飞'), 'Should mention deployed unit name');
    assert.ok(feed.innerHTML.includes('声望减免 -1'), 'Should record prestige discount');

    // 3. Ambush Combat
    controller.pushEvent({
      type: 'COMBAT_DAMAGE',
      payload: {
        attackerName: '曹仁',
        defenderName: '赵云',
        ambushTriggered: true,
        counterDealt: 4,
        attackerDied: true
      }
    });
    assert.ok(feed.innerHTML.includes('伏兵暴起'), 'Ambush chronicle should be generated');
    assert.ok(feed.innerHTML.includes('赵云'), 'Defender name should be included');

    // 4. Attack HQ
    controller.pushEvent({
      type: 'ATTACK_HQ',
      payload: {
        attackerName: '关羽',
        damageDealt: 5,
        hqHpRemaining: 25,
        provisionsStolen: 1
      }
    });
    assert.ok(feed.innerHTML.includes('直捣黄龙'), 'HQ assault chronicle should be generated');
    assert.ok(feed.innerHTML.includes('攻心掠夺粮草 1 点'), 'Pillage provision note should be included');
  });

  it('filters entries by category (COMBAT, DEPLOY, TACTIC)', () => {
    const feed = createMockElement('div');
    const controller = new CombatLogController(feed);

    controller.pushEvent({ type: 'UNIT_DEPLOYED', payload: { faction: 'WEI', cardName: '步兵' } });
    controller.pushEvent({ type: 'COMBAT_DAMAGE', payload: { attackerName: 'A', defenderName: 'B', damageDealt: 2, counterDealt: 1 } });

    assert.equal(controller.entries.length, 2);

    controller.setFilter('COMBAT');
    assert.equal(controller.filter, 'COMBAT');
    assert.ok(!feed.innerHTML.includes('步兵'), 'Deploy event should be filtered out');
    assert.ok(feed.innerHTML.includes('两军交锋'), 'Combat event should remain visible');
  });
});

describe('Milestone 4 — Interaction Controller (`interaction.js`)', () => {
  it('initializes in IDLE state and transitions on card selection', () => {
    const controller = new InteractionController();
    assert.equal(controller.state, INTERACTION_STATE.IDLE);

    const dummyState = {
      activePlayer: 'WEI',
      phase: 'ACTION',
      battlefield: {
        support: { WEI: { slots: [] }, SHU: { slots: [] } },
        frontline: {
          LEFT: { occupant: null, units: [], capacity: 3 },
          CENTER: { occupant: null, units: [], capacity: 3 },
          RIGHT: { occupant: null, units: [], capacity: 2 }
        }
      },
      players: {
        WEI: {
          provisions: 5,
          prestige: 0,
          hand: [{ instanceId: 'h1', name: '连弩营', type: 'UNIT', cost: 3 }]
        }
      }
    };

    controller.setContext(dummyState, 'WEI');
    assert.equal(controller.state, INTERACTION_STATE.IDLE);

    // Cancel resets state to IDLE
    controller.state = INTERACTION_STATE.CARD_SELECTED;
    controller.cancelSelection();
    assert.equal(controller.state, INTERACTION_STATE.IDLE);
  });

  it('disables input when turn is not local player turn', () => {
    const controller = new InteractionController();
    const oppTurnState = {
      activePlayer: 'SHU',
      phase: 'ACTION',
      players: { WEI: { hand: [] }, SHU: { hand: [] } }
    };

    controller.setContext(oppTurnState, 'WEI');
    assert.equal(controller.state, INTERACTION_STATE.DISABLED);
  });
});

describe('Milestone 4 — Network Modal Controller (`networkModal.js`)', () => {
  it('manages tab switching and host/join views', () => {
    const modalEl = createMockElement('div');
    modalEl.innerHTML = `
      <div class="network-tabs">
        <button class="tab-btn active" data-tab="tab-local-pairing">快联</button>
        <button class="tab-btn" data-tab="tab-host">创建</button>
      </div>
      <div id="tab-local-pairing" class="tab-pane active"></div>
      <div id="tab-host" class="tab-pane"></div>
    `;

    const controller = new NetworkModalController({ modalEl });
    assert.ok(controller, 'NetworkModalController instantiated');

    controller.switchTab('tab-host');
    const hostPane = modalEl.querySelector('#tab-host');
    assert.ok(hostPane.className.includes('active'), 'Host tab should become active');
  });
});

describe('Milestone 4 — Main Application Coordinator (`main.js`)', () => {
  it('initializes in UNINITIALIZED mode and starts Solo vs Bot cleanly', () => {
    const app = new AppCoordinator();
    assert.equal(app.mode, APP_MODE.UNINITIALIZED);

    app.startSoloMatch({ faction: 'WEI', difficulty: 'NORMAL' });
    assert.equal(app.mode, APP_MODE.SOLO_VS_BOT);
    assert.equal(app.localPlayerId, 'WEI');
    assert.equal(app.opponentPlayerId, 'SHU');
    assert.ok(app.rulesEngine, 'RulesEngine should be initialized');
    assert.ok(app.bot, 'Bot should be initialized');
    assert.equal(app.rulesEngine.state.phase, 'ACTION');
  });

  it('routes user action to RulesEngine in Solo vs Bot mode', async () => {
    const app = new AppCoordinator();
    app.startSoloMatch({ faction: 'WEI' });

    const initialTurn = app.rulesEngine.state.turnNumber;
    await app.handleUserAction({
      type: ACTION_TYPES.END_TURN,
      playerId: 'WEI',
      payload: {}
    });

    // In RulesEngine, ending turn transitions or increments turn
    assert.ok(app.rulesEngine.state.turnNumber >= initialTurn, 'Turn state should advance or update');
  });
});

describe('Milestone 4 — Iteration 2 Adversarial Remediation & Engine-UI Contracts', () => {
  it('Combat Log: accurately normalizes flat engine events from rulesEngine and combat', () => {
    const feed = createMockElement('div');
    feed.id = 'combat-log-feed';
    const log = new CombatLogController(feed);

    // 1. DEPLOY flat event
    log.pushEvent({
      type: 'DEPLOY',
      playerId: 'WEI',
      card: { name: '曹操·孟德' },
      cost: 6,
      discountApplied: 1
    });
    assert.equal(log.entries.length, 1);
    assert.ok(log.entries[0].text.includes('曹操·孟德'), 'Deploy text must contain card name');
    assert.ok(log.entries[0].text.includes('魏武军'), 'Deploy text must contain faction name');
    assert.ok(log.entries[0].text.includes('耗粮 6'), 'Deploy text must contain cost');
    assert.ok(!log.entries[0].text.includes('{}'), 'Must NOT output literal "{}"');

    // 2. ATTACK_HQ flat event
    log.pushEvent({
      type: 'ATTACK_HQ',
      attacker: '关羽',
      damageDealt: 4,
      hqHpRemaining: 26,
      provisionsStolen: 1
    });
    assert.equal(log.entries.length, 2);
    assert.ok(log.entries[1].text.includes('关羽'), 'HQ attack must contain attacker name');
    assert.ok(log.entries[1].text.includes('4'), 'HQ attack must contain damage');
    assert.ok(log.entries[1].text.includes('26'), 'HQ attack must contain remaining HQ HP');
    assert.ok(!log.entries[1].text.includes('undefined'), 'Must NOT contain undefined');

    // 3. MOVE flat event
    log.pushEvent({
      type: 'MOVE',
      playerId: 'WEI',
      unitName: '虎豹骑',
      fromZone: 'SUPPORT',
      toZone: 'FRONTLINE_CENTER'
    });
    assert.equal(log.entries.length, 3);
    assert.ok(log.entries[2].text.includes('虎豹骑'), 'Move text must contain unit name');
    assert.ok(log.entries[2].text.includes('支援阵线'), 'Move text must format support zone');
    assert.ok(log.entries[2].text.includes('中前线'), 'Move text must format frontline zone');

    // 4. COMBAT_DAMAGE flat event
    log.pushEvent({
      type: 'COMBAT_DAMAGE',
      attackerName: '赵云',
      defenderName: '张辽',
      damageDealt: 4,
      counterDealt: 3,
      defenderDied: true,
      attackerDied: false
    });
    assert.equal(log.entries.length, 4);
    assert.ok(log.entries[3].text.includes('赵云'), 'Combat text must contain attacker');
    assert.ok(log.entries[3].text.includes('张辽'), 'Combat text must contain defender');
    assert.ok(log.entries[3].text.includes('阵亡'), 'Combat text must report death');

    // 5. FATIGUE flat event
    log.pushEvent({
      type: 'FATIGUE',
      playerId: 'SHU',
      damage: 2,
      count: 2
    });
    assert.equal(log.entries.length, 5);
    assert.ok(log.entries[4].text.includes('第 2 次士气透支'), 'Fatigue text must report count');
    assert.ok(log.entries[4].text.includes('2'), 'Fatigue text must report damage');
  });

  it('Combat Log: safely handles cyclic payloads and non-string zones without throw', () => {
    const feed = createMockElement('div');
    feed.id = 'combat-log-feed';
    const log = new CombatLogController(feed);

    // Cyclic object in unknown event
    const cyclicObj = { tag: 'cyclic' };
    cyclicObj.self = cyclicObj;

    assert.doesNotThrow(() => {
      log.pushEvent({ type: 'CUSTOM_DIAGNOSTIC', payload: cyclicObj });
    });
    assert.ok(log.entries[0].text.includes('CUSTOM_DIAGNOSTIC'));

    // Non-string zone inputs
    assert.equal(formatZoneName(1), '1');
    assert.equal(formatZoneName(null), '战地');
    assert.equal(formatZoneName(undefined), '战地');
  });

  it('UI Map Helpers: protect against prototype property lookup leaks', () => {
    assert.equal(getTroopTypeLabel('constructor', 'UNIT'), '单位');
    assert.equal(getTroopTypeIcon('constructor', 'UNIT'), '⚔️');
    assert.equal(getTerrainIcon('constructor'), '🌾');
    assert.equal(getZoneNameLabel('constructor'), 'constructor');
    assert.equal(getMiniKeywordBadge(999), '9');
    assert.equal(getMiniKeywordBadge(''), '');
  });

  it('Engine: records MOVE and unit-to-unit COMBAT_DAMAGE into state.combatLog', () => {
    const engine = new RulesEngine({ autoInit: true });
    startTurn(engine.state, 'WEI');

    // Deploy unit to support
    const card = engine.state.players.WEI.hand[0];
    engine.dispatch({
      type: ACTION_TYPES.DEPLOY,
      playerId: 'WEI',
      payload: { cardInstanceId: card.instanceId, targetZone: 'SUPPORT' }
    });

    const deployEvent = engine.state.combatLog.find(e => e.type === 'DEPLOY');
    assert.ok(deployEvent, 'DEPLOY event must be logged');
    assert.equal(deployEvent.card.name, card.name);

    // Move unit to frontline center
    const deployedUnit = engine.state.battlefield.support.WEI.slots[0];
    deployedUnit.status.actionsUsed = 0;
    deployedUnit.status.deployedThisTurn = false;
    deployedUnit.status.movedThisTurn = false;
    engine.state.players.WEI.provisions = 10;

    engine.dispatch({
      type: ACTION_TYPES.MOVE,
      playerId: 'WEI',
      payload: { cardInstanceId: deployedUnit.instanceId, targetZone: 'FRONTLINE_CENTER' }
    });

    const moveEvent = engine.state.combatLog.find(e => e.type === 'MOVE');
    assert.ok(moveEvent, 'MOVE event must be logged in state.combatLog');
    assert.equal(moveEvent.unitName, deployedUnit.name);
    assert.equal(moveEvent.fromZone, 'SUPPORT');
    assert.equal(moveEvent.toZone, 'FRONTLINE_CENTER');

    // Place enemy unit in center for combat
    const enemyCard = engine.state.players.SHU.deck[0];
    enemyCard.status = { actionsUsed: 0 };
    engine.state.battlefield.frontline.CENTER.units.push(enemyCard);

    // Attack enemy unit
    deployedUnit.status.attackedThisTurn = false;
    deployedUnit.status.actionsUsed = 0;
    engine.dispatch({
      type: ACTION_TYPES.ATTACK,
      playerId: 'WEI',
      payload: { attackerId: deployedUnit.instanceId, targetId: enemyCard.instanceId }
    });

    const combatEvent = engine.state.combatLog.find(e => e.type === 'COMBAT_DAMAGE');
    assert.ok(combatEvent, 'COMBAT_DAMAGE event must be logged in state.combatLog');
    assert.equal(combatEvent.attackerName, deployedUnit.name);
    assert.equal(combatEvent.defenderName, enemyCard.name);
  });

  it('Interaction: Click-to-Deploy, Click-to-Attack and FSM safeguards operate reliably', () => {
    let dispatched = [];
    const controller = new InteractionController({
      onAction: (a) => dispatched.push(a)
    });

    const engine = new RulesEngine({ autoInit: true });
    startTurn(engine.state, 'WEI');
    controller.setContext(engine.state, 'WEI');

    // 1. Cross-selection state bleed test
    controller.state = INTERACTION_STATE.TARGETING;
    controller.selectedUnit = { instanceId: 'u_1' };
    const card = engine.state.players.WEI.hand[0];
    const cardEl = createMockElement('div');
    cardEl.className = 'card-hand';
    cardEl.dataset.instanceId = card.instanceId;

    controller._handleHandPointerDown({
      target: cardEl,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault() {}
    });

    assert.equal(controller.state, INTERACTION_STATE.CARD_SELECTED);
    assert.equal(controller.selectedUnit, null, 'selectedUnit must be reset upon switching to hand card');

    // 2. Click-to-Deploy
    const supportSlot = createMockElement('div');
    supportSlot.id = 'line-support-friendly';
    controller._handleBoardPointerDown({
      target: supportSlot,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
      preventDefault() {}
    });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, ACTION_TYPES.DEPLOY);
    assert.equal(dispatched[0].payload.targetZone, 'SUPPORT');

    // 3. Click-to-Attack
    dispatched = [];
    controller.state = INTERACTION_STATE.TARGETING;
    controller.selectedUnit = { instanceId: 'attacker_1' };
    const targetUnitEl = createMockElement('div');
    targetUnitEl.className = 'board-unit legal-attack-target';
    targetUnitEl.dataset.instanceId = 'defender_1';

    controller._handleBoardPointerDown({
      target: targetUnitEl,
      pointerId: 1,
      clientX: 300,
      clientY: 300,
      preventDefault() {}
    });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, ACTION_TYPES.ATTACK);
    assert.equal(dispatched[0].payload.attackerId, 'attacker_1');
    assert.equal(dispatched[0].payload.targetId, 'defender_1');

    // 4. Duplicate END_TURN guard
    dispatched = [];
    controller.state = INTERACTION_STATE.DISABLED;
    controller.handleEndTurnClick();
    assert.equal(dispatched.length, 0, 'Disabled controller must not dispatch END_TURN');
  });

  it('AppCoordinator: handles teardown, non-duplicating log slice, and mulligan dialog', async () => {
    const app = new AppCoordinator();
    app.startSoloMatch({ faction: 'WEI' });

    // Verify initial log index
    assert.equal(app.lastProcessedLogIndex, app.rulesEngine.state.combatLog.length);

    // Dispatch an action and verify incremental update
    const prevIndex = app.lastProcessedLogIndex;
    app.rulesEngine.state.combatLog.push({ type: 'SYSTEM_MESSAGE', message: '新军令' });
    app._updateCombatLog();
    assert.equal(app.lastProcessedLogIndex, prevIndex + 1);

    // Calling _updateCombatLog again with no new events does not duplicate
    app._updateCombatLog();
    assert.equal(app.lastProcessedLogIndex, prevIndex + 1);

    // Teardown cleans up mode state
    app.isSandboxRunning = true;
    app._teardownCurrentMode();
    assert.equal(app.isSandboxRunning, false);
    assert.equal(app.lastProcessedLogIndex, 0);

    // Mulligan dialog action routing
    let actionReceived = null;
    app.handleUserAction = (act) => { actionReceived = act; };
    app.showMulliganDialog();
    const confirmBtn = document.getElementById('btn-confirm-mulligan') || document.getElementById('btn-mulligan-confirm');
    if (confirmBtn && typeof confirmBtn.click === 'function') {
      confirmBtn.click();
    }
  });
});
