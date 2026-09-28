/**
 * runTests.js
 * Zero-Dependency Test Runner for Three Kingdoms KARDS.
 * Uses native Node.js `node:test` and `node:assert`.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const testFiles = [
  { name: 'Tier 1: Feature Coverage', path: resolve(__dirname, 'tier1_feature.test.js') },
  { name: 'Tier 2: Boundary & Corner Cases', path: resolve(__dirname, 'tier2_boundary.test.js') },
  { name: 'Tier 3: Pairwise Combinations', path: resolve(__dirname, 'tier3_pairwise.test.js') },
  { name: 'Tier 4: Real-world Simulations', path: resolve(__dirname, 'tier4_realworld.test.js') },
  { name: 'Custom Card Abilities', path: resolve(__dirname, 'customCards.test.js') },
  { name: 'Audio Event Routing', path: resolve(__dirname, 'audioDirector.test.js') },
  { name: 'Deck Randomness', path: resolve(__dirname, 'deckRandomness.test.js') },
  { name: 'Interaction Arrows', path: resolve(__dirname, 'interactionArrow.test.js') },
  { name: 'Turn Clock', path: resolve(__dirname, 'turnClock.test.js') },
  { name: 'Hand Cost and Layout', path: resolve(__dirname, 'handCostAndLayout.test.js') },
  { name: 'Card Skill Triggers', path: resolve(__dirname, 'skillTriggers.test.js') },
  { name: 'Prestige Badge', path: resolve(__dirname, 'prestigeBadge.test.js') }
];

console.log('='.repeat(80));
console.log('       THREE KINGDOMS KARDS — AUTOMATED TEST SUITE RUNNER');
console.log('='.repeat(80));
console.log(`Environment: Node.js ${process.version}`);
console.log(`Runner: Native node:test (Zero External Dependencies)`);
console.log(`Target Directory: ${__dirname}`);
console.log('-'.repeat(80));
testFiles.forEach((t, i) => console.log(`  [Suite ${i + 1}] ${t.name}: ${t.path}`));
console.log('='.repeat(80));
console.log('');

const startTime = Date.now();
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const testStream = run({
  files: testFiles.map(t => t.path),
  concurrency: false
});

testStream.on('test:pass', () => {
  passedTests++;
  totalTests++;
});

testStream.on('test:fail', () => {
  failedTests++;
  totalTests++;
});

// Stream human-readable spec output to stdout
testStream.compose(spec).pipe(process.stdout);

testStream.on('end', () => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(80));
  console.log('                     TEST EXECUTION SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Total Test Assertions Executed : ${totalTests}`);
  console.log(`  Passed Tests                   : ${passedTests}`);
  console.log(`  Failed Tests                   : ${failedTests}`);
  console.log(`  Execution Duration             : ${elapsed}s`);
  console.log(`  Status                         : ${failedTests === 0 ? 'ALL TIERS PASSED [SUCCESS]' : 'FAILURES DETECTED [FAILURE]'}`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
});
