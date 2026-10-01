import test from 'node:test';
import assert from 'node:assert/strict';
import {matchArtRequests,MatchArtLoader} from '../js/ui/matchArtLoader.js';

const card=cardId=>({cardId});
function state() {return {
  matchId:'match-a',
  battlefield:{support:{WEI:{slots:[card('shu_guan_yu')]},SHU:{slots:[]}},frontline:{LEFT:{units:[card('wu_sun_ce')]}}},
  players:{WEI:{hand:[card('wei_li_dian')],deck:[card('wei_li_dian'),card('wei_shipo'),card('wei_zhang_liao')]},SHU:{hand:[card('wu_zhou_yu')],deck:[card('shu_shipo'),card('wu_zhou_yu')]}}
};}
test('combat and own hand art precede match decks and common art is deduplicated',()=>{
  const jobs=matchArtRequests(state(),'WEI');
  assert.deepEqual(jobs.slice(0,3).map(j=>j.priority),['high','high','high']);
  assert.equal(jobs.find(j=>j.url.endsWith('wei_li_dian.webp')).priority,'high');
  assert.equal(jobs.filter(j=>j.url.endsWith('common_shipo.webp')).length,1);
  assert.equal(new Set(jobs.map(j=>j.url)).size,jobs.length);
  assert.ok(!jobs.some(j=>j.url.includes('lb_lv_bu')));
});
test('new combat art jumps ahead of background jobs, bounded to three requests',()=>{
  const images=[];
  class FakeImage {constructor(){images.push(this);}}
  const loader=new MatchArtLoader(FakeImage),s=state();
  loader.update(s,'WEI');
  assert.equal(images.length,3);
  assert.ok(images.every(i=>i.fetchPriority==='high'));
  s.battlefield.support.WEI.slots.push(card('wei_xia_hou_dun'));
  loader.update(s,'WEI');
  images[0].onload();
  assert.ok(images[3].src.endsWith('wei_xia_hou_dun.webp'));
  assert.equal(loader.active,3);
  for(let i=1;i<images.length;i++)images[i].onload();
  const count=images.length;
  loader.update(s,'WEI');
  assert.equal(images.length,count);
});
