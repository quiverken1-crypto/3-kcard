import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionController } from '../js/ui/interaction.js';

test('phone dragging defers damage simulation while keeping targeting available', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { body: { classList: { contains: name => name === 'm-land' } } };
  const controller = Object.create(InteractionController.prototype);
  controller.isDragging = true;
  controller.gameState = {};
  let hidden = false;
  controller._hidePreview = () => { hidden = true; };
  try {
    controller._previewFor({ type: 'ATTACK', payload: {} }, {});
    assert.ok(hidden);
    assert.equal(controller._previewKey, undefined);
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

test('aiming updates every endpoint while amortizing geometry and stable target styles', () => {
  const previousDocument = globalThis.document;
  const previousPerformance = globalThis.performance;
  let time = 0, reads = 0, classWrites = 0, paths = 0, legal = false;
  const attributes = new Map();
  const source = { getBoundingClientRect() { reads++; return {left:10,top:20,width:100,height:80}; } };
  const controller = Object.create(InteractionController.prototype);
  controller.svgOverlay = { getBoundingClientRect() { reads++; return {left:0,top:0}; } };
  controller.targetingCurve = {
    classList:{add(){classWrites++;},remove(){classWrites++;}},
    className:{baseVal:'targeting-curve'},
    setAttribute(k,v){attributes.set(k,v);if(k==='d')paths++;},
    removeAttribute(k){attributes.delete(k);}
  };
  controller._hidePreview = () => {};
  globalThis.document = {elementFromPoint:()=>({closest:()=>legal ? {} : null})};
  globalThis.performance = {now:()=>time};
  try {
    for (let i=0;i<100;i++) {
      time=i;
      controller._drawPointerCurve(source,100+i,200+i,true);
    }
    assert.equal(paths,100, 'every pointer position must reach the arrow');
    assert.match(attributes.get('d'), /199\.0 299\.0$/);
    assert.equal(reads,8, 'four geometry samples instead of 200 layout reads');
    assert.equal(classWrites,2, 'unchanged target colour must not be rewritten');
    legal=true;
    controller._drawPointerCurve(source,210,310,true);
    assert.equal(attributes.get('marker-end'),'url(#arrowhead-legal)');
    assert.equal(classWrites,4, 'a new target mode must still change feedback');
    controller._clearTargetingCurve();
    controller._drawPointerCurve(source,220,320,true);
    assert.equal(reads,10, 'new selections must measure fresh geometry');
  } finally {
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    globalThis.performance=previousPerformance;
  }
});

test('drag ghost keeps dragging state and pointer transforms override selected CSS', () => {
  const previousDocument=globalThis.document;
  const attributes=new Map(), classes=new Set(['selected','dragging']), bodyClasses=new Set();
  const ghost={
    classList:{add:k=>classes.add(k),remove:(...keys)=>keys.forEach(k=>classes.delete(k))},
    style:{setProperty:(key,value,priority)=>attributes.set(key,{value,priority})},remove(){}
  };
  globalThis.document={
    querySelector:()=>({cloneNode:()=>ghost}),elementFromPoint:()=>null,
    body:{appendChild(){},classList:{add:k=>bodyClasses.add(k),remove:k=>bodyClasses.delete(k),contains:k=>bodyClasses.has(k)}}
  };
  const controller=Object.create(InteractionController.prototype);
  controller.state='IDLE';
  controller.dragPointerId=1;
  controller.dragStartPos={x:0,y:0};
  controller.isDragging=true;
  try {
    controller._createCardGhost('card',100,200);
    assert.deepEqual(attributes.get('zoom'),{value:'1',priority:'important'});
    assert.ok(bodyClasses.has('is-dragging'));
    assert.ok(!classes.has('selected'));
    controller._handlePointerMove({pointerId:1,clientX:200,clientY:300,pointerType:'mouse'});
    assert.deepEqual(attributes.get('transform'),{value:'translate(155px, 240px) scale(0.9)',priority:'important'});
    controller._removeCardGhost();
    assert.ok(!bodyClasses.has('is-dragging'));
  } finally {
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});
