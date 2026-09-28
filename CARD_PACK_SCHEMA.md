# 自定义卡牌 JSON 格式（供 AI 生成）

把 [示例卡包](examples/custom-cards.json) 交给 AI，让它只输出同格式的 JSON。进入游戏的“自定义卡牌工坊”后，可粘贴到“AI / 高级 JSON 编辑”并点击“校验并应用 JSON”，或导入 `.json` 文件。通过校验后保存在当前浏览器的本地存储；下一局会把每张自定义卡各放入所属势力牌组一次，并保持每个牌组 40 张。导出 JSON 后可在另一台电脑导入。

卡包顶层必须是 `{ "schemaVersion": 1, "cards": [...] }`。单个卡牌可填写：

| 字段 | 规则 |
| --- | --- |
| `id` | 唯一的小写英文 ID，以字母开头，可用数字、`_`、`-`，总长 3–49 |
| `name`、`description` | 卡名与实际效果说明，均必填 |
| `faction` | `WEI` 或 `SHU` |
| `type` | `UNIT`、`TACTIC` 或 `COUNTER` |
| `troopType` | 单位可选 `INFANTRY`、`CAVALRY`、`ARCHER`、`NAVY`、`STRATEGIST` |
| `cost`、`actionCost` | 0–10 的整数 |
| `atk`、`hp` | 单位必填，战力 0–20、生命 1–30；战法/反制可省略 |
| `keywords` | 现有战斗词条的字符串数组，最多 8 个；仅写词条名称不会自动产生全新规则 |
| `audioCue` | `auto`、`none`、`sword`、`fireball`、`footstep`、`cavalry`、`water`、`spell` |
| `abilities` | 最多 8 条，每条含 `trigger`、可选 `conditions`、1–8 个 `effects` |

**触发时机**：`ON_DEPLOY`（部署后）、`ON_PLAY`（战法打出后）、`ON_MOVE`（移动后）、`ON_ATTACK`（攻击结算后）、`ON_DEFEND`（遭攻击结算后）、`ON_KILL`（击杀后）、`ON_DEATH`（阵亡后）、`ON_DAMAGED`（受伤后）、`ON_TURN_START`、`ON_TURN_END`、`ON_ENEMY_ACTION`（仅暗置反制牌，敌方出牌、移动或攻击时触发一次）。

**效果类型**：`DRAW` 抽牌、`STEAL_CARD` 随机偷一张手牌、`DISCARD_RANDOM` 随机弃牌、`GAIN_PRESTIGE` 争取声望、`REMOVE_PRESTIGE` 减少声望、`GAIN_PROVISIONS` 获粮草、`STEAL_PROVISIONS` 偷粮草、`GAIN_CAPACITY` 增加额外粮仓、`DAMAGE_HQ` / `HEAL_HQ` 主城伤害或治疗、`DAMAGE_UNIT` / `HEAL_UNIT` 单位伤害或治疗、`BUFF_ATTACK` / `BUFF_HEALTH` 加战力或生命、`APPLY_SUPPRESSION` / `APPLY_INHIBITION` 压制或抑制、`GRANT_KEYWORD` / `REMOVE_KEYWORD` 授予或移除词条、`REVEAL_UNIT` 翻开潜袭单位、`RESTORE_ACTION` 恢复单位行动。

每个 `effect` 用 `{ "type": "DRAW", "target": "OWNER", "amount": 1 }`。数值为 0–20 的整数；授予/移除词条还须有 `"keyword": "突袭"`。玩家与主城效果的目标选 `OWNER` 或 `OPPONENT`；偷手牌与偷粮草须选 `OPPONENT`。单位效果的目标选 `SELF`、`ATTACKER`、`DEFENDER`、`RANDOM_ENEMY`、`RANDOM_FRIENDLY`、`ALL_ENEMIES`、`ALL_FRIENDLIES`。随机目标使用对局的固定随机数状态，联机双方能保持同步。

可选条件示例：`"conditions": [{ "field": "OWNER_PROVISIONS", "op": "GTE", "value": 3 }]`。字段可用 `OWNER_PROVISIONS`、`OWNER_PRESTIGE`、`ENEMY_PROVISIONS`、`SOURCE_HP`、`TARGET_HP`、`TURN_NUMBER`、`TARGET_DIED`、`SOURCE_SURVIVED`；比较方式为 `EQ`、`GTE`、`LTE`。布尔条件的值用 0 或 1。

编辑器只解析白名单中的数据字段，不执行 JavaScript。每个卡包最多 40 张、每个势力最多 20 张自定义牌。单位攻击后的触发发生在原有伤害结算之后；效果造成的次生阵亡目前不继续触发连锁阵亡技能。导入后的卡牌保存在浏览器中，分享游戏时要同时发送导出的 JSON；游戏压缩包只附带示例卡包，不含你在本机保存的卡牌。
