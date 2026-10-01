import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,createCard,dispatch} from '../js/engine/rulesEngine.js';
import {afterAttack} from '../js/engine/cardSkills.js';

function setup(cardId='wu_sun_ce') {
  const state=createInitialState();
  const sun=createCard({cardId,name:'孙策',faction:'WEI'});
  const enemy=createCard({cardId:'enemy',faction:'SHU'});
  state.battlefield.support.WEI.slots.push(sun);
  return {state,sun,enemy};
}
test('江东孙策主动击杀时获得声望',()=>{
  const {state,sun,enemy}=setup();
  afterAttack(state,sun,enemy,{defenderDied:true},false);
  assert.equal(state.players.WEI.prestige,1);
});
test('江东孙策反击击杀时也获得声望',()=>{
  const {state,sun,enemy}=setup();
  afterAttack(state,enemy,sun,{attackerDied:true,defenderDied:false,counterDealt:5},false);
  assert.equal(state.players.WEI.prestige,1);
});
test('完整战斗结算中孙策反击击杀触发霸王',()=>{
  const {state,sun,enemy}=setup();
  state.phase='ACTION';state.activePlayer='SHU';state.players.SHU.provisions=10;
  sun.atk=8;sun.hp=6;sun.maxHp=6;sun.troopType='CAVALRY';
  enemy.atk=1;enemy.hp=1;enemy.maxHp=1;enemy.troopType='INFANTRY';
  state.battlefield.frontline.LEFT.occupant='SHU';
  state.battlefield.frontline.LEFT.units.push(enemy);
  const result=dispatch(state,{type:'ATTACK',playerId:'SHU',payload:{attackerId:enemy.instanceId,targetId:sun.instanceId}});
  assert.equal(result.attackerDied,true);
  assert.equal(state.players.WEI.prestige,1);
});
test('霸王声望优先削弱对方，己方已满则不超过2点',()=>{
  const {state,sun,enemy}=setup();
  state.players.SHU.prestige=1;
  afterAttack(state,sun,enemy,{defenderDied:true},false);
  assert.equal(state.players.SHU.prestige,0);
  assert.equal(state.players.WEI.prestige,0);
  state.players.WEI.prestige=2;
  afterAttack(state,sun,enemy,{defenderDied:true},false);
  assert.equal(state.players.WEI.prestige,2);
});
test('袁术军孙策没有霸王声望技能',()=>{
  const {state,sun,enemy}=setup('yshu_sun_ce');
  afterAttack(state,sun,enemy,{defenderDied:true},false);
  assert.equal(state.players.WEI.prestige,0);
});
