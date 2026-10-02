import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {AudioDirector} from '../js/ui/audioDirector.js';
import {whenDocumentReady} from '../js/ui/startup.js';

test('boot starts even if DOMContentLoaded occurred before the module arrived',()=>{
  let started=0;
  whenDocumentReady({readyState:'complete'},()=>started++);
  assert.equal(started,1);
});
test('boot waits for parsing when document is still loading',()=>{
  let event,started=0;
  whenDocumentReady({readyState:'loading',addEventListener:(name,fn,opts)=>{event={name,fn,opts};}},()=>started++);
  assert.equal(started,0);assert.equal(event.opts.once,true);
  event.fn();assert.equal(started,1);
});
test('blocked Safari storage and AudioContext do not abort startup',()=>{
  const storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const audio=globalThis.AudioContext;
  let attempts=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked storage');}});
  globalThis.AudioContext=class {constructor(){attempts++;throw Error('blocked audio');}};
  try {
    const director=new AudioDirector();
    assert.equal(director.storage,null);
    assert.equal(director._ctx(),null);assert.equal(director._ctx(),null);
    assert.equal(attempts,1);
  } finally {
    if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete globalThis.localStorage;
    if(audio===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=audio;
  }
});
test('HTML boot guard offers retry on core script stall or initialization failure',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const source=html.match(/<script id="boot-guard">([\s\S]*?)<\/script>/)[1];
  const events=new Map();let timeout,reloads=0;
  const label={};let button;
  const makeButton=()=>({dataset:{},classList:{remove(){}},cloneNode:makeButton,replaceWith(next){button=next;}});
  button=makeButton();
  const window={location:{reload(){reloads++;}},addEventListener:(name,fn)=>events.set(name,fn)};
  vm.runInNewContext(source,{window,document:{getElementById:id=>id==='boot-label'?label:button},setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}});
  timeout();assert.equal(button.textContent,'重新加载');button.onclick();assert.equal(reloads,1);
  events.get('sgk-init-error')();assert.match(label.textContent,/初始化失败/);
  window.__TK_READY=true;events.get('sgk-ready')();
  assert.equal(button.textContent,'直接进入');assert.equal(button.onclick,null);
});
test('lobby unlock does not compete with initial image loads by preloading battle sounds',()=>{
  const director=new AudioDirector(null);
  director._ctx=()=>null;
  let loads=0;director._preloadSfx=()=>loads++;
  director.scene='lobby';director.unlock();assert.equal(loads,0);
  director.scene='match';director.unlock();assert.equal(loads,1);
});
