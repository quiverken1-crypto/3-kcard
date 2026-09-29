# 参与贡献（给人，也给 AI）

欢迎任何人（或 AI 助手）继续完善三国KARDS。原作者会有较长时间不维护，本文尽量让你**不问任何人也能上手**。

## 先读

1. `ARCHITECTURE.md` —— 目录、数据流、state/action 格式、怎么加卡/加势力/写技能。
2. `README.md` —— 按时间记录的更新说明（规则的来龙去脉都在这里）。
3. `CARD_PACK_SCHEMA.md` —— 自定义卡包 JSON 格式（工坊导出 / 导入）。

## 工作流

```bash
python3 -m http.server 8765      # 手动试玩：http://localhost:8765
node tests/runTests.js           # 规则回归测试（目前有 9 项旧失败，见 ARCHITECTURE.md 末尾）
node tools/balanceSim.mjs A B 100   # 平衡测试
```

提交前自检清单：

- [ ] 改规则/技能后跑 `node tests/runTests.js`，失败项不比改前多。
- [ ] 新卡：技能描述（卡面文字）和代码行为一致；看不清/推断的数据写进 cardDB 行尾的“推断说明”。
- [ ] 改了界面：在 **桌面（1280×800）、手机竖屏（390×844）、手机横屏（844×390）** 三种尺寸下看一眼，没有遮挡、出界、文字被挤压换行。
- [ ] 改了 js/css/资源：把 `sw.js` 的 `VERSION` 加一，否则玩家会用到旧缓存。
- [ ] README.md 末尾追加一段“更新：…”说明改了什么、为什么。

## 约定

- 界面文字、注释、提交说明用**中文**。
- 引擎（`js/engine/`）不得访问 DOM；界面只通过 `dispatch(action)` 改局面。
- 随机数只用 `state.prng`（可复现）。
- 技能按卡牌 id 判断：`isId(unit, 'wu_zhou_yu')`；被抑制的单位技能失效（`isId` 已处理）。
- 需要玩家做选择的地方用 `queueChoice`（15 秒超时随机），不要用浏览器 `prompt/confirm`。
- 新样式写在 `css/polish.css` 末尾；持续动画只动 `opacity`/`transform`，手机上尽量关掉（省电）。
- 实体卡数据以**实物/官方卡面为准**；同一张卡有新旧两版时，以后提供的数据为准。

## 想交卡牌设计但不会写代码？

进游戏「工坊」做卡 → 技能能用积木就用积木，不能就写文字并勾“待实现” → 「导入 · 导出」勾选后下载文件 →
在 GitHub 提 Issue 附上文件，或直接发 Pull Request 把卡加进 `js/data/cardDB.js`。
