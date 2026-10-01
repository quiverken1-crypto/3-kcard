import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BOOT_ASSETS,DEFERRED_UI_ASSETS} from '../js/ui/bootAssets.js';
test('startup assets contain only home assets, all complete',()=>{
  assert.equal(new Set(BOOT_ASSETS).size,BOOT_ASSETS.length);
  for(const path of [...BOOT_ASSETS,...DEFERRED_UI_ASSETS]) {
    const b=fs.readFileSync(new URL('../'+path,import.meta.url));
    if(path.endsWith('.webp'))assert.equal(b.length,b.readUInt32LE(4)+8,path);
  }
  assert.ok(!BOOT_ASSETS.some(path=>/loading-|energy-/.test(path)));
  assert.ok(!BOOT_ASSETS.some(path=>path.includes('/cards/')||path.includes('/audio/')||path.includes('_kit.webp')));
  assert.ok(DEFERRED_UI_ASSETS.every(path=>!BOOT_ASSETS.includes(path)));
});
