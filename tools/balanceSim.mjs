/**
 * 平衡测试：AI 对 AI 批量对局，统计卡组胜率。
 * 用法：node tools/balanceSim.mjs <卡组A> <卡组B> [局数]
 *   卡组写法：preset_wei_standard 这类预设 id，或 JSON 文件路径（deckStore 格式）
 * 也可 import { simulate } 在脚本里调用。
 */
import { RulesEngine } from '../js/engine/rulesEngine.js';
import { HeuristicBot } from '../js/bot/heuristicBot.js';
import { startTurn, createCard, createKingdomDeck } from '../js/engine/state.js';
import { getDeck, deckCardDefs, DUAL } from '../js/data/deckStore.js';
import { readFileSync } from 'node:fs';

export function loadDeck(ref) {
  if (typeof ref === 'object') return ref;
  if (ref.endsWith('.json')) return JSON.parse(readFileSync(ref, 'utf8'));
  const d = getDeck(ref);
  if (!d) throw new Error(`unknown deck ${ref}`);
  return d;
}

function playOne(deckA, deckB, seed, aFirst) {
  const seats = aFirst ? { WEI: deckA, SHU: deckB } : { WEI: deckB, SHU: deckA };
  const build = (d, seat) => deckCardDefs(d).map(def => createCard(def, { faction: seat, kingdom: def.kingdom || d.kingdom }));
  const reserve = (d, seat) => [d.kingdom, d.subKingdom].filter(Boolean).flatMap(k => createKingdomDeck(k, seat).reservePool);
  const dual = deckA.mode === 'dual' || deckB.mode === 'dual';
  const re = new RulesEngine({
    autoInit: true, seed, shuffleDecks: true, randomTerrains: true, weiHq: 'RANDOM', shuHq: 'RANDOM',
    weiKingdom: seats.WEI.kingdom, shuKingdom: seats.SHU.kingdom, firstPlayer: 'WEI',
    weiDeck: build(seats.WEI, 'WEI'), shuDeck: build(seats.SHU, 'SHU'),
    weiReserve: reserve(seats.WEI, 'WEI'), shuReserve: reserve(seats.SHU, 'SHU'),
    initialHp: dual ? DUAL.HQ_HP : 20
  });
  const s = re.state;
  if (s.phase === 'MULLIGAN') startTurn(s, s.firstPlayer);
  const bots = { WEI: new HeuristicBot('WEI'), SHU: new HeuristicBot('SHU') };
  let errors = 0;
  for (let i = 0; i < 1200 && s.phase !== 'GAME_OVER'; i++) {
    const p = s.activePlayer;
    const a = bots[p].chooseBestAction(s, p);
    try { re.dispatch(a && a.type !== 'END_TURN' ? a : { type: 'END_TURN', playerId: p, payload: {} }); }
    catch { errors++; re.dispatch({ type: 'END_TURN', playerId: p, payload: {} }); }
  }
  const aSeat = aFirst ? 'WEI' : 'SHU';
  return { winner: s.phase === 'GAME_OVER' ? (s.winner === aSeat ? 'A' : 'B') : 'draw', turns: s.turnNumber, errors };
}

export function simulate(refA, refB, games = 100, seed0 = 1) {
  const A = loadDeck(refA), B = loadDeck(refB);
  let a = 0, b = 0, draw = 0, turns = 0, errors = 0;
  for (let g = 0; g < games; g++) {
    const r = playOne(A, B, seed0 * 100000 + g, g % 2 === 0);
    if (r.winner === 'A') a++; else if (r.winner === 'B') b++; else draw++;
    turns += r.turns; errors += r.errors;
  }
  return { a, b, draw, rateA: a / Math.max(1, a + b), avgTurns: turns / games, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [A, B, n] = process.argv.slice(2);
  const r = simulate(A, B, Number(n || 100));
  console.log(`${A} vs ${B}: A胜 ${r.a}  B胜 ${r.b}  平 ${r.draw}  A胜率 ${(r.rateA * 100).toFixed(1)}%  平均回合 ${r.avgTurns.toFixed(1)}  规则报错 ${r.errors}`);
}
