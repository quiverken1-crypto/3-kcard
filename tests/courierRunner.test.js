import test from 'node:test';
import assert from 'node:assert/strict';
import { CourierRun } from '../js/ui/courierRunner.js';
test('jump only starts on ground and restart clears a collision', () => {
  const r = new CourierRun(() => 0.5); r.jump();
  const v = r.velocity; r.jump(); assert.equal(r.velocity, v);
  for(let i=0;i<90;i++) r.update(1/60);
  assert.equal(r.y, 0);
  r.obstacles = [{x: r.x, width: 20, height: 24}]; r.update(0.001);
  assert.equal(r.over, true); r.restart(); assert.equal(r.over, false); assert.equal(r.distance, 0);
});
test('distance is independent of refresh rate', () => {
  const a = new CourierRun(() => 0.5), b = new CourierRun(() => 0.5);
  a.nextSpawn = b.nextSpawn = 100;
  for(let i=0;i<60;i++) a.update(1/60);
  for(let i=0;i<120;i++) b.update(1/120);
  assert.ok(Math.abs(a.distance-b.distance)<1);
});
test('spawned obstacles allow enough time to land and jump again', () => {
 const r = new CourierRun(() => 0); r.nextSpawn = 0; r.update(1/60);
 assert.equal(r.obstacles.length,1); assert.ok(r.nextSpawn >= 1.25);
});
test('game over freezes simulation and long frame gaps are bounded', () => {
 const r = new CourierRun(); r.over=true; r.update(1); assert.equal(r.distance,0);
 r.restart(); r.nextSpawn=100; r.update(10); assert.ok(r.distance < 15);
});
