import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAudioCues } from '../js/ui/audioDirector.js';

test('combat sound distinguishes sword and ranged fireball', () => {
  assert.deepEqual(selectAudioCues({ type: 'COMBAT_DAMAGE', attackStyle: 'MELEE' }), ['sword']);
  assert.deepEqual(selectAudioCues({ type: 'COMBAT_DAMAGE', attackStyle: 'FIREBALL' }), ['fireball']);
});

test('movement sound follows troop type and water terrain', () => {
  assert.deepEqual(selectAudioCues({ type: 'MOVE', troopType: 'CAVALRY', toTerrain: 'PLAIN' }), ['cavalry']);
  assert.deepEqual(selectAudioCues({ type: 'MOVE', troopType: 'NAVY', toTerrain: 'WATER' }), ['water']);
  assert.deepEqual(selectAudioCues({ type: 'MOVE', troopType: 'INFANTRY', toTerrain: 'PLAIN' }), ['footstep']);
});

test('a custom card may override its sound without changing event routing', () => {
  assert.deepEqual(selectAudioCues({ type: 'TACTIC_PLAYED', card: { audioCue: 'fireball' } }), ['fireball']);
  assert.deepEqual(selectAudioCues({ type: 'ABILITY_TRIGGERED', audioCue: 'none' }), []);
});
