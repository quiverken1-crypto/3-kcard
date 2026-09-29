# 自定义卡包格式（schemaVersion 2）

游戏内「工坊 → 导入 · 导出」生成和读取的就是这种 JSON；卡包码 `SGKP1-…` 是同一份 JSON 压缩后的文本。
也可以在浏览器控制台用 `SGK.content.importPack(pack)` 导入。旧版 `schemaVersion: 1` 仍可导入（自动转换）。

```jsonc
{
  "schemaVersion": 2,
  "factions": [                                   // 可选：自定义势力
    { "key": "f_jin", "name": "晋", "army": "晋军", "color": "#5b6b8a",
      "hqs": [ { "id": "f_jin_hq1", "name": "洛阳", "terrains": ["PLAIN", "FOREST"] } ] }
  ],
  "cards": [
    {
      "id": "c_sima_yi",                 // 小写字母开头，字母/数字/下划线，3–41 位；不能与官方卡重复
      "name": "司马懿",                  // ≤12 字
      "kingdom": "f_jin",                // wei / shu / wu / lb / gsz 或自定义势力 key
      "type": "UNIT",                    // UNIT 单位 / TACTIC 战法 / COUNTER 反制
      "troopType": "STRATEGIST",         // INFANTRY 步兵 / CAVALRY 骑兵 / NAVY 水军 / STRATEGIST 谋士 / ARCHER 器械
      "cost": 5, "actionCost": 2, "atk": 3, "hp": 5,
      "copies": 1,                       // 卡组中最多几张（1–3）
      "keywords": ["帷幄", "鹰视"],       // 内置词条或自定义词条名
      "badges": ["名士"],                 // 性格
      "customKeywords": [ { "name": "鹰视", "description": "进场时查看对方手牌" } ],
      "skill": { "name": "鹰视狼顾", "description": "卡面上显示的技能文字" },
      "pending": false,                  // true = 技能只有文字，等开发者实现
      "abilities": [ /* 积木技能，见下 */ ]
    }
  ]
}
```

地形：`PLAIN` 平原、`WATER` 水域、`FOREST` 林地、`MOUNTAIN` 山地、`PASS` 险关。

## 积木技能 abilities

每条：`{ "trigger": 时机, "conditions": [条件], "effects": [效果] }`；主动技另有 `cost / chance / limit`。
完整的中文目录在 `js/engine/abilities.js`（`TRIGGER_CATALOG / EFFECT_CATALOG / TARGET_CATALOG / FILTER_CATALOG / CONDITION_CATALOG`）。

**时机 trigger**
`ON_DEPLOY` 进场、`ON_PLAY` 打出（战法/反制）、`ON_DEATH` 阵亡、`ON_ATTACK` 攻击后、`ON_DEFEND` 被攻击后、`ON_KILL` 击败敌军、
`ON_DAMAGED` 受伤、`ON_MOVE` 移动后、`ON_TURN_START` / `ON_TURN_END`、`ON_ALLY_DEPLOY` 其他友军进场、`ON_ALLY_DEATH` 友军阵亡、
`ON_ENEMY_DEPLOY` 敌军进场、`ON_ENEMY_ACTION` 敌方行动（反制）、`AURA` 在场时持续、`ACTIVE` 主动技。

**效果 effects[i]** `{ "type", "target", "amount", "keyword"?, "filter"? }`

| 分类 | type |
| --- | --- |
| 资源（目标 OWNER/OPPONENT） | `DRAW` `GAIN_PROVISIONS` `STEAL_PROVISIONS` `GAIN_CAPACITY` `GAIN_PRESTIGE` `REMOVE_PRESTIGE` `DISCARD_RANDOM` `STEAL_CARD` |
| 检索 | `SEARCH_DECK`（filter.cardType / filter.troop） |
| 主城 | `DAMAGE_HQ` `HEAL_HQ` |
| 数值（单位） | `DAMAGE_UNIT` `HEAL_UNIT` `BUFF_ATTACK` `DEBUFF_ATTACK` `TURN_ATTACK`(到回合结束) `BUFF_HEALTH` `ACTION_COST_DOWN` `ACTION_COST_UP` |
| 状态 | `APPLY_SUPPRESSION` `APPLY_INHIBITION` `REVEAL_UNIT` `RESTORE_ACTION` |
| 词条（需 keyword） | `GRANT_KEYWORD` `TURN_KEYWORD`(到回合结束) `REMOVE_KEYWORD` |
| 位置 | `RETREAT` `RETURN_HAND` `DESTROY` |

**目标 target**：玩家 `OWNER` `OPPONENT`；单个 `SELF` `ATTACKER` `DEFENDER` `TRIGGER_UNIT` `CHOSEN_ENEMY` `CHOSEN_FRIENDLY`（玩家选，15 秒超时随机）
`RANDOM_ENEMY` `RANDOM_FRIENDLY` `WEAKEST_ENEMY` `STRONGEST_ENEMY`；群体 `ALL_ENEMIES` `ALL_FRIENDLIES` `OTHER_FRIENDLIES` `SAME_ZONE_FRIENDLIES` `NEARBY_ENEMIES`。

**筛选 filter**：`{ "troop": "CAVALRY", "line": "FRONTLINE"|"SUPPORT", "badge": "狂傲", "keyword": "冲阵", "cardType": "TACTIC" }`

**条件 conditions[i]**：`{ "field", "op": "GTE"|"LTE"|"EQ", "value" }`，field：`OWNER_PROVISIONS` `ENEMY_PROVISIONS` `OWNER_PRESTIGE` `ENEMY_PRESTIGE`
`OWNER_HAND` `OWNER_UNITS` `ENEMY_UNITS` `OWNER_HQ_HP` `ENEMY_HQ_HP` `SOURCE_HP` `SOURCE_IN_FRONTLINE` `TARGET_HP` `TARGET_DIED` `SOURCE_SURVIVED` `TURN_NUMBER`。

**光环 AURA**：只支持 `BUFF_ATTACK` `DEBUFF_ATTACK` `ACTION_COST_DOWN` `ACTION_COST_UP`，目标 `SELF` `ALL_FRIENDLIES` `OTHER_FRIENDLIES` `ALL_ENEMIES`，可加筛选。例：己方骑兵战力+1。

**主动技 ACTIVE**：消耗 → 判定 → 获得。
`"cost": { "type": "NONE"|"PROVISIONS"|"DISCARD"|"SELF_DAMAGE"|"HQ_HP"|"PRESTIGE"|"ACTION", "amount": 2 }`，
`"chance": 1–100`（判定成功率，默认 100），`"limit": "TURN"|"GAME"`。同一张卡的多条 ACTIVE 合并为一个技能，消耗与判定以第一条为准。

## 例子

```json
{ "trigger": "AURA", "effects": [ { "type": "BUFF_ATTACK", "target": "ALL_FRIENDLIES", "amount": 1, "filter": { "troop": "CAVALRY" } } ] }
{ "trigger": "ON_DEPLOY", "effects": [ { "type": "DAMAGE_UNIT", "target": "CHOSEN_ENEMY", "amount": 2 } ] }
{ "trigger": "ACTIVE", "cost": { "type": "PROVISIONS", "amount": 2 }, "chance": 50, "limit": "TURN",
  "effects": [ { "type": "DRAW", "target": "OWNER", "amount": 2 } ] }
```
