#!/usr/bin/env node
'use strict';
/* Page weight budgets (bytes on the wire; the preview server does not compress, so these are conservative):
 * the hub used to weigh 27 MB on first load, a 39-photo story 12.8 MB once scrolled.
 *   node tests/perf.js */
const { launch, start, SITE_ROOT, Tester, newPage, scrollThrough } = require('./lib');

const t = new Tester('perf');
const MB = 1048576;

(async () => {
	const srv = await start({ root: SITE_ROOT });
	const browser = await launch();
	const fmt = (b) => (b / MB).toFixed(2) + ' MB';
	try {
		const cases = [
			// [page, width, mobile, first-load budget MB, fully-scrolled budget MB]
			['index.html', 1440, false, 3.4, 6.0], ['index.html', 390, true, 2.4, 4.8],
			['blog/index.html', 1440, false, 1.4, 5.5], ['blog/index.html', 390, true, 1.0, 4.0],
			['blog/pages/amsterdam.html', 1440, false, 1.6, 5.5], ['blog/pages/amsterdam.html', 390, true, 1.0, 4.0],
			['blog/pages/rmnp.html', 1440, false, 1.6, 4.0], ['blog/pages/north-cascades.html', 1440, false, 2.2, 4.5],
		];
		for (const [rel, w, mobile, first, full] of cases) {
			const page = await newPage(browser, { w, h: mobile ? 844 : 900, mobile, dpr: mobile ? 2 : 1 });
			await page.goto(`${srv.url}/${rel}`, { waitUntil: 'load' });
			await page.waitForTimeout(1500);
			const b1 = page.bytes;
			await scrollThrough(page, mobile ? 500 : 700, 160);
			await page.waitForTimeout(800);
			const b2 = page.bytes;
			const big = page.requests.filter((r) => /\.(jpe?g|png)$/i.test(r.url) && !/\/derived\/og\/|\/clips\//.test(r.url));
			t.check(`${rel} @${w}: first load ${fmt(b1)} is within ${first} MB`, b1 <= first * MB, fmt(b1));
			t.check(`${rel} @${w}: whole page scrolled ${fmt(b2)} is within ${full} MB`, b2 <= full * MB, fmt(b2));
			if (!rel.includes('pages/')) t.check(`${rel} @${w}: no raw JPEG/PNG photo is downloaded (derived WebP only)`, big.length === 0, big.slice(0, 2).map((r) => r.url.split('/').pop()).join(','));
			const media = page.requests.filter((r) => /\.(mp4|webm)$/i.test(r.url)).map((r) => r.url.split('/').pop());
			if (rel === 'index.html') t.check(`${rel} @${w}: the 10 MB original clip is never requested`, !media.some((m) => m === 'tinySnowboarding.mp4'), media.join(','));
			await page.context().close();
		}
		// the largest single image of each page type
		const page = await newPage(browser, { w: 1440, h: 900 });
		for (const rel of ['index.html', 'blog/index.html', 'blog/pages/aspen.html', 'blog/pages/guadalupe.html']) {
			await page.goto(`${srv.url}/${rel}`, { waitUntil: 'load' });
			await scrollThrough(page, 700, 120);
			await page.waitForTimeout(500);
		}
		const imgs = page.requests.filter((r) => /\.(webp|jpe?g|png)$/i.test(r.url)).sort((a, b) => b.size - a.size);
		t.check(`no single image above 1 MB on the hub, the index, aspen or guadalupe (their covers were 3.3 MB and 4.4 MB); largest ${imgs[0] ? (imgs[0].size / 1024).toFixed(0) + ' KB ' + imgs[0].url.split('/').pop() : '-'}`, imgs.length > 0 && imgs[0].size <= 1 * MB, imgs.slice(0, 2).map((r) => r.url.split('/').pop()).join(','));
		await page.context().close();
	} finally { await browser.close(); await srv.close(); }
	process.exit(t.summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
