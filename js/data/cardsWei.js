/**
 * cardsWei.js — Wei Kingdom 32-Card Pool
 * Auto-generated and verified against authoritative specification.
 */

export const WEI_CARDS = Object.freeze([
  {
    "id": "wei_qing_qi_bing",
    "name": "轻骑兵",
    "pinyin": "qing_qi_bing",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 1,
    "action_cost": 1,
    "attack": 2,
    "hp": 1,
    "max_hp": 1,
    "keywords": [
      "突袭"
    ],
    "badges": [],
    "skill": {
      "name": "",
      "trigger": "deploy",
      "description": "【突袭】进场回合可立即行动。",
      "logic": "Unit can move or attack on the turn it is deployed."
    },
    "flavor": "",
    "cardId": "wei_qing_qi_bing",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 1,
    "isDefector": false
  },

  {
    "id": "wei_wei_kun",
    "name": "围困",
    "pinyin": "wei_kun",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 2,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "围困",
      "trigger": "instant",
      "description": "己方每比对手多占领一个前线区域，对手下回合粮草-3。",
      "logic": "Calculate delta = friendly_frontline_zones - enemy_frontline_zones. If delta > 0, apply debuff: enemy total provisions next turn reduced by delta."
    },
    "flavor": "",
    "cardId": "wei_wei_kun",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_tun_tian_zhi",
    "name": "屯田制",
    "pinyin": "tun_tian_zhi",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 2,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "屯田",
      "trigger": "instant",
      "description": "下回合开始，粮草上限+1。",
      "logic": "Register buff to trigger at start of next friendly turn: friendly base provisions cap permanently increases by +1 (up to max 10 natural limit, or expands as extra provisions)."
    },
    "flavor": "",
    "cardId": "wei_tun_tian_zhi",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_li_tong",
    "name": "李通",
    "pinyin": "li_tong",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 2,
    "action_cost": 1,
    "attack": 3,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "先登"
    ],
    "badges": [],
    "skill": {
      "name": "砺战",
      "trigger": "enemy_turn_end",
      "description": "【先登】。砺战：敌方回合结束时若在前线，获得+1+1。",
      "logic": "Has [先登] (attacks deal damage first; immune to counterattack if target killed; ineffective vs ambush/stealth). At enemy turn end, if this unit is located in any frontline zone, increase its attack by +1 and current/max HP by +1."
    },
    "flavor": "",
    "cardId": "wei_li_tong",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 3,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "wei_xun_yu",
    "name": "荀彧",
    "pinyin": "xun_yu",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 4,
    "action_cost": 2,
    "attack": 3,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "奇谋1",
      "声望1"
    ],
    "badges": [
      "名士"
    ],
    "skill": {
      "name": "王佐",
      "trigger": "friendly_turn_end",
      "description": "【奇谋】【声望】。王佐：友方回合结束时，若前线有友方单位，抽1张牌。",
      "logic": "[奇谋]: While in play, friendly tactics cost -1. [声望]: Deploying grants +1 friendly prestige immediately. At friendly turn end, if any friendly unit occupies a frontline zone, draw 1 card."
    },
    "flavor": "",
    "cardId": "wei_xun_yu",
    "faction": "WEI",
    "troopType": "STRATEGIST",
    "actionCost": 2,
    "atk": 3,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_guo_jia",
    "name": "郭嘉",
    "pinyin": "guo_jia",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 4,
    "action_cost": 2,
    "attack": 2,
    "hp": 2,
    "max_hp": 2,
    "keywords": [
      "奇谋1"
    ],
    "badges": [
      "名士"
    ],
    "skill": {
      "name": "鬼才/遗计",
      "trigger": "on_tactic_played / on_defeat",
      "description": "【奇谋】。鬼才：使用战法时，对敌方主城造成2伤害。遗计：战败时从牌堆选择1张战法加入手牌。",
      "logic": "[奇谋]: Friendly tactics cost -1. Whenever friendly player casts a tactic card, deal 2 direct damage to enemy HQ. When defeated in battle (HP <= 0), player searches deck for 1 tactic card to add to hand, then shuffles deck."
    },
    "flavor": "",
    "cardId": "wei_guo_jia",
    "faction": "WEI",
    "troopType": "STRATEGIST",
    "actionCost": 2,
    "atk": 2,
    "maxHp": 2,
    "isDefector": false
  },

  {
    "id": "wei_tian_zi_zhao_ling_1",
    "name": "天子诏令",
    "pinyin": "tian_zi_zhao_ling",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 5,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [
      "声望1"
    ],
    "badges": [],
    "skill": {
      "name": "奉旨",
      "trigger": "instant",
      "description": "【声望1】。己方每有1声望，下回合起粮草上限+1。",
      "logic": "Gain +1 prestige first (per 声望 rule: steal 1 from enemy or gain 1 if enemy has none). Then check current friendly prestige P. At the start of next turn, friendly provisions cap permanently increases by +P."
    },
    "flavor": "",
    "cardId": "wei_tian_zi_zhao_ling_1",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_tian_zi_zhao_ling_2",
    "name": "天子诏令",
    "pinyin": "tian_zi_zhao_ling",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 5,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [
      "声望1"
    ],
    "badges": [],
    "skill": {
      "name": "奉旨",
      "trigger": "instant",
      "description": "【声望1】。己方每有1声望，下回合起粮草上限+1。",
      "logic": "Duplicate card #2 in pool. Same logic as wei_tian_zi_zhao_ling_1."
    },
    "flavor": "",
    "cardId": "wei_tian_zi_zhao_ling_2",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_zang_ba",
    "name": "臧霸",
    "pinyin": "zang_ba",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 2,
    "action_cost": 1,
    "attack": 2,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "先登"
    ],
    "badges": [],
    "skill": {
      "name": "骁勇",
      "trigger": "combat_calculation",
      "description": "【先登】。骁勇：与相同兵种对战时，战力翻倍。",
      "logic": "Has [先登]. During combat calculation against an enemy unit of the same troop type (infantry 步兵), double Zang Ba's attack (from 2 to 4, plus any buffs doubled)."
    },
    "flavor": "",
    "cardId": "wei_zang_ba",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "wei_you_di_shen_ru",
    "name": "诱敌深入",
    "pinyin": "you_di_shen_ru",
    "kingdom": "wei",
    "type": "counter",
    "troop_type": "none",
    "cost": 2,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "诱敌",
      "trigger": "enemy_unit_move",
      "description": "【反制战法】敌军移动时，对其造成3伤害；若其具有狂傲、鲁莽，则造成6伤害。",
      "logic": "Secretly set during friendly turn. Triggers during enemy turn when an enemy unit moves (advances/retreats/shifts). Immediately deals 3 damage to that unit; if target possesses [狂傲] or [鲁莽] trait, deals 6 damage instead. Trigger priority precedes standard action completion."
    },
    "flavor": "",
    "cardId": "wei_you_di_shen_ru",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_jia_kui",
    "name": "贾逵",
    "pinyin": "jia_kui",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 2,
    "action_cost": 1,
    "attack": 1,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "筑城",
      "trigger": "friendly_turn_start",
      "description": "【坚阵1】。筑城：回合开始时，己方主城+1防。",
      "logic": "Has [坚阵1] (combat damage taken reduced by 1). At the start of friendly turn, friendly HQ gains +1 defense / armor buffer."
    },
    "flavor": "",
    "cardId": "wei_jia_kui",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 1,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_cao_hong",
    "name": "曹洪",
    "pinyin": "cao_hong",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 3,
    "action_cost": 1,
    "attack": 3,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "守护"
    ],
    "badges": [],
    "skill": {
      "name": "坚毅",
      "trigger": "passive",
      "description": "【守护】。坚毅：不会被撤退或抑制。",
      "logic": "Has [守护] (protects adjacent non-guardian allies from direct non-strategist attacks). Immune to retreat effects (from spells or unit skills) and cannot be silenced/suppressed by [抑制]."
    },
    "flavor": "天下可无洪，不可无君",
    "cardId": "wei_cao_hong",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 3,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "wei_pang_de",
    "name": "庞德",
    "pinyin": "pang_de",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 5,
    "action_cost": 2,
    "attack": 6,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "突袭",
      "斩将"
    ],
    "badges": [],
    "skill": {
      "name": "誓死",
      "trigger": "passive",
      "description": "【突袭】【斩将】。誓死：不会被撤退或抑制。",
      "logic": "[突袭]: Can act on deploy. [斩将]: When attacking, if self attack > target attack, directly destroy target (ineffective vs ambush/stealth). Immune to retreat and suppressive silence [抑制]."
    },
    "flavor": "",
    "cardId": "wei_pang_de",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 6,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_zhang_he",
    "name": "张郃",
    "pinyin": "zhang_he",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 5,
    "action_cost": 2,
    "attack": 5,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "警戒"
    ],
    "badges": [],
    "skill": {
      "name": "巧变",
      "trigger": "passive",
      "description": "【警戒】。巧变：无视敌军地形增益；自己无视地形负面效果。",
      "logic": "[警戒]: Cannot be targeted by enemy tactics or counter-tactics. Passive: Enemy units do not benefit from defensive or offensive terrain buffs against Zhang He; Zhang He suffers no movement penalties or debuffs from negative terrain."
    },
    "flavor": "",
    "cardId": "wei_zhang_he",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "wei_li_dian",
    "name": "李典",
    "pinyin": "li_dian",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 5,
    "action_cost": 2,
    "attack": 5,
    "hp": 6,
    "max_hp": 6,
    "keywords": [
      "警戒"
    ],
    "badges": [],
    "skill": {
      "name": "长者之风",
      "trigger": "passive",
      "description": "【警戒】。若有1个战力不小于4的友军，己方主城受到伤害-1。",
      "logic": "[警戒]: Cannot be directly targeted by enemy tactics. While Li Dian is in play and there is at least 1 friendly unit with ATK >= 4, all damage dealt to friendly HQ is reduced by 1."
    },
    "flavor": "",
    "cardId": "wei_li_dian",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 6,
    "isDefector": false
  },

  {
    "id": "wei_xu_chu",
    "name": "许褚",
    "pinyin": "xu_chu",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 5,
    "action_cost": 1,
    "attack": 4,
    "hp": 7,
    "max_hp": 7,
    "keywords": [
      "守护"
    ],
    "badges": [],
    "skill": {
      "name": "震慑",
      "trigger": "deploy",
      "description": "【守护】。震慑：进场时，压制1个前线敌军。",
      "logic": "[守护]: Protects adjacent friendly non-guardians. On deployment: choose 1 enemy unit on the frontline and inflict [压制] (target cannot act until the end of its controller's next turn)."
    },
    "flavor": "",
    "cardId": "wei_xu_chu",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 4,
    "maxHp": 7,
    "isDefector": false
  },

  {
    "id": "wei_wang_mei_zhi_ke",
    "name": "望梅止渴",
    "pinyin": "wang_mei_zhi_ke",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 3,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "止渴",
      "trigger": "instant",
      "description": "本回合中，前线己方单位战力+1，行动花费-1。",
      "logic": "Apply turn-long buff to all currently deployed and incoming friendly units in frontline zones: ATK +1 and movement/attack action cost -1 (minimum 0) until the end of current turn."
    },
    "flavor": "",
    "cardId": "wei_wang_mei_zhi_ke",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_man_chong",
    "name": "满宠",
    "pinyin": "man_chong",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 3,
    "action_cost": 1,
    "attack": 2,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "坚阵1",
      "侦查1"
    ],
    "badges": [],
    "skill": {
      "name": "驻防",
      "trigger": "combat_calculation",
      "description": "【坚阵1】【侦查1】。驻防：对抗水军时，+3战力。",
      "logic": "[坚阵1]: Combat damage -1. [侦查1]: Reveals enemy top card / stealth. When engaging in combat against water troops (水军), Man Chong gains +3 ATK during damage calculation."
    },
    "flavor": "",
    "cardId": "wei_man_chong",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_cheng_yu",
    "name": "程昱",
    "pinyin": "cheng_yu",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 3,
    "action_cost": 1,
    "attack": 2,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "奇谋1",
      "侦查1"
    ],
    "badges": [],
    "skill": {
      "name": "捕粮",
      "trigger": "activated_turn",
      "description": "【奇谋】【侦查1】。捕粮：己方回合开始时，若手牌不少于6张，弃置1张最低费手牌，额外获得2粮草。",
      "logic": "[奇谋]: Tactics cost -1. [侦查1]: Vision buff. Activated ability once per friendly turn: player can select and discard 1 card from hand to immediately gain +2 provisions this turn."
    },
    "flavor": "",
    "cardId": "wei_cheng_yu",
    "faction": "WEI",
    "troopType": "STRATEGIST",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_hu_bao_qi",
    "name": "虎豹骑",
    "pinyin": "hu_bao_qi",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 3,
    "action_cost": 1,
    "attack": 4,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "突袭"
    ],
    "badges": [],
    "skill": {
      "name": "",
      "trigger": "deploy",
      "description": "【突袭】进场回合可立即行动。",
      "logic": "Cavalry unit with base 4 ATK / 3 HP. Can act immediately on deployment."
    },
    "flavor": "",
    "cardId": "wei_hu_bao_qi",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 1,
    "atk": 4,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "wei_pi_li_che_1",
    "name": "霹雳车",
    "pinyin": "pi_li_che",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "archer",
    "cost": 5,
    "action_cost": 2,
    "attack": 5,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "矢石"
    ],
    "badges": [],
    "skill": {
      "name": "抛射/攻城",
      "trigger": "attack / combat_kill",
      "description": "【矢石】。抛射：可攻击任意敌方目标。攻城：本单位攻击并消灭1个敌军后，溢出伤害转移给敌方主城。",
      "logic": "[矢石]: Only receives counterattacks from other [矢石] units. [抛射]: Ignores range/line restrictions; can directly attack units on support line or frontline or HQ. [攻城]: If an attack destroys the defending unit, overflow damage (ATK - target HP) is dealt directly to enemy HQ."
    },
    "flavor": "",
    "cardId": "wei_pi_li_che_1",
    "faction": "WEI",
    "troopType": "ARCHER",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_pi_li_che_2",
    "name": "霹雳车",
    "pinyin": "pi_li_che",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "archer",
    "cost": 5,
    "action_cost": 2,
    "attack": 5,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "矢石"
    ],
    "badges": [],
    "skill": {
      "name": "抛射/攻城",
      "trigger": "attack / combat_kill",
      "description": "【矢石】。抛射：可攻击任意敌方目标。攻城：本单位攻击并消灭1个敌军后，溢出伤害转移给敌方主城。",
      "logic": "Duplicate card #2 in pool. Same logic as wei_pi_li_che_1."
    },
    "flavor": "",
    "cardId": "wei_pi_li_che_2",
    "faction": "WEI",
    "troopType": "ARCHER",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_yu_jin",
    "name": "于禁",
    "pinyin": "yu_jin",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 6,
    "action_cost": 2,
    "attack": 4,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "警戒",
      "坚阵1",
      "降将"
    ],
    "badges": [],
    "skill": {
      "name": "毅重",
      "trigger": "aura_continuous",
      "description": "【警戒】【坚阵1】【降将】。毅重：己方场上每有1种单位类型，自己+1+1。",
      "logic": "[警戒]: Untargetable by enemy spells. [坚阵1]: Combat damage -1. [降将]: Can be included in other faction decks; goes to enemy discard pile upon defeat. [毅重]: Counts distinct troop types among all friendly units currently on board (infantry, cavalry, archer/siege, navy, strategist). Yu Jin gains +X/+X where X is the count of distinct troop types."
    },
    "flavor": "",
    "cardId": "wei_yu_jin",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 2,
    "atk": 4,
    "maxHp": 4,
    "isDefector": true
  },

  {
    "id": "wei_xia_hou_yuan",
    "name": "夏侯渊",
    "pinyin": "xia_hou_yuan",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 6,
    "action_cost": 2,
    "attack": 4,
    "hp": 6,
    "max_hp": 6,
    "keywords": [
      "矢石"
    ],
    "badges": [
      "鲁莽"
    ],
    "skill": {
      "name": "虎步",
      "trigger": "after_move",
      "description": "【矢石】。虎步：每次移动后战力+1。",
      "logic": "[矢石]: Only counterattacked by [矢石] units. Has badge [鲁莽] (reckless). Each time Xiahou Yuan completes a movement action (advance, retreat, or flank between frontline zones), his ATK increases permanently by +1."
    },
    "flavor": "",
    "cardId": "wei_xia_hou_yuan",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 4,
    "maxHp": 6,
    "isDefector": false
  },

  {
    "id": "wei_hong_men_yan",
    "name": "鸿门宴",
    "pinyin": "hong_men_yan",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 3,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "设局",
      "trigger": "instant",
      "description": "对1个敌军造成2伤害，若其在后援阵线伤害翻倍。",
      "logic": "Target 1 enemy unit anywhere on board. If target is in frontline zone, deal 2 damage. If target is on the enemy support line (后援阵线), double damage to 4."
    },
    "flavor": "",
    "cardId": "wei_hong_men_yan",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_xu_huang",
    "name": "徐晃",
    "pinyin": "xu_huang",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 4,
    "action_cost": 2,
    "attack": 3,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "奋战"
    ],
    "badges": [],
    "skill": {
      "name": "劫粮",
      "trigger": "combat_kill",
      "description": "【奋战】。劫粮：击败敌军时，使敌人损失等同于溢出伤害的粮草。",
      "logic": "[奋战]: Can attack twice per turn. When Xu Huang's attack kills an enemy unit, calculate overflow damage (Xu Huang ATK - target remaining HP). The enemy player loses provisions equal to the overflow damage (deducted from current provisions, minimum 0)."
    },
    "flavor": "",
    "cardId": "wei_xu_huang",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 3,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "wei_wen_pin",
    "name": "文聘",
    "pinyin": "wen_pin",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "navy",
    "cost": 4,
    "action_cost": 2,
    "attack": 3,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "镇守",
      "trigger": "deal_damage",
      "description": "【坚阵1】。镇守：压制任何受到其伤害的敌军。",
      "logic": "[坚阵1]: Combat damage -1. Troop type: 水 (Navy - acts as cavalry on water terrain, infantry elsewhere). Whenever Wen Pin deals damage (attack or counterattack) to an enemy unit, apply [压制] to that unit (cannot act until end of its controller's next turn)."
    },
    "flavor": "",
    "cardId": "wei_wen_pin",
    "faction": "WEI",
    "troopType": "NAVY",
    "actionCost": 2,
    "atk": 3,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "wei_ce_fan",
    "name": "策反",
    "pinyin": "ce_fan",
    "kingdom": "wei",
    "type": "tactic",
    "troop_type": "none",
    "cost": 4,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "倒戈",
      "trigger": "instant",
      "description": "控制1个花费不大于3或具有二动的敌军，至回合结束；若己方声望更高则永久控制。",
      "logic": "Target 1 enemy unit satisfying: deployment cost <= 3 OR possesses double-action trait (such as cavalry mobility move+attack, or [奋战]). Take control of target unit. If friendly prestige > enemy prestige at time of resolution, control is permanent. Otherwise, control reverts at the end of the current turn."
    },
    "flavor": "",
    "cardId": "wei_ce_fan",
    "faction": "WEI",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "wei_cao_cao",
    "name": "曹操",
    "pinyin": "cao_cao",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 6,
    "action_cost": 1,
    "attack": 6,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "治军",
      "督战",
      "声望1"
    ],
    "badges": [
      "名士",
      "暴虐"
    ],
    "skill": {
      "name": "归心",
      "trigger": "unit_destroyed",
      "description": "【治军】【督战】【声望】。归心：每当有敌军被消灭时，摸1张牌。",
      "logic": "[治军]: Other friendly units of the same troop type (infantry) have action cost -1. [督战]: Adjacent friendly military units gain +1 ATK. [声望]: Deploying grants +1 prestige. Whenever any enemy unit is eliminated (by combat, tactic, or overflow), draw 1 card (requires Cao Cao to survive the combat sequence per rulebook §番外2)."
    },
    "flavor": "",
    "cardId": "wei_cao_cao",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 6,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "wei_cao_ren",
    "name": "曹仁",
    "pinyin": "cao_ren",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 7,
    "action_cost": 2,
    "attack": 5,
    "hp": 7,
    "max_hp": 7,
    "keywords": [
      "守护",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "铁壁",
      "trigger": "passive",
      "description": "【守护】【坚阵1】。铁壁：免疫先登、冲阵、斩将。",
      "logic": "[守护]: Protects adjacent friendly non-guardians. [坚阵1]: Combat damage -1. [铁壁]: Enemy units attacking Cao Ren cannot benefit from [先登] (Cao Ren always deals counterattack simultaneously), [冲阵] (attacker receives counterattack), or [斩将] (cannot be directly executed; normal damage calculation applies)."
    },
    "flavor": "吾军真天人也",
    "cardId": "wei_cao_ren",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 7,
    "isDefector": false
  },

  {
    "id": "wei_xia_hou_dun",
    "name": "夏侯惇",
    "pinyin": "xia_hou_dun",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 8,
    "action_cost": 3,
    "attack": 8,
    "hp": 8,
    "max_hp": 8,
    "keywords": [
      "治军",
      "声望1"
    ],
    "badges": [],
    "skill": {
      "name": "摄众",
      "trigger": "aura_continuous",
      "description": "【治军】【声望】。摄众：所在区域己方单位无法被压制。",
      "logic": "[治军]: Other friendly infantry action cost -1. [声望]: Deploy grants +1 prestige. Aura: Friendly units located in the same battle line / zone as Xiahou Dun are immune to [压制] (any existing suppression is cleared and new suppression cannot be applied)."
    },
    "flavor": "",
    "cardId": "wei_xia_hou_dun",
    "faction": "WEI",
    "troopType": "INFANTRY",
    "actionCost": 3,
    "atk": 8,
    "maxHp": 8,
    "isDefector": false
  },

  {
    "id": "wei_zhang_liao",
    "name": "张辽",
    "pinyin": "zhang_liao",
    "kingdom": "wei",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 8,
    "action_cost": 3,
    "attack": 8,
    "hp": 7,
    "max_hp": 7,
    "keywords": [
      "突袭",
      "先登"
    ],
    "badges": [],
    "skill": {
      "name": "劫虑",
      "trigger": "attack_hq",
      "description": "【突袭】【先登】。劫虑：攻击敌方主城时，随机弃掉对手1张手牌。",
      "logic": "[突袭]: Can act on deploy. [先登]: Preemptive strike on battle. When Zhang Liao declares an attack on the enemy HQ (主城), randomly choose 1 card from opponent's hand and discard it to their graveyard."
    },
    "flavor": "",
    "cardId": "wei_zhang_liao",
    "faction": "WEI",
    "troopType": "CAVALRY",
    "actionCost": 3,
    "atk": 8,
    "maxHp": 7,
    "isDefector": false
  }
]);

const baseMap = Object.fromEntries(WEI_CARDS.map(card => [card.id, card]));
if (baseMap['wei_pi_li_che_1']) baseMap['wei_pi_li_che'] = baseMap['wei_pi_li_che_1'];
if (baseMap['wei_tian_zi_zhao_ling_1']) baseMap['wei_tian_zi_zhao_ling'] = baseMap['wei_tian_zi_zhao_ling_1'];

export const WEI_CARD_MAP = Object.freeze(baseMap);
export const CARD_MAP = WEI_CARD_MAP;

export default WEI_CARDS;
