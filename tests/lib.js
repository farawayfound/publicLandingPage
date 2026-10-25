'use strict';
/* Shared helpers for the regression suite. Run `npm install` once inside tests/ (it only needs playwright-core).
 * A Chrome/Chromium must be available: set CHROME_PATH, or install one of the usual locations, or run
 * `npx playwright-core install chromium` and unset CHROME_PATH. */
const fs = require('fs');
const path = require('path');

let pw;
try { pw = require('playwright-core'); } catch (e) { console.error('playwright-core is missing: run "npm install" inside tests/ first.'); process.exit(2); }
const { start } = require('./serve');

const SITE_ROOT = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : path.resolve(__dirname, '..', 'Public_html');

function chromePath() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
		.find((f) => fs.existsSync(f));
}
const launch = (extra = {}) => pw.chromium.launch(Object.assign({ executablePath: chromePath(), headless: true, args: ['--hide-scrollbars'] }, extra));

/** The generated pages that belong to the site (the leftover template pages in blog/pages are not linked and are skipped). */
function sitePages() {
	const stories = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, 'assets/data/stories.json'), 'utf8'));
	return { stories, pages: ['index.html', 'blog/index.html', ...stories.map((s) => s.href)] };
}

class Tester {
	constructor(name) { this.name = name; this.pass = 0; this.fail = 0; this.failures = []; }
	check(label, cond, detail) {
		if (cond) { this.pass++; if (process.env.VERBOSE) console.log(`  PASS  ${label}${detail ? '  (' + detail + ')' : ''}`); }
		else { this.fail++; this.failures.push(label); console.log(`  FAIL  ${label}${detail !== undefined && detail !== '' ? '  -> ' + detail : ''}`); }
		return !!cond;
	}
	summary() { console.log(`${this.fail ? 'FAIL' : 'ok  '} ${this.name}: ${this.pass} passed, ${this.fail} failed`); return this.fail === 0; }
}

/** a page with console/network capture; ignores third-party font requests (offline machines) */
async function newPage(browser, o = {}) {
	const ctx = await browser.newContext({
		viewport: { width: o.w || 1440, height: o.h || 900 },
		deviceScaleFactor: o.dpr || 1, isMobile: !!o.mobile, hasTouch: !!o.mobile,
		reducedMotion: o.reduce ? 'reduce' : 'no-preference', javaScriptEnabled: o.js !== false,
		serviceWorkers: 'block',
	});
	// third-party fonts are stubbed so the suite never depends on the network (TEST_FONTS=1 keeps them)
	if (!process.env.TEST_FONTS) await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
	const page = await ctx.newPage();
	page.problems = []; page.bytes = 0; page.requests = [];
	const third = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u);
	page.on('console', (m) => { if (m.type() === 'error' && !third(m.location().url || '') && !/fonts\.g|net::ERR/.test(m.text())) page.problems.push('console.error: ' + m.text()); });
	page.on('pageerror', (e) => page.problems.push('pageerror: ' + e.message));
	page.on('requestfailed', (r) => { if (!third(r.url()) && r.resourceType() !== 'media') page.problems.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)); });
	page.on('response', (r) => {
		if (!third(r.url())) {
			const len = +(r.headers()['content-length'] || 0);
			page.requests.push({ url: r.url(), status: r.status(), type: r.request().resourceType(), size: len });
			if (r.status() >= 400) page.problems.push('http ' + r.status() + ': ' + r.url());
			page.bytes += len;
		}
	});
	return page;
}

/** scroll through the whole page so lazy images load and reveals run, then back to the top */
async function scrollThrough(page, step = 600, pause = 140) {
	const h = await page.evaluate(() => document.documentElement.scrollHeight);
	for (let y = 0; y < h; y += step) { await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y); await page.waitForTimeout(pause); }
	await page.waitForTimeout(400);
	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

/** stop the auto-advancing hero so screenshots and counts are stable */
const freezeHero = (page) => page.evaluate(() => { const b = document.querySelector('.ticker__pause'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); });

module.exports = { pw, start, SITE_ROOT, launch, sitePages, Tester, newPage, scrollThrough, freezeHero, chromePath };
