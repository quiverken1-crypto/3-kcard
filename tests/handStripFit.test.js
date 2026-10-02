import test from 'node:test';
import assert from 'node:assert/strict';
import {fitHandStrip} from '../js/ui/boardRenderer.js';

test('overflowing desktop hand enables left-start scrolling without shrinking cards',()=>{
  const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;
  const classes=()=>{const values=new Set();return{values,remove:(...keys)=>keys.forEach(k=>values.delete(k)),toggle:(k,on)=>on?values.add(k):values.delete(k)};};
  const cards=Array.from({length:9},(_,i)=>({dataset:{cardId:`card-${i}`},style:{},getBoundingClientRect:()=>({left:i*124,right:i*124+116,width:116})}));
  const tray={clientWidth:600,classList:classes(),scrollLeft:50,addEventListener(){}};
  const container={classList:classes(),parentElement:tray,querySelectorAll:()=>cards};
  globalThis.document={body:{classList:{contains:()=>false}}};
  globalThis.getComputedStyle=()=>({zoom:'1'});
  try {
    fitHandStrip(container);
    assert.ok(container.classList.values.has('hand-scroll'));
    assert.ok(tray.classList.values.has('hand-tray-scroll'));
    assert.equal(tray.scrollLeft,0);
    assert.ok(cards.every(c=>c.style.zoom==='1'));
  } finally {
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previousStyle;
  }
});
