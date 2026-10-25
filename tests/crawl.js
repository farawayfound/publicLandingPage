#!/usr/bin/env node
'use strict';
/* Crawl every generated page at several widths: no console errors, no 4xx (the server is case-sensitive like the Pi),
 * no broken images, every <img> sized, no horizontal scroll from 320 to 2560 px, one <h1>, unique ids, tags present.
 *   node tests/crawl.js [--quick]       (--quick = two widths for every page instead of the full range for the key pages) */
const { launch, start, SITE_ROOT, sitePages, Tester, newPage, scrollThrough } = require('./lib');

const WIDTHS_ALL = [320, 360, 390, 768, 1024, 1440, 1920, 2560];
const WIDTHS_FEW = [360, 1440];
const KEY = ['index.html', 'blog/index.html', 'blog/pages/amsterdam.html', 'blog/pages/rmnp.html'];

(async () => {
	const quick = process.argv.includes('--quick');
	const t = new Tester('crawl');
	const srv = await start({ root: SITE_ROOT });
	const browser = await launch();
	const { pages } = sitePages();
	try {
		for (const rel of pages) {
			const widths = quick ? WIDTHS_FEW : (KEY.includes(rel) ? WIDTHS_ALL : WIDTHS_FEW);
			for (const w of widths) {
				const mobile = w < 800;
				const page = await newPage(browser, { w, h: mobile ? 800 : 900, mobile, dpr: 1 });
				const tag = `${rel} @${w}`;
				await page.goto(`${srv.url}/${rel}`, { waitUntil: 'load' });
				await page.waitForTimeout(500);
				await scrollThrough(page, 700, 90);
				await page.waitForTimeout(500);
				const r = await page.evaluate(() => {
					const imgs = [...document.images];
					const ids = {}, dup = [];
					document.querySelectorAll('[id]').forEach((e) => { if (ids[e.id]) dup.push(e.id); ids[e.id] = 1; });
					const q = (s) => document.querySelector(s);
					return {
						overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
						broken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).map((i) => i.getAttribute('src')),
						unsized: imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).map((i) => i.getAttribute('src')),
						noAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
						dup, h1: document.querySelectorAll('h1').length, mains: document.querySelectorAll('main').length,
						title: document.title, lang: document.documentElement.lang,
						desc: !!q('meta[name=description][content]'), ogTitle: !!q('meta[property="og:title"][content]'), ogImage: !!q('meta[property="og:image"][content]'), ogDesc: !!q('meta[property="og:description"][content]'),
						viewport: !!q('meta[name=viewport]'), compat: document.compatMode,
						eager: imgs.filter((i) => i.getAttribute('fetchpriority') === 'high').length,
						vendor: [...document.querySelectorAll('link[rel=stylesheet],script[src]')].map((e) => e.href || e.src).filter((u) => /bootstrap|jquery|flexslider|modernizr|animate\.css|lightbox/i.test(u)),
					};
				});
				t.check(`${tag}: no console/network problems`, page.problems.length === 0, page.problems.slice(0, 3).join(' | '));
				t.check(`${tag}: no horizontal scroll`, r.overflow <= 0, 'overflow ' + r.overflow);
				t.check(`${tag}: no broken images`, r.broken.length === 0, r.broken.slice(0, 3).join(', '));
				if (w === WIDTHS_FEW[0] || w === 1440) {
					t.check(`${tag}: every <img> has width+height`, r.unsized.length === 0, r.unsized.slice(0, 3).join(', '));
					t.check(`${tag}: every <img> has an alt attribute`, r.noAlt === 0, String(r.noAlt));
					t.check(`${tag}: unique ids`, r.dup.length === 0, r.dup.join(','));
					t.check(`${tag}: exactly one <h1> and one <main>`, r.h1 === 1 && r.mains === 1, `h1=${r.h1} main=${r.mains}`);
					t.check(`${tag}: title, description, og tags, viewport, lang`, !!r.title && r.desc && r.ogTitle && r.ogDesc && r.ogImage && r.viewport && r.lang === 'en', JSON.stringify({ t: r.title, d: r.desc, ot: r.ogTitle, oi: r.ogImage }));
					t.check(`${tag}: standards mode`, r.compat === 'CSS1Compat', r.compat);
					t.check(`${tag}: fetchpriority=high only on the first hero image`, r.eager === 1, String(r.eager));
					t.check(`${tag}: no old vendor CSS/JS referenced`, r.vendor.length === 0, r.vendor.join(', '));
				}
				await page.context().close();
			}
		}
		t.check('server answered no 404 for any page asset', srv.stats.notFound.filter((u) => !/favicon|fonts\.g/.test(u)).length === 0, srv.stats.notFound.slice(0, 5).join(', '));
	} finally { await browser.close(); await srv.close(); }
	process.exit(t.summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
