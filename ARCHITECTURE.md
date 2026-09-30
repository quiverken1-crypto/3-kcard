# 三国KARDS · 架构与开放接口

这是一个**纯前端**网页卡牌游戏：没有后端服务器，所有规则、AI、存档都在浏览器里运行；联机是两台浏览器之间的 P2P（主机权威）。
仓库：<https://github.com/quiverken1-crypto/3-kcard>（代码 MIT，美术/音频另行授权，见 `LICENSE`）。

本文给想继续开发的人或 AI：先看「一分钟上手」，再按需查后面的章节。

---

## 一分钟上手

```bash
# 本地运行（任意静态服务器都行）
python3 -m http.server 8765        # 然后打开 http://localhost:8765
# 规则回归测试（Node 18+）
node tests/runTests.js
# AI 对战平衡测试：卡组 id 或 .json 文件
node tools/balanceSim.mjs preset_wei_standard preset_shu_standard 100
```

浏览器控制台里有开放接口 `window.SGK`（源码 `js/api.js`）：

```js
SGK.data.card('gsz_zhao_yun')                 // 查卡
SGK.data.libraryFor('wu')                     // 某势力全部卡
SGK.decks.officialPresets()                   // 全部系统预设
const s = SGK.engine.createInitialState({ phase: 'ACTION' });
SGK.engine.getLegalActions(s, 'WEI');         // 合法动作
SGK.engine.dispatch(s, { type: 'END_TURN', playerId: 'WEI' });
SGK.skills.PLUGIN_HOOKS.afterAttack.push((state, atk, def, result) => console.log(atk.name, '攻击了', def?.name));
```

---

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `index.html` | 唯一页面：主页、对局界面、各种弹窗的 DOM 骨架 |
| `css/` | 样式。`style → board → cards → animations → usability → theme → layout → fx → mobile → deck → polish` 依次覆盖，**后加载的优先**；新样式请放 `polish.css` 末尾 |
| `js/main.js` | 应用协调器 `AppCoordinator`：主页、开局、人机/联机/沙盘三种模式、渲染循环、计时器 |
| `js/api.js` | 开放接口 `window.SGK`（只做聚合导出，不含逻辑） |
| **`js/engine/`** | **规则引擎（与界面完全解耦，可在 Node 里跑）** |
| `engine/constants.js` | 座位 `WEI/SHU`、兵种、阶段、动作类型、地形、词条名 |
| `engine/state.js` | 创建初始局面、抽牌、回合切换、`findUnit / getAllUnits / removeUnitFromBoard` |
| `engine/rulesEngine.js` | `dispatch(state, action)` 总入口：部署/移动/攻击/战法/反制/结束回合…，`getLegalActions` |
| `engine/combat.js` | 攻击合法性校验 `validateAttack` 与伤害结算（守护、坚阵、伏击、先登、冲阵、矢石、游击…） |
| `engine/cardSkills.js` | **所有具体卡牌技能**：进场技能、战法、反制、主动技能、光环、离场结算、插件钩子 |
| `engine/abilities.js` | 工坊“积木”技能的目录与执行器（时机/效果/目标/筛选/条件/光环/主动技） |
| `engine/preview.js` | 伤害预演（克隆局面后模拟一次动作） |
| `engine/prng.js` | 可复现随机数 |
| **`js/data/`** | **数据** |
| `data/cardDB.js` | **卡牌数据库**（实体卡）：魏、蜀、吴、吕布、公孙瓒、袁绍(ys)、黄巾(hj)、董卓(dz)、西凉(xl)、刘表(lbiao)、袁术(yshu) + 通用战法；紧凑行格式见文件头注释 |
| `data/terrains.js` | 地形定义与各势力主城 `HQ_CARDS` |
| `data/presetDecks.js` | 手工配置的预设卡组（标准预设由卡牌库自动生成） |
| `data/deckStore.js` | 卡组：本机存储、校验、双阵营、分享码（`SGK1-…`） |
| `data/customContent.js` | 自定义内容 v2（工坊）：本机存储、卡包码（`SGKP1-…`）、导入导出、联机临时登记 |
| `js/ui/` | 界面：棋盘渲染、卡面、交互（点选/拖拽/瞄准）、卡组页、工坊、战报、音效、特效 |
| `js/bot/` | 启发式 AI：`heuristicBot.js`（1 层模拟 + 局面评估 `evaluator.js`） |
| `js/network/` | 联机：公共 MQTT 配对 + WebRTC P2P，失败时中转；`syncProtocol.js` 主机权威同步 |
| `tools/balanceSim.mjs` | AI 对 AI 批量对战，输出胜率 |
| `tests/` | Node 测试（`node tests/runTests.js`） |
| `sw.js` | 离线缓存（改了资源请把 `VERSION` 加一） |

---

## 数据流

```
玩家操作(interaction.js) ─┐
AI(heuristicBot.js)      ├─> action ─> rulesEngine.dispatch(state, action) ─> 新 state ─> boardRenderer 渲染
联机对端(syncProtocol)   ─┘                     │
                                               ├─ combat.js（攻击）
                                               └─ cardSkills.js（技能、光环、离场、钩子） + abilities.js（积木）
```

- **state 是普通对象**，可以 `structuredClone`、`JSON.stringify`；联机时主机把整个 state 发给客机。
- 所有随机都走 `state.prng`，同一个 `seed` 可复现。
- 引擎不访问 DOM；界面层只读 state 并发 action。

### 局面 state（节选）

```js
{
  turnNumber, activePlayer: 'WEI'|'SHU', phase: 'SETUP'|'MULLIGAN'|'ACTION'|'GAME_OVER', winner,
  players: { WEI: { hp, maxHp, provisions, provisionsCap, prestige, hand: [card], deck: [card], discard: [card],
                    reserve, kingdom, pendingChoices: [...], pendingPick }, SHU: {...} },
  battlefield: {
    support:   { WEI: { hq: {...}, slots: [unit] }, SHU: {...} },          // 支援阵线（最多 5 个单位）
    frontline: { LEFT|CENTER|RIGHT: { occupant: 'WEI'|'SHU'|null, terrain, capacity, units: [unit] } }
  },
  activeCounters: [...], combatLog: [...], turnEffects: {...}
}
```

卡牌实例由 `createCard(def, overrides)` 生成：`{ instanceId, cardId, name, kingdom, faction, type, troopType, cost, actionCost, atk, hp, maxHp, keywords[], badges[], skill{name,description}, abilities[], status{...} }`。

### 动作 action

| type | payload |
| --- | --- |
| `DEPLOY` | `{ cardInstanceId, targetZone: 'SUPPORT'|'LEFT'|'CENTER'|'RIGHT', slotIndex?, targetId? }`（`targetId` 给需要选目标的进场技能） |
| `MOVE` | `{ cardInstanceId, targetZone, slotIndex? }` |
| `ATTACK` | `{ attackerId, targetId }`（`targetId` 为单位 instanceId 或 `'HQ'`） |
| `PLAY_TACTIC` | `{ cardInstanceId, targetId?, handCardId? }` |
| `SET_COUNTER` | `{ cardInstanceId }` |
| `ACTIVATE_SKILL` | `{ unitId, cardId? }` |
| `CHOOSE_TARGET` | `{ choiceId, targetId }` 或 `{ choiceId, random: true }`（回应 `pendingChoices`） |
| `PICK_CARDS` | `{ cardIds: [] }`（回应 `pendingPick`，如“豪杰归心”） |
| `MULLIGAN` / `END_TURN` / `SURRENDER` | — |

---

## 常见扩展：怎么加东西

### 1. 加一张卡 / 一个势力（正式并入卡牌库）

1. `js/data/cardDB.js`：在对应势力数组里加一行
   `[id, 名称, 'U'|'T'|'C', 兵种 'I'|'C'|'N'|'S'|'E'|'-', 部署费, 行动费, 战力, 生命, [词条], [性格], 技能名, 技能描述, 张数, 推断说明?]`
   - id 用 `势力前缀_拼音`，如 `wu_zhou_yu`。
   - 不想放进标准预设的卡，放进 `*_EXTRA` / `*_NEW` 数组（`markExtra` 标记，卡组编辑器可自选）。
   - 新势力：`KINGDOMS` 加一项 → `CARDS_BY_KINGDOM` 加一项 → `terrains.js` 的 `HQ_CARDS` 加主城 →
     `deckStore.js` 与 `main.js` 的 `KINGDOM_KEYS` 加 key → `cardSkills.js` 的 `commonTactic` 势力列表加 key → `css/polish.css` 加配色（参考 `faction-gsz`）。
2. 技能写进 `js/engine/cardSkills.js`（见下一节），卡面文字写在 cardDB 的“技能描述”。
3. `node tests/runTests.js` + `node tools/balanceSim.mjs` 验证；把 `sw.js` 的 `VERSION` 加一。

### 2. 给卡牌写技能（`js/engine/cardSkills.js`）

| 需求 | 写在哪里 |
| --- | --- |
| 进场时效果 | `DEPLOY_SKILLS[id] = (state, unit) => {...}`；需要玩家选目标再加 `DEPLOY_TARGETS[id] = { prompt, list(state, owner, card) }`，在技能里用 `chosenOr(list, unit, 默认挑选)` 取玩家所选 |
| 战法 | `TACTICS[id] = { targets?, autoPick?, precheck?, precheckMsg?, play(state, owner, card, target, payload) }` |
| 反制 | `COUNTERS[id] = { event, check(state, owner, ctx), fire(state, owner, ctx) }`，event：`ENEMY_TACTIC` / `ENEMY_MOVE` / `OWN_ATTACKED` / `ENEMY_ATTACK` |
| 主动技能 | `ACTIVE_SKILLS[id] = { name, desc, needsHandCard?, apply(state, unit, payload) }`（每回合 1 次，界面会自动出现“发动”按钮） |
| 结算中途让玩家选 | `CHOICE_SPECS[kind] = { source, prompt, pool: 'board'|'hand'|'option', auto(list, state, pid), apply(state, pid, target, choice) }`，调用 `queueChoice(state, pid, kind, sourceUnit, candidates, extra)`；15 秒不选随机 |
| 整个势力的一批技能 | 参考 `engine/factions2.js`：只用开放注册表（`DEPLOY_SKILLS`/`TACTICS`/`COUNTERS`/`CHOICE_SPECS`）+ `PLUGIN_HOOKS` + 扩展点 `EXT`（战力、行动/部署花费、伤害修正、回合开始、摸牌、主城受伤/增防、光环、游击、掳掠…），不改核心流程 |
| 攻击后 / 离场 / 回合结束 / 持续光环 | `afterAttack()`、`processDeaths()`、`onTurnEnd()`、`refreshAuras()` / `gszAuras()` 里按 `isId(unit, 'xxx')` 添加 |
| 数值修正 | 战力 `getAttackValue()`，行动花费 `getActionCost()`，主城减伤 `hqDamageAfterSkills()` |
| 不想改核心 | `PLUGIN_HOOKS.onEnter / afterAttack / onDeath / onTurnEnd` 数组里 push 函数 |

常用工具（都已从 `cardSkills.js` 导出，也在 `SGK.skills` 上）：`damageUnit`、`damageHq`、`healHq`、`suppressUnit`、`retreatUnit`、`buff`、`searchDeck`、`log`、`isId`、`hasKeyword`、`canTargetEnemy`、`canSkillTarget`。

**规则约定**：死亡优先于技能结算（已离场的单位不再结算“进场/攻击后”技能，只结算“阵亡时”）；结算完调用 `processDeaths(state)`、`refreshAuras(state)`。

### 3. 不写代码：用工坊 / 积木

游戏内「工坊」可以新建势力和卡牌；技能可以用积木（`js/engine/abilities.js`）：
时机（进场、攻击后、阵亡、回合开始、联动、反制、光环、**主动技**…）× 效果（资源、主城、数值、状态、词条、位置、检索）×
目标（玩家、单个、玩家选择、随机、群体）× 筛选（兵种/位置/性格/词条）× 条件；主动技 = 消耗 → 判定（概率/条件）→ 获得。
积木表达不了的，把技能写成文字并勾“待实现”，导出文件交给开发者按上一节写进代码。

卡包格式（schemaVersion 2）见 `CARD_PACK_SCHEMA.md`，示例 `examples/custom-cards.json`。代码里：`SGK.content.importPack(pack)`。

### 4. 平衡

`tools/balanceSim.mjs` 用同一个 AI 让两套卡组对打，先后手轮换。胜率只反映“当前 AI 的打法”，仅作参考。

---

## 已知限制 / 待办

- 回归测试里有 9 项长期失败（音效、手牌叠放等旧测试与现界面不一致，非规则 bug）。
- 许攸的【军机】词条规则未公布，暂无效果。
- 公孙瓒标准卡组中有 13 张为通用战法补足（卡面标“通用补足”）。
- AI 对工坊主动技的用法很简单：不需要弃牌、付得起就发动。
