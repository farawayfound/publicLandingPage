#!/usr/bin/env node
'use strict';
/* Runs the whole regression suite against Public_html (build first: node scripts/build-site.js).
 *   cd tests && npm install && node run-all.js [--quick]
 * Needs Chrome/Chromium (CHROME_PATH or a standard install). Takes about three minutes; --quick shortens the crawl. */
const { spawnSync } = require('child_process');
const path = require('path');

const quick = process.argv.includes('--quick');
const steps = [
	['generator.js', []], ['links.js', []], ['verbatim.js', []], ['crawl.js', quick ? ['--quick'] : []], ['flow.js', []], ['a11y.js', []], ['perf.js', []], ['hero.js', []],
];
let failed = 0;
const t0 = Date.now();
for (const [file, args] of steps) {
	console.log(`\n=== ${file} ${args.join(' ')}`);
	const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: 'inherit' });
	if (r.status !== 0) failed++;
}
console.log(`\n${failed ? `${failed} suite(s) FAILED` : 'all suites passed'} in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(failed ? 1 : 0);
