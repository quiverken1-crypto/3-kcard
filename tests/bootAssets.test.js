import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BOOT_ASSETS,BOOT_LEVELS,BOOT_GEMS,DEFERRED_UI_ASSETS,bootLevelAt} from '../js/ui/bootAssets.js';
test('boot brightness progresses and stays at the brightest stage',()=>{
  assert.deepEqual(Array.from({length:9},(_,i)=>bootLevelAt(i)),[0,1,2,3,4,5,5,5,5]);
  assert.equal(bootLevelAt(-1),0);
});
test('startup assets contain only home and interaction assets, all complete',()=>{
  assert.equal(new Set(BOOT_ASSETS).size,BOOT_ASSETS.length);
  for(const path of [...BOOT_ASSETS,...DEFERRED_UI_ASSETS]) {
    const b=fs.readFileSync(new URL('../'+path,import.meta.url));
    if(path.endsWith('.webp'))assert.equal(b.length,b.readUInt32LE(4)+8,path);
  }
  assert.ok(BOOT_LEVELS.every(path=>BOOT_ASSETS.includes(path)));
  assert.ok(BOOT_GEMS.every(path=>BOOT_ASSETS.includes(path)));
  assert.ok(!BOOT_ASSETS.some(path=>path.includes('/cards/')||path.includes('/audio/')||path.includes('_kit.webp')));
  assert.ok(DEFERRED_UI_ASSETS.every(path=>!BOOT_ASSETS.includes(path)));
});
