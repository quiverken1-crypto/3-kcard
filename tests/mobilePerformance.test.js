import test from 'node:test';
import assert from 'node:assert/strict';
import { HeuristicBot } from '../js/bot/heuristicBot.js';
import { RulesEngine } from '../js/engine/rulesEngine.js';
import { setupGame, executeMulligan, startTurn } from '../js/engine/state.js';
import { renderHandFan } from '../js/ui/boardRenderer.js';

test('cooperative AI yields without changing its selected action or the real state', async () => {
  const engine = new RulesEngine();
  setupGame(engine.state);
  executeMulligan(engine.state, 'WEI', []);
  executeMulligan(engine.state, 'SHU', []);
  startTurn(engine.state, 'WEI');
  const before = JSON.stringify(engine.state);
  for (const temperature of [0, .2]) {
    const synchronous = new HeuristicBot('WEI', { seed: 234, temperature });
    const cooperative = new HeuristicBot('WEI', { seed: 234, temperature });
    let yields = 0;
    const result = await cooperative.chooseBestActionAsync(engine.state, 'WEI', {
      budgetMs: 0, yieldTask: async () => { yields++; },
    });
    assert.deepEqual(result, synchronous.chooseBestAction(engine.state));
    assert.ok(yields > 0, 'candidate planning must give the browser time to respond');
  }
  assert.equal(JSON.stringify(engine.state), before);
});

test('mobile hand keeps existing card nodes until content or costs change', () => {
  const oldDocument = globalThis.document;
  const classes = { remove() {}, toggle() {}, contains: name => name === 'm-land' };
  const container = {
    children: [], classList: classes,
    set innerHTML(value) { this.children = []; },
    appendChild(node) { this.children.push(node); },
    querySelectorAll() { return this.children; },
  };
  globalThis.document = {
    body: { classList: classes },
    createElement: () => ({ dataset: {}, style: {} }),
  };
  const player = { hand: [{ instanceId: 'one', cardId: 'test', faction: 'WEI', type: 'UNIT', name: '测试', cost: 3, hp: 4, atk: 2 }], prestige: 0 };
  try {
    renderHandFan(container, player);
    const first = container.children[0];
    renderHandFan(container, player);
    assert.equal(container.children[0], first);
    player.prestige = 1;
    renderHandFan(container, player);
    assert.notEqual(container.children[0], first);
    const discounted = container.children[0];
    player.hand[0].hp = 3;
    renderHandFan(container, player);
    assert.notEqual(container.children[0], discounted);
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});
