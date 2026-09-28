/**
 * cardsShu.js — Shu Kingdom 32-Card Pool
 * Auto-generated and verified against authoritative specification.
 */

export const SHU_CARDS = Object.freeze([
  {
    "id": "shu_mi_fang",
    "name": "糜芳",
    "pinyin": "mi_fang",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 1,
    "action_cost": 1,
    "attack": 1,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "降将"
    ],
    "badges": [
      "二心"
    ],
    "skill": {
      "name": "",
      "trigger": "passive",
      "description": "【降将】可组入其他势力的牌组；被击败后进入敌方弃牌区。",
      "logic": "Surrendered general card: may be teched into non-Shu decks. When defeated, goes into opponent's discard pile rather than owner's."
    },
    "flavor": "",
    "cardId": "shu_mi_fang",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 1,
    "maxHp": 4,
    "isDefector": true
  },

  {
    "id": "shu_zha_bai",
    "name": "诈败",
    "pinyin": "zha_bai",
    "kingdom": "shu",
    "type": "tactic",
    "troop_type": "none",
    "cost": 1,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "退避",
      "trigger": "instant",
      "description": "使1个前线友军撤退，移除所有伤害，本回合该单位可再次行动。",
      "logic": "Target 1 friendly unit in the frontline. Move it back to the friendly support line (or hand if support line full). Clear all damage counters on it (restoring to current max HP). Reset its turn action flag so it may move/attack again this turn."
    },
    "flavor": "",
    "cardId": "shu_zha_bai",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_chong_zheng_qi_gu",
    "name": "重整旗鼓",
    "pinyin": "chong_zheng_qi_gu",
    "kingdom": "shu",
    "type": "tactic",
    "troop_type": "none",
    "cost": 1,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "整军",
      "trigger": "instant",
      "description": "将1张己方弃牌区单位加入手牌。",
      "logic": "Select 1 unit card from friendly discard pile and return it to hand."
    },
    "flavor": "",
    "cardId": "shu_chong_zheng_qi_gu",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_liao_hua",
    "name": "廖化",
    "pinyin": "liao_hua",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 2,
    "action_cost": 1,
    "attack": 2,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "突袭"
    ],
    "badges": [],
    "skill": {
      "name": "先锋/诈死",
      "trigger": "move_to_frontline / on_defeat",
      "description": "【突袭】。先锋：移至前线时，获得+1+1。诈死：被击败后洗回牌堆。",
      "logic": "[突袭]: Can act immediately. When Liao Hua moves from support line to any frontline zone, gain +1/+1 permanently. When defeated in battle (HP <= 0), instead of going to graveyard, shuffle Liao Hua into owner's deck."
    },
    "flavor": "",
    "cardId": "shu_liao_hua",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_deng_zhi",
    "name": "邓芝",
    "pinyin": "deng_zhi",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 3,
    "action_cost": 1,
    "attack": 1,
    "hp": 4,
    "max_hp": 4,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "使节",
      "trigger": "aura_continuous",
      "description": "使节：在场时，己方总部免受伤害。",
      "logic": "Aura: While Deng Zhi is alive on the battlefield, friendly HQ (主城/总部) is completely immune to all sources of damage (direct attacks, tactic damage, siege overflow). If Deng Zhi dies simultaneously during a multi-target resolution, protection expires during that step per rulebook §番外2."
    },
    "flavor": "",
    "cardId": "shu_deng_zhi",
    "faction": "SHU",
    "troopType": "STRATEGIST",
    "actionCost": 1,
    "atk": 1,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "shu_liu_bei",
    "name": "刘备",
    "pinyin": "liu_bei",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 4,
    "action_cost": 1,
    "attack": 2,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "督战",
      "声望1"
    ],
    "badges": [
      "皇亲"
    ],
    "skill": {
      "name": "枭雄",
      "trigger": "combat_survive / on_defeat",
      "description": "【督战】【声望】。枭雄：每次交战并存活后，+2战力；被击败后返回牌堆顶。",
      "logic": "[督战]: Adjacent friendly military units +1 ATK. [声望]: Deploy grants +1 prestige. After engaging in combat (attack or counterattack), if Liu Bei survives, his ATK permanently increases by +2. When Liu Bei is defeated (HP <= 0), place him onto the top of owner's draw deck."
    },
    "flavor": "",
    "cardId": "shu_liu_bei",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "shu_chuan_xi_zhi_ji",
    "name": "喘息之机",
    "pinyin": "chuan_xi_zhi_ji",
    "kingdom": "shu",
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
      "name": "修整",
      "trigger": "instant",
      "description": "所有友方单位完全恢复，每实际恢复1个单位，抽1张牌。",
      "logic": "Examine all friendly units on board. For each unit whose current HP < max HP, restore current HP to max HP. Count the number of units that actually healed >= 1 HP. Draw that many cards from deck."
    },
    "flavor": "",
    "cardId": "shu_chuan_xi_zhi_ji",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_sheng_dong_ji_xi",
    "name": "声东击西",
    "pinyin": "sheng_dong_ji_xi",
    "kingdom": "shu",
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
      "name": "奇策",
      "trigger": "instant",
      "description": "选择手上1张单位，将其与场上1个友军交换。",
      "logic": "Choose 1 unit card in hand and 1 friendly unit deployed on the battlefield. Swap them: the deployed unit returns to hand (retaining its base stats, clearing temporary buffs/damage), and the unit card from hand is placed into that exact board position without paying deployment cost (does not trigger deploy effects unless specified)."
    },
    "flavor": "",
    "cardId": "shu_sheng_dong_ji_xi",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_xu_jing",
    "name": "许靖",
    "pinyin": "xu_jing",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 2,
    "action_cost": 2,
    "attack": 1,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "幕僚",
      "声望1"
    ],
    "badges": [
      "名士"
    ],
    "skill": {
      "name": "清议",
      "trigger": "deploy",
      "description": "【幕僚】【声望】。",
      "logic": "[幕僚]: Strategist troop traits apply (full-map targeting, priority on enemy strategists, ignores guards). [声望]: Deploy immediately gains +1 prestige."
    },
    "flavor": "",
    "cardId": "shu_xu_jing",
    "faction": "SHU",
    "troopType": "STRATEGIST",
    "actionCost": 2,
    "atk": 1,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_bai_er_jun",
    "name": "白毦军",
    "pinyin": "bai_er_jun",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 2,
    "action_cost": 1,
    "attack": 1,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "护卫",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "断后",
      "trigger": "after_move",
      "description": "【护卫】【坚阵1】。断后：移动时，若目标区域已被友军占满，可与其中1名友军换位。",
      "logic": "[护卫/守护]: Protects adjacent friendly allies. [坚阵1]: Combat damage -1. When moving to an adjacent zone or slot occupied by a friendly unit, may swap positions with that friendly unit instead of requiring an empty slot."
    },
    "flavor": "",
    "cardId": "shu_bai_er_jun",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 1,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_mi_zhu",
    "name": "糜竺",
    "pinyin": "mi_zhu",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 2,
    "action_cost": 1,
    "attack": 0,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "补给",
      "幕僚"
    ],
    "badges": [],
    "skill": {
      "name": "资财",
      "trigger": "aura_continuous",
      "description": "【补给】【幕僚】在场时，己方粮草上限额外+1，可叠加。",
      "logic": "[补给]: While on the battlefield, friendly maximum provisions cap increases by +1 (stacks with other supply sources). [幕僚]: Strategist classification."
    },
    "flavor": "",
    "cardId": "shu_mi_zhu",
    "faction": "SHU",
    "troopType": "STRATEGIST",
    "actionCost": 1,
    "atk": 0,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "shu_lian_nu_ying",
    "name": "连弩营",
    "pinyin": "lian_nu_ying",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 2,
    "action_cost": 1,
    "attack": 2,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "矢石",
      "奋战"
    ],
    "badges": [],
    "skill": {
      "name": "掩射",
      "trigger": "deploy",
      "description": "【矢石】【奋战】。掩射：进场时，若敌方有突袭单位，自己获得突袭。",
      "logic": "[矢石]: Only counterattacked by [矢石]. [奋战]: Can attack twice per turn. On deployment: if the enemy player controls any unit with the [突袭] keyword anywhere on board, Lian Nu Ying immediately gains [突袭] this turn."
    },
    "flavor": "",
    "cardId": "shu_lian_nu_ying",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_fa_zheng",
    "name": "法正",
    "pinyin": "fa_zheng",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 4,
    "action_cost": 2,
    "attack": 3,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "奇谋1"
    ],
    "badges": [
      "名士"
    ],
    "skill": {
      "name": "谋主",
      "trigger": "on_friendly_tactic",
      "description": "【奇谋】。谋主：己方使用战法时，使1友方单位+1+1。",
      "logic": "[奇谋]: Friendly tactics cost -1. Whenever friendly player plays a tactic card, choose 1 friendly unit on the battlefield to receive +1 ATK and +1 max/current HP."
    },
    "flavor": "孝直德称",
    "cardId": "shu_fa_zheng",
    "faction": "SHU",
    "troopType": "STRATEGIST",
    "actionCost": 2,
    "atk": 3,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_lian_nu_lian_she",
    "name": "连弩迭射",
    "pinyin": "lian_nu_lian_she",
    "kingdom": "shu",
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
      "name": "齐射",
      "trigger": "instant",
      "description": "对所有敌军造成1点伤害，若有单位被消灭，重复此效果。",
      "logic": "Deal 1 damage to every enemy unit currently on the battlefield. If at least 1 enemy unit is eliminated by this wave, repeat the effect (deal 1 damage to all surviving enemies). Loop terminates when a wave causes no deaths or no enemies remain."
    },
    "flavor": "",
    "cardId": "shu_lian_nu_lian_she",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_ma_dai",
    "name": "马岱",
    "pinyin": "ma_dai",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 4,
    "action_cost": 2,
    "attack": 4,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "突袭",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "铁骑",
      "trigger": "passive_attack",
      "description": "【突袭】【坚阵1】。铁骑：攻击时无视【守护】。",
      "logic": "[突袭]: Can act on deploy. [坚阵1]: Combat damage -1. When declaring an attack, Ma Dai can bypass enemy units with [守护] and directly target any valid enemy in that line/zone."
    },
    "flavor": "",
    "cardId": "shu_ma_dai",
    "faction": "SHU",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 4,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_zhu_ge_liang",
    "name": "诸葛亮",
    "pinyin": "zhu_ge_liang",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 5,
    "action_cost": 2,
    "attack": 3,
    "hp": 6,
    "max_hp": 6,
    "keywords": [
      "治军",
      "声望1",
      "警戒"
    ],
    "badges": [
      "名士"
    ],
    "skill": {
      "name": "料敌",
      "trigger": "enemy_tactic_played",
      "description": "【治军】【声望】【警戒】。料敌：敌方使用战法时，对其主城造成等同于其花费的伤害。",
      "logic": "[治军]: Other friendly strategists action cost -1. [声望]: Deploy grants +1 prestige. [警戒]: Untargetable by enemy spells. Whenever the opponent plays a tactic card, deal direct damage to the opponent's HQ equal to the original provisions cost paid for that tactic."
    },
    "flavor": "鞠躬尽瘁，死而后已",
    "cardId": "shu_zhu_ge_liang",
    "faction": "SHU",
    "troopType": "STRATEGIST",
    "actionCost": 2,
    "atk": 3,
    "maxHp": 6,
    "isDefector": false
  },

  {
    "id": "shu_fa_shi_che",
    "name": "发石车",
    "pinyin": "fa_shi_che",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "archer",
    "cost": 3,
    "action_cost": 1,
    "attack": 2,
    "hp": 2,
    "max_hp": 2,
    "keywords": [
      "矢石"
    ],
    "badges": [],
    "skill": {
      "name": "抛射/掩护",
      "trigger": "passive",
      "description": "【矢石】。抛射：可攻击任意敌方目标。掩护：若前线有友方单位，获得+1+1。",
      "logic": "[矢石]: Only counterattacked by [矢石]. [抛射]: Can attack targets in any zone/line. While at least 1 friendly unit occupies a frontline zone, Fa Shi Che receives an ongoing buff of +1 ATK and +1 HP."
    },
    "flavor": "",
    "cardId": "shu_fa_shi_che",
    "faction": "SHU",
    "troopType": "ARCHER",
    "actionCost": 1,
    "atk": 2,
    "maxHp": 2,
    "isDefector": false
  },

  {
    "id": "shu_liu_feng",
    "name": "刘封",
    "pinyin": "liu_feng",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 3,
    "action_cost": 1,
    "attack": 4,
    "hp": 4,
    "max_hp": 4,
    "keywords": [
      "突袭"
    ],
    "badges": [
      "狂傲"
    ],
    "skill": {
      "name": "迟误",
      "trigger": "friendly_unit_killed",
      "description": "【突袭】。迟误：每当有友军被击败时，自己撤退。",
      "logic": "[突袭]: Can act on deploy. Has badge [狂傲] (trigger for counters like 诱敌深入). Whenever any other friendly unit is killed/defeated, Liu Feng is forced to [撤退] (retreats back to friendly support line, or hand if support line full)."
    },
    "flavor": "",
    "cardId": "shu_liu_feng",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 4,
    "maxHp": 4,
    "isDefector": false
  },

  {
    "id": "shu_xu_shu",
    "name": "徐庶",
    "pinyin": "xu_shu",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "strategist",
    "cost": 3,
    "action_cost": 2,
    "attack": 2,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "奇谋1",
      "降将"
    ],
    "badges": [],
    "skill": {
      "name": "举荐",
      "trigger": "deploy",
      "description": "【奇谋】【降将】。举荐：进场时，抽1张牌。",
      "logic": "[奇谋]: Tactics cost -1. [降将]: Can be teched into other faction decks; goes to enemy discard when killed. On deployment: immediately draw 1 card from deck."
    },
    "flavor": "",
    "cardId": "shu_xu_shu",
    "faction": "SHU",
    "troopType": "STRATEGIST",
    "actionCost": 2,
    "atk": 2,
    "maxHp": 3,
    "isDefector": true
  },

  {
    "id": "shu_wu_dang_fei_jun_1",
    "name": "无当飞军",
    "pinyin": "wu_dang_fei_jun",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 3,
    "action_cost": 1,
    "attack": 3,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "矢石",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "山地精锐",
      "trigger": "passive_terrain",
      "description": "【矢石】【坚阵1】。在山地时，行动花费-1。",
      "logic": "[矢石]: Only counterattacked by [矢石]. [坚阵1]: Combat damage -1. While stationed in a frontline zone with mountain terrain (山地), action cost to attack or move is reduced by 1 (down to 0)."
    },
    "flavor": "",
    "cardId": "shu_wu_dang_fei_jun_1",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 3,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_long_zhong_dui",
    "name": "隆中对",
    "pinyin": "long_zhong_dui",
    "kingdom": "shu",
    "type": "tactic",
    "troop_type": "none",
    "cost": 5,
    "action_cost": 0,
    "attack": 0,
    "hp": 0,
    "max_hp": 0,
    "keywords": [],
    "badges": [],
    "skill": {
      "name": "天下三分",
      "trigger": "instant",
      "description": "己方每占领1个前线区域，抽1张牌、粮草上限+1。",
      "logic": "Count the number of frontline zones controlled by friendly player (0, 1, 2, or 3). Draw that many cards, and permanently increase friendly provisions cap by that amount."
    },
    "flavor": "",
    "cardId": "shu_long_zhong_dui",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_chen_dao",
    "name": "陈到",
    "pinyin": "chen_dao",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 5,
    "action_cost": 1,
    "attack": 3,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "护卫",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "白毦统领",
      "trigger": "deploy",
      "description": "【护卫】【坚阵1】。白毦统领：进场时，从备用区将1张【白毦军】加入支援阵线。",
      "logic": "[护卫/守护]: Protects adjacent friendly units. [坚阵1]: Combat damage -1. On deployment: take 1 copy of [白毦军] from the extra/reserve card pool (备用卡区) and summon it directly onto an available slot in the friendly support line."
    },
    "flavor": "",
    "cardId": "shu_chen_dao",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 3,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "shu_zhao_yun",
    "name": "赵云",
    "pinyin": "zhao_yun",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 6,
    "action_cost": 2,
    "attack": 5,
    "hp": 8,
    "max_hp": 8,
    "keywords": [
      "冲阵",
      "守护"
    ],
    "badges": [],
    "skill": {
      "name": "突围",
      "trigger": "kill_enemy",
      "description": "【冲阵】【守护】。突围：每次击败敌军后，获得【冲阵】。",
      "logic": "[守护]: Protects adjacent friendly non-guardians. [冲阵]: First attack against an enemy receives no counterattack, then loses [冲阵]. Whenever Zhao Yun destroys an enemy unit in combat, re-acquire the [冲阵] keyword (allowing another counter-free attack)."
    },
    "flavor": "",
    "cardId": "shu_zhao_yun",
    "faction": "SHU",
    "troopType": "CAVALRY",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 8,
    "isDefector": false
  },

  {
    "id": "shu_wei_yan",
    "name": "魏延",
    "pinyin": "wei_yan",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 6,
    "action_cost": 2,
    "attack": 6,
    "hp": 5,
    "max_hp": 5,
    "keywords": [
      "奇袭"
    ],
    "badges": [
      "狂傲"
    ],
    "skill": {
      "name": "破军",
      "trigger": "after_attack",
      "description": "【奇袭】。破军：每次攻击后，获得+2+2。",
      "logic": "[奇袭]: On deployment, can be deployed directly into an unoccupied frontline zone (no enemy units present). Has badge [狂傲]. Whenever Wei Yan completes an attack action, he gains +2 ATK and +2 max/current HP."
    },
    "flavor": "偏将十万之众至，请为大王吞之",
    "cardId": "shu_wei_yan",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 2,
    "atk": 6,
    "maxHp": 5,
    "isDefector": false
  },

  {
    "id": "shu_wu_dang_fei_jun_2",
    "name": "无当飞军",
    "pinyin": "wu_dang_fei_jun",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 3,
    "action_cost": 1,
    "attack": 3,
    "hp": 3,
    "max_hp": 3,
    "keywords": [
      "矢石",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "山地精锐",
      "trigger": "passive_terrain",
      "description": "【矢石】【坚阵1】。在山地时，行动花费-1。",
      "logic": "Duplicate card #2 in pool. Same logic as shu_wu_dang_fei_jun_1."
    },
    "flavor": "",
    "cardId": "shu_wu_dang_fei_jun_2",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 1,
    "atk": 3,
    "maxHp": 3,
    "isDefector": false
  },

  {
    "id": "shu_shu_si_yi_zhan",
    "name": "殊死一战",
    "pinyin": "shu_si_yi_zhan",
    "kingdom": "shu",
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
      "name": "决死",
      "trigger": "instant",
      "description": "使己方所有军队的战力与其防御力互换，直到回合结束。",
      "logic": "Target all friendly military units (军队: infantry, cavalry, navy; does not affect strategists 谋士 per rulebook terminology). For each unit, swap its current Attack and current HP values until the end of turn."
    },
    "flavor": "",
    "cardId": "shu_shu_si_yi_zhan",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_huo_gong",
    "name": "火攻",
    "pinyin": "huo_gong",
    "kingdom": "shu",
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
      "name": "烈焰",
      "trigger": "instant",
      "description": "对1个前线敌军造成3火伤害，若将其击败，则对其1个相邻单位重复上述效果。",
      "logic": "Target 1 frontline enemy unit and deal 3 fire damage (triggers [火攻] chaining rule from rulebook §攻击词条: ignores [坚阵]; if target killed, deals 3 damage to an adjacent unit, continuing until no adjacent target or target survives)."
    },
    "flavor": "",
    "cardId": "shu_huo_gong",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_hao_jie_gui_xin",
    "name": "豪杰归心",
    "pinyin": "hao_jie_gui_xin",
    "kingdom": "shu",
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
      "name": "聚义",
      "trigger": "instant",
      "description": "摸3+己方【声望】张牌，选择其中至多2张单位牌加入手中，其余弃置。",
      "logic": "Reveal top N cards from deck, where N = 3 + friendly current prestige. Player selects up to 2 unit cards among them to put into hand; all remaining revealed cards are placed into the discard pile."
    },
    "flavor": "",
    "cardId": "shu_hao_jie_gui_xin",
    "faction": "SHU",
    "troopType": "NONE",
    "actionCost": 0,
    "atk": 0,
    "maxHp": 0,
    "isDefector": false
  },

  {
    "id": "shu_huang_zhong",
    "name": "黄忠",
    "pinyin": "huang_zhong",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 6,
    "action_cost": 2,
    "attack": 5,
    "hp": 6,
    "max_hp": 6,
    "keywords": [
      "突袭",
      "矢石"
    ],
    "badges": [],
    "skill": {
      "name": "狙击",
      "trigger": "passive_terrain",
      "description": "【突袭】【矢石】。狙击：在山地时战力+2并获得【先登】。",
      "logic": "[突袭]: Can act on deploy. [矢石]: Only counterattacked by [矢石]. While in a frontline zone with mountain terrain (山地), Huang Zhong gains +2 ATK and acquires [先登] (preemptive strike; no counterattack if target killed)."
    },
    "flavor": "",
    "cardId": "shu_huang_zhong",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 2,
    "atk": 5,
    "maxHp": 6,
    "isDefector": false
  },

  {
    "id": "shu_zhang_fei",
    "name": "张飞",
    "pinyin": "zhang_fei",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "infantry",
    "cost": 7,
    "action_cost": 2,
    "attack": 7,
    "hp": 7,
    "max_hp": 7,
    "keywords": [
      "突袭",
      "奋战"
    ],
    "badges": [
      "鲁莽"
    ],
    "skill": {
      "name": "大喝",
      "trigger": "deploy",
      "description": "【突袭】【奋战】。大喝：进场时，将1个战力不高于自己的单位踢回其所有者卡组顶。",
      "logic": "[突袭]: Can act on deploy. [奋战]: Can attack twice per turn. Has badge [鲁莽]. On deployment: target 1 unit on the board whose ATK <= 7 (Zhang Fei's base ATK); place that unit directly onto the top of its owner's draw deck."
    },
    "flavor": "",
    "cardId": "shu_zhang_fei",
    "faction": "SHU",
    "troopType": "INFANTRY",
    "actionCost": 2,
    "atk": 7,
    "maxHp": 7,
    "isDefector": false
  },

  {
    "id": "shu_ma_chao",
    "name": "马超",
    "pinyin": "ma_chao",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 7,
    "action_cost": 3,
    "attack": 7,
    "hp": 6,
    "max_hp": 6,
    "keywords": [
      "突袭",
      "坚阵1"
    ],
    "badges": [],
    "skill": {
      "name": "铁骑",
      "trigger": "passive_attack",
      "description": "【突袭】【坚阵1】。铁骑：攻击时无视【守护】。",
      "logic": "[突袭]: Can act on deploy. [坚阵1]: Combat damage -1. Troop: 骑 (Cavalry). When attacking, ignores enemy [守护] traits and can target any valid enemy in that line/zone."
    },
    "flavor": "",
    "cardId": "shu_ma_chao",
    "faction": "SHU",
    "troopType": "CAVALRY",
    "actionCost": 3,
    "atk": 7,
    "maxHp": 6,
    "isDefector": false
  },

  {
    "id": "shu_guan_yu",
    "name": "关羽",
    "pinyin": "guan_yu",
    "kingdom": "shu",
    "type": "unit",
    "troop_type": "cavalry",
    "cost": 8,
    "action_cost": 3,
    "attack": 8,
    "hp": 7,
    "max_hp": 7,
    "keywords": [
      "斩将"
    ],
    "badges": [
      "狂傲"
    ],
    "skill": {
      "name": "威震华夏",
      "trigger": "kill_enemy",
      "description": "【斩将】。威震：每击败1个敌军时，弃掉对手1张手牌；可同时兼为水军。",
      "logic": "[斩将]: If ATK > enemy ATK during attack, directly destroy target. Has badge [狂傲]. Dual troop type: 骑 (Cavalry) and 水 (Navy - benefits from water terrain rules). Whenever Guan Yu eliminates an enemy unit in combat, force opponent to discard 1 random card from hand."
    },
    "flavor": "",
    "cardId": "shu_guan_yu",
    "faction": "SHU",
    "troopType": "CAVALRY",
    "actionCost": 3,
    "atk": 8,
    "maxHp": 7,
    "isDefector": false
  }
]);

const baseMap = Object.fromEntries(SHU_CARDS.map(card => [card.id, card]));
if (baseMap['shu_wu_dang_fei_jun_1']) baseMap['shu_wu_dang_fei_jun'] = baseMap['shu_wu_dang_fei_jun_1'];

export const SHU_CARD_MAP = Object.freeze(baseMap);
export const CARD_MAP = SHU_CARD_MAP;

export default SHU_CARDS;
