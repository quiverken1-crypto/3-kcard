import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('the preloaded modal frame is complete and decodable', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const path = html.match(/href="(assets\/ui\/kit_v2\/modal_frame\.[^"]+)"/)[1];
  const bytes = fs.readFileSync(new URL('../' + path, import.meta.url));
  if (path.endsWith('.webp')) assert.equal(bytes.length, bytes.readUInt32LE(4) + 8);
  else {
    const svg = bytes.toString();
    assert.match(svg, /<svg/);
    assert.match(svg, /<\/svg>\s*$/);
    assert.equal((svg.match(/viewBox="/g) || []).length, 5);
    const embedded = Buffer.from(svg.match(/base64,([^"\s]+)/)[1], 'base64');
    assert.equal(embedded.length, embedded.readUInt32LE(4) + 8);
  }
});

for (const [name, width, height, rect, naturalHeight] of [
  ['narrow viewport', 240, 400, {left:30,top:60,bottom:90}, 240],
  ['lower trigger', 600, 400, {left:30,top:130,bottom:165}, 360],
]) test('faction drawer stays inside ' + name, () => {
  const source = fs.readFileSync(new URL('../js/ui/factionPicker.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function placeOpenPanel'), source.indexOf('function closeOpen'));
  const panel = {style:{}, scrollHeight:naturalHeight, get offsetHeight() {return Math.min(naturalHeight,parseFloat(this.style.maxHeight));}};
  const context = {openPanel:{btn:{getBoundingClientRect:()=>rect,isConnected:true},panel,wrap:{closest:()=>null}},innerWidth:width,innerHeight:height,document:{documentElement:{clientWidth:width,clientHeight:height}}};
  vm.runInNewContext(body + '; placeOpenPanel();',context);
  const s=panel.style;
  assert.ok(parseFloat(s.left)+parseFloat(s.width)<=width-8, JSON.stringify(s));
  assert.ok(parseFloat(s.top)+Math.min(naturalHeight,parseFloat(s.maxHeight))<=height-8, JSON.stringify(s));
});
