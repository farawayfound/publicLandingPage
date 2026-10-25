#!/usr/bin/env node
'use strict';
/* Interaction checks: hero slideshow + pause, reduced motion, no-JS, clip loading, map, timeline, filters, planGroup rows,
 * hash deep links, lightbox (keyboard, swipe, focus trap, history/Back), prev/next links, locator.
 *   node tests/flow.js [scenario ...]        e.g. node tests/flow.js lightbox history */
const { launch, start, SITE_ROOT, sitePages, Tester, newPage, scrollThrough, freezeHero } = require('./lib');

const t = new Tester('flow');
let srv, browser, URL_, stories;
const only = process.argv.slice(2);
const U = (p) => `${URL_}/${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* every tile in a year group is flush: sampled at each tile's mid-height the tiles cover the full width with equal gaps */
async function rowsComplete(page, group) {
	return page.evaluate((sel) => {
		const g = document.querySelector(sel); if (!g) return 'no group';
		const box = g.querySelector('.tiles').getBoundingClientRect();
		const tiles = [...g.querySelectorAll('.tile:not([hidden])')].map((e) => e.getBoundingClientRect());
		if (!tiles.length) return 'no tiles';
		const gaps = [];
		for (const a of tiles) for (const f of [0.25, 0.75]) {
			const y = a.top + (a.bottom - a.top) * f; // two samples per tile: a tile that spans two rows is covered in both
			const row = tiles.filter((r) => r.top < y && r.bottom > y).sort((p, q) => p.left - q.left);
			if (Math.abs(row[0].left - box.left) > 1.5 || Math.abs(row[row.length - 1].right - box.right) > 1.5) return `ragged row at y=${Math.round(y)}`;
			for (let i = 1; i < row.length; i++) gaps.push(row[i].left - row[i - 1].right);
		}
		return Math.max(...gaps, 0) - Math.min(...gaps, 99) > 2 ? 'uneven gaps' : 'ok';
	}, group);
}

const scenarios = {
	async landing() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		await page.goto(U('index.html'), { waitUntil: 'load' });
		await page.waitForTimeout(1200);
		const idx = () => page.$eval('#tick-n', (e) => e.textContent.trim());
		t.check('landing: hero counter starts at 01 / N', /^01 \/ \d+$/.test(await idx()), await idx());
		t.check('landing: the h1 is the owner\'s "Live · Explore · Wander"', (await page.$eval('h1', (e) => e.textContent.replace(/\s+/g, ' ').trim())) === 'Live · Explore · Wander');
		await page.waitForTimeout(8500);
		t.check('landing: slideshow advances by itself', (await idx()).startsWith('02'), await idx());
		const btn = page.locator('.ticker__pause');
		await btn.click();
		t.check('landing: pause button flips to "Play slideshow"', (await btn.getAttribute('aria-label')) === 'Play slideshow' && (await btn.getAttribute('aria-pressed')) === 'true');
		const at = await idx();
		await page.waitForTimeout(8500);
		t.check('landing: paused slideshow stays put', (await idx()) === at, at + ' -> ' + (await idx()));
		await btn.click();
		await page.waitForTimeout(8500);
		t.check('landing: resumes after Play', (await idx()) !== at, await idx());
		t.check('landing: pause control is at least 34px', (await btn.boundingBox()).width >= 34);

		// the clip must not be requested until the card is visible: on a phone the cards start far below the fold
		const ph = await newPage(browser, { w: 390, h: 844, mobile: true });
		await ph.goto(U('index.html'), { waitUntil: 'load' });
		await ph.waitForTimeout(2500);
		const reqs = (p) => p.requests.filter((r) => /tinySnowboarding/.test(r.url)).map((r) => r.url.split('/').pop());
		t.check('landing (phone): no video file is requested while the card is below the fold', reqs(ph).filter((n) => /\.(mp4|webm)$/.test(n)).length === 0, reqs(ph).join(','));
		t.check('landing (phone): total bytes on first load stay small (no 10 MB clip)', ph.bytes < 3.2 * 1024 * 1024, (ph.bytes / 1048576).toFixed(2) + ' MB');
		await ph.evaluate(() => document.querySelector('.card__media--blog').scrollIntoView({ block: 'center', behavior: 'instant' }));
		await ph.waitForTimeout(2500);
		t.check('landing (phone): the clip plays once the card is on screen', (await ph.$eval('video[data-lazyvideo]', (v) => v.paused)) === false);
		const used = reqs(ph).filter((n) => /\.(mp4|webm)$/.test(n));
		t.check('landing (phone): only the small transcode is fetched (never the 10 MB original)', used.length > 0 && used.every((n) => /-480\./.test(n)), used.join(','));
		await ph.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
		await ph.waitForTimeout(1200);
		t.check('landing (phone): the clip pauses when scrolled away', (await ph.$eval('video[data-lazyvideo]', (v) => v.paused)) === true);
		await ph.context().close();

		const term = await page.$eval('#terminal-card', (e) => ({ lines: e.querySelectorAll('.t-line').length, h: e.clientHeight, lh: parseFloat(getComputedStyle(e).fontSize) * 1.52 }));
		t.check('landing: terminal animation is running and fits its card', term.lines > 0 && term.lines * term.lh <= term.h + 2, JSON.stringify(term));
		const counts = await page.$$eval('[data-count]', (els) => els.map((e) => [e.textContent, e.getAttribute('data-count')]));
		await page.waitForTimeout(3500);
		const counts2 = await page.$$eval('[data-count]', (els) => els.map((e) => [e.textContent, e.getAttribute('data-count')]));
		// the final value is grouped (1,452), the same as the map band's figure
		t.check('landing: count-up ends on the real numbers', counts2.every((c) => c[0] === Number(c[1]).toLocaleString('en-US')) && counts2.length === 3, JSON.stringify(counts2));
		t.check('landing: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async landingStrip() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		await page.goto(U('index.html'), { waitUntil: 'load' });
		await freezeHero(page);
		await page.evaluate(() => document.querySelector('.strip').scrollIntoView({ block: 'center', behavior: 'instant' }));
		await page.waitForTimeout(700);
		const prev = page.locator('[data-strip="-1"]'), next = page.locator('[data-strip="1"]');
		t.check('strip: previous is disabled at the start', await prev.isDisabled());
		const x0 = await page.$eval('.strip', (e) => e.scrollLeft);
		await next.click(); await page.waitForTimeout(900);
		t.check('strip: next scrolls the strip', (await page.$eval('.strip', (e) => e.scrollLeft)) > x0 + 100);
		t.check('strip: previous is enabled afterwards', !(await prev.isDisabled()));
		const imgs = (await page.$$eval('.poster img', (els) => els.map((i) => i.currentSrc.split('/').pop()))).filter(Boolean);
		t.check('strip: poster tiles use small WebP derivatives, never raw covers', imgs.length > 0 && imgs.every((n) => /-(480|960)\.webp$/.test(n)), imgs.slice(0, 3).join(','));
		await page.context().close();
	},

	async reduced() {
		const page = await newPage(browser, { w: 1440, h: 900, reduce: true });
		await page.goto(U('index.html'), { waitUntil: 'load' });
		await page.waitForTimeout(1500);
		const first = await page.$eval('.hero .slide', (e) => e.currentSrc);
		await page.waitForTimeout(8500);
		t.check('reduced motion: the hero stays on one frame', (await page.$eval('.hero .slide.is-active', (e) => e.currentSrc)) === first);
		t.check('reduced motion: hero is marked static and the slideshow controls are hidden', await page.$eval('.hero', (e) => e.classList.contains('is-static')) && !(await page.locator('.ticker__pause').isVisible()));
		const anim = await page.evaluate(() => ['.slide.is-active', '.hero__badge', '.cue', '.hero__foot', '.pin__ring'].map((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).animationName : 'none'; }));
		t.check('reduced motion: no animation on slide, pill, cue, foot', anim.every((a) => a === 'none'), anim.join(','));
		const op = await page.evaluate(() => [...document.querySelectorAll('.card, .row-head, .atlas-head')].map((e) => getComputedStyle(e).opacity));
		t.check('reduced motion: nothing is held back by reveal gating', op.every((o) => o === '1'), op.join(','));
		const counts = await page.$$eval('[data-count]', (els) => els.map((e) => e.textContent === Number(e.getAttribute('data-count')).toLocaleString('en-US')));
		t.check('reduced motion: counts show the final numbers immediately', counts.every(Boolean));
		t.check('reduced motion: the clip never starts', (await page.$eval('video[data-lazyvideo]', (v) => v.paused)) && !page.requests.some((r) => /tinySnowboarding-480/.test(r.url)));
		const term = await page.$eval('#terminal-card', (e) => ({ n: e.querySelectorAll('.t-line').length, shown: getComputedStyle(e.querySelector('.t-static')).display }));
		t.check('reduced motion: the terminal shows one still frame', term.n > 0 && term.shown !== 'none', JSON.stringify(term));
		// blog + post under reduced motion
		await page.goto(U('blog/pages/amsterdam.html'), { waitUntil: 'load' });
		const a2 = await page.evaluate(() => ['.frame__l--t', '.frame--post .statement__text', '.slide'].map((s) => getComputedStyle(document.querySelector(s)).animationName));
		t.check('reduced motion: story hero draws nothing, rises nothing, zooms nothing', a2.every((a) => a === 'none'), a2.join(','));
		const clip = await page.$eval('.full a', (e) => getComputedStyle(e).clipPath);
		t.check('reduced motion: photo breaks are shown in full (no clip, no zoom-in)', clip === 'none' || clip === 'inset(0px)', clip);
		await page.context().close();
	},

	async noJs() {
		const page = await newPage(browser, { w: 1440, h: 900, js: false });
		for (const rel of ['index.html', 'blog/index.html', 'blog/pages/rmnp.html']) {
			await page.goto(U(rel), { waitUntil: 'load' });
			await page.waitForTimeout(800);
			const r = await page.evaluate(() => {
				const vis = (e) => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.opacity !== '0' && s.visibility !== 'hidden' && s.display !== 'none' && b.width > 10; };
				return {
					cls: document.documentElement.className,
					slide: [...document.querySelectorAll('.hero .slide')].every(vis),
					content: [...document.querySelectorAll('.card, .tile, .poster, .about__text, .story__title, .jg__item, .snav')].every(vis),
					counts: [...document.querySelectorAll('[data-count]')].every((e) => e.textContent === Number(e.getAttribute('data-count')).toLocaleString('en-US') && e.textContent !== '0'),
					broken: [...document.images].filter((i) => i.getBoundingClientRect().top < 3000 && i.complete && !i.naturalWidth && i.loading !== 'lazy').length,
				};
			});
			t.check(`no-JS ${rel}: html.no-js, hero and content visible, counts final`, r.cls.includes('no-js') && r.slide && r.content && r.counts, JSON.stringify(r));
		}
		// no-JS lightbox degrades to a plain link to the photo
		await page.goto(U('blog/pages/rmnp.html'), { waitUntil: 'load' });
		const href = await page.$eval('a[data-lb]', (a) => a.getAttribute('href'));
		t.check('no-JS: gallery photos are plain links to the original image', /\.(jpg|jpeg|webp)$/i.test(href), href);
		await page.context().close();
	},

	async map() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		await page.goto(U('index.html'), { waitUntil: 'load' });
		await freezeHero(page);
		await page.evaluate(() => document.querySelector('#map').scrollIntoView({ block: 'center', behavior: 'instant' }));
		await page.waitForTimeout(1500);
		const pins = await page.$$eval('.atlas .pin', (els) => els.map((e) => ({ c: e.classList.contains('pin--cluster'), n: e.getAttribute('aria-label') })));
		t.check('map: pins are drawn (clusters have real accessible names)', pins.length > 0 && pins.filter((p) => p.c).every((p) => /^\d+ stories (near|in) .+ — open list$/.test(p.n)), JSON.stringify(pins.slice(0, 3)));
		const chips = await page.$$eval('.atlas__regions .chip', (els) => els.map((e) => e.textContent.trim()));
		t.check('map: region chips come from the data (World + regions with stories)', chips[0] === 'World' && chips.includes('North America') && chips.includes('Europe') && !chips.includes('Oceania'), chips.join(','));
		// no overlapping bubbles
		const overlap = await page.evaluate(() => { const r = [...document.querySelectorAll('.atlas .pin__hit')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0); for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const dx = (r[i].left + r[i].width / 2) - (r[j].left + r[j].width / 2), dy = (r[i].top + r[i].height / 2) - (r[j].top + r[j].height / 2); if (Math.hypot(dx, dy) < (r[i].width + r[j].width) / 2 - 3) return true; } return false; });
		t.check('map: no two bubbles overlap', !overlap);
		const size = await page.evaluate(() => { const s = [...document.querySelectorAll('.pin--cluster')].map((e) => ({ n: +e.getAttribute('aria-label').split(' ')[0], w: e.querySelector('.pin__hit').getBoundingClientRect().width })).sort((a, b) => a.n - b.n); return s; });
		t.check('map: bigger clusters get bigger bubbles (sqrt scale, capped)', size.length < 2 || size[size.length - 1].w >= size[0].w && size.every((s) => s.w <= 46.5), JSON.stringify(size));
		// zoom to a region, hover a single pin, read the card
		await page.locator('.atlas__regions .chip', { hasText: 'North America' }).click();
		await page.waitForTimeout(1500);
		let single = null;
		for (let k = 0; k < 4 && !single; k++) {
			const loc = page.locator('.atlas .pin:not(.pin--cluster):not([style*="display: none"])'); // pins outside the region in view are display:none
			if (await loc.count()) { single = loc.first(); break; }
			const cl = page.locator('.atlas .pin--cluster:not([style*="display: none"])'); if (!(await cl.count())) break;
			await cl.first().locator('.pin__hit').click(); await page.waitForTimeout(1500);
		}
		t.check('map: a region chip and cluster clicks zoom until single pins appear', !!single);
		if (single) {
			await single.locator('.pin__hit').hover(); await page.waitForTimeout(500);
			const pop = await page.$eval('.atlas__pop', (e) => ({ open: e.classList.contains('is-open'), text: e.textContent.replace(/\s+/g, ' ').trim(), href: (e.querySelector('a') || {}).href }));
			t.check('map: hovering a pin shows the photo card (date, coordinates, View story)', pop.open && /View story/.test(pop.text) && /\d+\.\d°[NS]/.test(pop.text) && /20\d\d/.test(pop.text), pop.text);
			await page.mouse.move(5, 5); await page.waitForTimeout(500);
			// keyboard: focus the pin, the card opens, Esc closes and keeps focus on the pin
			await single.focus(); await page.waitForTimeout(300);
			t.check('map: focusing a pin opens the card', await page.$eval('.atlas__pop', (e) => e.classList.contains('is-open')));
			await page.keyboard.press('Escape'); await page.waitForTimeout(300);
			t.check('map: Esc closes the card and the pin keeps focus', !(await page.$eval('.atlas__pop', (e) => e.classList.contains('is-open'))) && (await page.evaluate(() => document.activeElement.classList.contains('pin'))));
		}
		// back to the world, open a cluster list with the keyboard
		await page.locator('.atlas__regions .chip', { hasText: 'World' }).click();
		await page.waitForTimeout(1500);
		const cluster = page.locator('.atlas .pin--cluster').first();
		await cluster.focus();
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1600);
		t.check('map: Enter on a cluster zooms or opens its list (never nothing)', (await page.locator('.atlas .pin:not(.pin--cluster)').count()) > 0 || (await page.locator('.atlas__pop.is-open .pop__row').count()) > 0);
		t.check('map: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async mapTouch() {
		const page = await newPage(browser, { w: 390, h: 844, mobile: true, dpr: 2 });
		await page.goto(U('index.html'), { waitUntil: 'load' });
		await page.evaluate(() => document.querySelector('#map').scrollIntoView({ block: 'center', behavior: 'instant' }));
		await page.waitForTimeout(1500);
		const view = await page.$eval('.atlas__view', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, parent: e.parentElement.getBoundingClientRect().width }; });
		t.check('map (phone): the panel fits its container and is not a tall empty box', view.w <= view.parent + 1 && view.h >= 180 && view.h <= 480, JSON.stringify(view));
		const vis = await page.evaluate(() => { const v = document.querySelector('.atlas__view').getBoundingClientRect(); return [...document.querySelectorAll('.atlas .pin')].filter((p) => p.style.display !== 'none').map((p) => { const r = p.querySelector('.pin__hit').getBoundingClientRect(); return r.left >= v.left - 1 && r.right <= v.right + 1 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1; }); });
		t.check('map (phone): every cluster sits inside the panel', vis.length > 0 && vis.every(Boolean), JSON.stringify(vis));
		const halo = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.atlas .pin')].map((p) => parseFloat(getComputedStyle(p, '::before').width) || 0)));
		t.check('map (phone): glow radius is capped (<= 64px diameter)', halo <= 66, String(halo));
		const hit = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.atlas .pin__hit')].map((e) => e.getBoundingClientRect().width)));
		t.check('map (phone): tap targets are at least 44px', hit >= 43.5, String(hit));
		// zoom in with the Europe chip; tap pins/clusters the way a thumb would
		await page.locator('.atlas__regions .chip', { hasText: 'Europe' }).tap();
		await page.waitForTimeout(1600);
		let listOpen = false;
		for (let k = 0; k < 4 && !listOpen && !(await page.locator('.atlas .pin:not(.pin--cluster)').count()); k++) {
			const cl = page.locator('.atlas .pin--cluster:not([style*="display: none"]) .pin__hit').first();
			if (!(await cl.count())) break;
			await cl.tap(); await page.waitForTimeout(1600);
			listOpen = (await page.locator('.atlas__pop.is-open .pop__row').count()) > 0;
		}
		const pin = page.locator('.atlas .pin:not(.pin--cluster):not([style*="display: none"])');
		if (await pin.count()) {
			const box = await pin.first().locator('.pin__hit').boundingBox();
			await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
			await page.waitForTimeout(500);
			t.check('map (phone): the first tap on a pin opens the preview card without leaving the page', (await page.$eval('.atlas__pop', (e) => e.classList.contains('is-open') && e.classList.contains('is-live'))) && page.url().endsWith('index.html'));
			await page.locator('.atlas__pop .pop__card').tap(); await page.waitForURL('**/blog/pages/*.html', { timeout: 8000 });
			t.check('map (phone): tapping the card opens the story', /\/blog\/pages\//.test(page.url()));
		} else {
			t.check('map (phone): a cluster that cannot zoom further opens a tappable list', listOpen && (await page.locator('.atlas__pop.is-open .pop__row').count()) >= 2);
			await page.locator('.atlas__pop .pop__row').first().tap(); await page.waitForURL('**/blog/pages/*.html', { timeout: 8000 });
			t.check('map (phone): tapping a row in the list opens the story', /\/blog\/pages\//.test(page.url()));
		}
		await page.context().close();
	},

	async timeline() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		await page.goto(U('blog/index.html'), { waitUntil: 'load' });
		await freezeHero(page);
		await page.waitForTimeout(500);
		const total = stories.length;
		t.check('index: one tile per story', (await page.locator('.tile').count()) === total, String(await page.locator('.tile').count()));
		for (const y of [...new Set(stories.map((s) => s.year))]) t.check(`index: ${y} group lays out in complete rows`, (await rowsComplete(page, `.ygroup[data-year="${y}"]`)) === 'ok', await rowsComplete(page, `.ygroup[data-year="${y}"]`));
		// the rail is sticky, has a histogram and follows scrolling
		const railRows = await page.$$eval('.rail__row', (els) => els.map((e) => [e.getAttribute('data-year'), e.querySelector('[data-n]').textContent]));
		t.check('timeline: "All" + one row per year with the right counts', railRows.length === new Set(stories.map((s) => s.year)).size + 1 && railRows.every(([y, n]) => +n === (y ? stories.filter((s) => s.year === y).length : total)), JSON.stringify(railRows));
		t.check('timeline: histogram bars are drawn', (await page.locator('.rail__bar b').count()) === railRows.length);
		await page.evaluate(() => document.querySelector('.ygroup[data-year="2016"]').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.waitForTimeout(600);
		await page.evaluate(() => window.scrollBy(0, 200)); await page.waitForTimeout(600);
		t.check('timeline: scroll-spy marks the year in view', await page.$eval('.rail__row[data-year="2016"]', (e) => e.classList.contains('is-current')));
		const railTop = await page.$eval('.rail', (e) => e.getBoundingClientRect().top);
		t.check('timeline: the rail stays sticky while scrolling', railTop > 60 && railTop < 140, String(railTop));
		t.check('timeline: the minimap is shown on desktop', await page.locator('.dock').isVisible());
		// click a year to filter
		await page.locator('.rail__row[data-year="2016"]').click(); await page.waitForTimeout(700);
		const n2016 = stories.filter((s) => s.year === '2016').length;
		t.check('timeline: clicking a year filters to it and updates the hash', (await page.locator('.tile:not([hidden])').count()) === n2016 && (await page.evaluate(() => location.hash)) === '#year=2016', await page.evaluate(() => location.hash));
		t.check('timeline: the filtered group still lays out in complete rows', (await rowsComplete(page, '.ygroup[data-year="2016"]')) === 'ok');
		await page.locator('.rail__row[data-year=""]').click(); await page.waitForTimeout(500);
		t.check('timeline: "All" resets the filter and clears the hash', (await page.locator('.tile:not([hidden])').count()) === total && (await page.evaluate(() => location.hash)) === '');
		t.check('index: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async filters() {
		const page = await newPage(browser, { w: 1440, h: 1000 });
		await page.goto(U('blog/index.html'), { waitUntil: 'load' });
		await freezeHero(page);
		await page.waitForTimeout(500);
		const withTag = (tag) => stories.filter((s) => s.tags.includes(tag));
		await page.locator('.filters .chip[data-tag="mountains"]').click(); await page.waitForTimeout(600);
		const m = withTag('mountains');
		t.check('filters: a tag chip narrows the grid', (await page.locator('.tile:not([hidden])').count()) === m.length, `${await page.locator('.tile:not([hidden])').count()} vs ${m.length}`);
		t.check('filters: the hash records the tag', (await page.evaluate(() => location.hash)) === '#tag=mountains');
		const yc = await page.$$eval('.rail__row', (els) => els.map((e) => [e.getAttribute('data-year'), +e.querySelector('[data-n]').textContent]));
		t.check('filters: year counts recount against the active tag (faceted)', yc.every(([y, n]) => n === (y ? m.filter((s) => s.year === y).length : m.length)), JSON.stringify(yc));
		const tc0 = await page.$$eval('.filters .chip[data-tag]', (els) => els.map((e) => [e.getAttribute('data-tag'), +e.querySelector('.n').textContent]));
		t.check('filters: tag chips count against the other facet only (no year chosen = all stories)', tc0.every(([tag, n]) => n === (tag ? withTag(tag).length : stories.length)), JSON.stringify(tc0.slice(0, 4)));
		await page.locator('.rail__row[data-year="2016"]').click(); await page.waitForTimeout(500);
		const tc = await page.$$eval('.filters .chip[data-tag]', (els) => els.map((e) => [e.getAttribute('data-tag'), +e.querySelector('.n').textContent, e.classList.contains('is-zero')]));
		const y16 = stories.filter((s) => s.year === '2016');
		t.check('filters: tag counts recount inside the chosen year (faceted)', tc.every(([tag, n]) => n === (tag ? y16.filter((s) => s.tags.includes(tag)).length : y16.length)), JSON.stringify(tc.slice(0, 4)));
		t.check('filters: tags with nothing in that year are dimmed', tc.every(([tag, n, z]) => z === (n === 0 && tag !== 'mountains')), JSON.stringify(tc.filter((x) => x[2])));
		await page.locator('.rail__row[data-year="2016"]').click(); await page.waitForTimeout(400);
		for (const y of [...new Set(m.map((s) => s.year))]) t.check(`filters: ${y} stays in complete rows with the tag on`, (await rowsComplete(page, `.ygroup[data-year="${y}"]`)) === 'ok', await rowsComplete(page, `.ygroup[data-year="${y}"]`));
		t.check('filters: the summary says how many are shown', (await page.$eval('#summary', (e) => e.textContent.replace(/\s+/g, ' '))).includes(`${m.length} / ${stories.length}`));
		// an impossible combination shows the empty state
		await page.locator('.rail__row[data-year="2017"]').click(); await page.waitForTimeout(400);
		await page.locator('.filters .chip[data-tag="desert"]').click(); await page.waitForTimeout(400);
		const impossible = stories.filter((s) => s.year === '2017' && s.tags.includes('desert')).length === 0;
		t.check('filters: an impossible combination shows "No stories match these filters."', impossible && (await page.locator('#empty').isVisible()) && /No stories match these filters\./.test(await page.locator('#empty').textContent()));
		await page.locator('.summary__clear').click(); await page.waitForTimeout(400);
		t.check('filters: Clear filters restores everything', (await page.locator('.tile:not([hidden])').count()) === stories.length && !(await page.locator('#empty').isVisible()));
		// deep links
		for (const [hash, y, tag] of [['#year=2016&tag=mountains', '2016', 'mountains'], ['#tag=city', '', 'city'], ['#year=2018', '2018', '']]) {
			await page.goto(U('blog/index.html') + hash, { waitUntil: 'load' }); await page.waitForTimeout(900);
			const want = stories.filter((s) => (!y || s.year === y) && (!tag || s.tags.includes(tag))).length;
			t.check(`filters: deep link ${hash} restores the state`, (await page.locator('.tile:not([hidden])').count()) === want, `${await page.locator('.tile:not([hidden])').count()} vs ${want}`);
			t.check(`filters: deep link ${hash} scrolls to the list`, (await page.evaluate(() => window.scrollY)) > 600);
			const pinSum = await page.$$eval('.atlas .pin', (els) => els.reduce((n, e) => n + (e.classList.contains('pin--cluster') ? parseInt(e.getAttribute('aria-label'), 10) : 1), 0));
			t.check(`filters: deep link ${hash} filters the map too (${pinSum} pinned stories)`, pinSum === want, `${pinSum} vs ${want}`);
		}
		await page.goto(U('blog/index.html') + '#tag=nonsense&year=1999', { waitUntil: 'load' }); await page.waitForTimeout(700);
		t.check('filters: unknown tag/year in the hash are ignored', (await page.locator('.tile:not([hidden])').count()) === stories.length);
		t.check('filters: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async phoneIndex() {
		const page = await newPage(browser, { w: 390, h: 844, mobile: true, dpr: 2 });
		await page.goto(U('blog/index.html'), { waitUntil: 'load' });
		await freezeHero(page);
		await page.evaluate(() => document.querySelector('#list').scrollIntoView({ block: 'start', behavior: 'instant' }));
		await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(700);
		const rail = await page.$eval('.rail', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, h: r.height, pos: getComputedStyle(e).position }; });
		t.check('phone index: the year chip bar sticks under the header', rail.pos === 'sticky' && Math.abs(rail.top - 64) <= 2, JSON.stringify(rail));
		t.check('phone index: the minimap is hidden', !(await page.locator('.dock').isVisible()));
		const chipTap = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.rail__row')].map((e) => e.getBoundingClientRect().height)));
		t.check('phone index: chips are at least 44px tall', chipTap >= 43.5, String(chipTap));
		const tog = page.locator('.filters__toggle');
		t.check('phone index: filters collapse into a single "Filter" disclosure', (await tog.isVisible()) && (await tog.getAttribute('aria-expanded')) === 'false' && !(await page.locator('.filters__panel').isVisible()));
		await page.evaluate(() => document.querySelector('.filters').scrollIntoView({ block: 'center', behavior: 'instant' }));
		await tog.tap(); await page.waitForTimeout(300);
		t.check('phone index: the disclosure opens the tag chips (one scrolling row)', (await tog.getAttribute('aria-expanded')) === 'true' && (await page.locator('.filters__panel').isVisible()) && (await page.$eval('.filters__row', (e) => e.scrollWidth > e.clientWidth + 20)));
		await page.locator('.filters .chip[data-tag="snow"]').tap(); await page.waitForTimeout(500);
		t.check('phone index: a tag filters the list and the Filter button shows 1 active', (await page.locator('.tile:not([hidden])').count()) === stories.filter((s) => s.tags.includes('snow')).length && (await page.$eval('[data-filter-n]', (e) => e.textContent)) === '1');
		await page.locator('.summary__clear').tap(); await page.waitForTimeout(400);
		for (const y of [...new Set(stories.map((s) => s.year))]) t.check(`phone index: ${y} lays out in complete rows`, (await rowsComplete(page, `.ygroup[data-year="${y}"]`)) === 'ok', await rowsComplete(page, `.ygroup[data-year="${y}"]`));
		const tiles = await page.evaluate(() => { const s = [...document.querySelectorAll('.tile:not([hidden]) .tile__over')].map((e) => ({ op: getComputedStyle(e).opacity, bg: getComputedStyle(e).backgroundImage.startsWith('linear-gradient'), al: getComputedStyle(e).alignItems })); return { n: s.length, op: s.every((x) => x.op === '1'), grad: s.every((x) => x.bg), left: s.every((x) => x.al === 'flex-start') }; });
		t.check('phone index: tile captions are a bottom gradient, left-aligned, always visible', tiles.op && tiles.grad && tiles.left, JSON.stringify(tiles));
		await page.context().close();
	},

	async fileProtocol() {
		// the pages also work when opened straight from disk (no server, no fetch)
		const page = await newPage(browser, { w: 1440, h: 900 });
		const base = 'file://' + SITE_ROOT;
		await page.goto(`${base}/index.html`, { waitUntil: 'load' }); await page.waitForTimeout(1500);
		t.check('file://: the hub loads, the terminal runs, the map draws', (await page.$$eval('#terminal-card .t-line', (e) => e.length)) > 0 && (await page.locator('.atlas .pin').count()) > 0);
		await page.goto(`${base}/blog/index.html#tag=city`, { waitUntil: 'load' }); await page.waitForTimeout(1200);
		t.check('file://: the story index filters from the hash', (await page.locator('.tile:not([hidden])').count()) === stories.filter((s) => s.tags.includes('city')).length);
		await page.goto(`${base}/blog/pages/amsterdam.html#photo-4`, { waitUntil: 'load' }); await page.waitForTimeout(1500);
		t.check('file://: a #photo-4 deep link opens the viewer', (await page.locator('.lb.is-open').count()) === 1 && /04 \/ /.test(await page.locator('.lb__count').textContent()));
		await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
		t.check('file://: the viewer keys work', (await page.evaluate(() => location.hash)) === '#photo-5');
		await page.keyboard.press('Escape'); await page.waitForTimeout(600);
		t.check('file://: Esc closes the viewer', (await page.locator('.lb.is-open').count()) === 0);
		t.check('file://: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async phoneMenu() {
		const page = await newPage(browser, { w: 390, h: 844, mobile: true });
		await page.goto(U('blog/index.html'), { waitUntil: 'load' });
		await freezeHero(page);
		const tg = page.locator('.bar__toggle');
		t.check('phone menu: the menu button is shown and the links are hidden', (await tg.isVisible()) && !(await page.locator('.bar__nav a').first().isVisible()));
		await tg.tap(); await page.waitForTimeout(500);
		t.check('phone menu: it opens (aria-expanded) and shows the five owner links', (await tg.getAttribute('aria-expanded')) === 'true' && (await page.locator('.bar__nav a:visible').count()) === 5 && (await page.locator('.bar__nav a').allTextContents()).join('|') === 'All sites|Home|Stories|About|Contact');
		await page.keyboard.press('Escape'); await page.waitForTimeout(400);
		t.check('phone menu: Esc closes it and returns focus to the button', (await tg.getAttribute('aria-expanded')) === 'false' && (await page.evaluate(() => document.activeElement.classList.contains('bar__toggle'))));
		await tg.tap(); await page.waitForTimeout(400);
		await page.locator('.bar__nav a', { hasText: 'About' }).tap(); await page.waitForTimeout(2600);   // smooth scroll over a long page
		t.check('phone menu: choosing a link closes the menu and scrolls to the section', (await tg.getAttribute('aria-expanded')) === 'false' && (await page.evaluate(() => document.querySelector('#about').getBoundingClientRect().top)) < 200);
		t.check('phone menu: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async post() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		await page.goto(U('blog/pages/amsterdam.html'), { waitUntil: 'load' });
		await page.waitForTimeout(800);
		t.check('post: the cover title is the h1', (await page.$eval('h1', (e) => e.textContent.trim())) === 'Amsterdam, NL');
		const facts = await page.$$eval('.facts dt', (els) => els.map((e) => e.textContent.trim().toLowerCase()));
		t.check('post: facts list Date, Location, Coordinates, Photos, Tags', ['date', 'location', 'coordinates', 'photos', 'tags'].every((k) => facts.includes(k)), facts.join(','));
		const tag = await page.$eval('.tagchip', (e) => e.getAttribute('href'));
		t.check('post: tags link back to the filtered index', /^\.\.\/index\.html#tag=[a-z-]+$/.test(tag), tag);
		t.check('post: the locator is sticky on desktop', (await page.$eval('.locator', (e) => getComputedStyle(e).position)) === 'sticky');
		// photo breaks: wide, never portrait, locator steps aside
		const breaks = await page.$$eval('.full img', (els) => els.map((i) => i.getAttribute('width') / i.getAttribute('height')));
		t.check('post: full-bleed photo breaks are inserted for a long story and are all wide frames', breaks.length >= 1 && breaks.every((r) => r >= 1.45), breaks.map((r) => r.toFixed(2)).join(','));
		await page.evaluate(() => { const f = document.querySelector('.full'); window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY - 250, behavior: 'instant' }); });
		await page.waitForTimeout(900);
		t.check('post: the sticky locator fades out when a full-bleed photo reaches it', await page.$eval('.locator', (e) => e.classList.contains('is-faded')));
		await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' })); await page.waitForTimeout(900);
		t.check('post: and is back while reading the text', !(await page.$eval('.locator', (e) => e.classList.contains('is-faded'))));
		// the gallery is justified from w/h: rows end flush
		const rows = await page.evaluate(() => { const items = [...document.querySelectorAll('.jg__item')].map((e) => e.getBoundingClientRect()); const box = document.querySelector('.jg').getBoundingClientRect(); const byTop = {}; items.forEach((r) => { (byTop[Math.round(r.top)] = byTop[Math.round(r.top)] || []).push(r); }); const keys = Object.keys(byTop).map(Number).sort((a, b) => a - b); const flush = keys.slice(0, -1).every((k) => { const row = byTop[k].sort((a, b) => a.left - b.left); return Math.abs(row[row.length - 1].right - box.right) <= 1.5 && Math.abs(row[0].left - box.left) <= 1.5; }); const hs = keys.slice(0, -1).map((k) => byTop[k][0].height); return { flush, rows: keys.length, minH: Math.min(...hs), maxH: Math.max(...hs) }; });
		t.check('post: justified gallery rows are flush on both sides', rows.flush, JSON.stringify(rows));
		const ratios = await page.evaluate(() => [...document.querySelectorAll('.jg__item')].map((e) => { const r = e.getBoundingClientRect(); return Math.abs(r.width / r.height - parseFloat(e.style.getPropertyValue('--r'))) / parseFloat(e.style.getPropertyValue('--r')); }));
		t.check('post: gallery tiles keep each photo\'s aspect ratio (no cropping)', Math.max(...ratios) < 0.02, Math.max(...ratios).toFixed(3));
		await page.evaluate(() => document.querySelector('.jg').scrollIntoView({ block: 'start', behavior: 'instant' })); await page.waitForTimeout(1500);
		const srcs = await page.$$eval('.jg__item img', (els) => els.slice(0, 6).map((i) => i.currentSrc.split('/').pop()));
		t.check('post: gallery uses WebP derivatives, not the 1800px originals', srcs.every((n) => /-(480|960)\.webp$/.test(n)), srcs.join(','));
		t.check('post: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();

		// small-phone gallery: two-up at 360 and 320
		for (const w of [320, 360, 375, 390]) {
			const p2 = await newPage(browser, { w, h: 740, mobile: true });
			await p2.goto(U('blog/pages/amsterdam.html'), { waitUntil: 'load' });
			const per = await p2.evaluate(() => { const items = [...document.querySelectorAll('.jg__item')].map((e) => e.getBoundingClientRect()); const byTop = {}; items.forEach((r) => { (byTop[Math.round(r.top)] = byTop[Math.round(r.top)] || []).push(r); }); const rows = Object.values(byTop); return { rows: rows.length, n: items.length, one: rows.filter((r) => r.length === 1).length, h: document.querySelector('.jg').getBoundingClientRect().height }; });
			t.check(`gallery @${w}px: photos sit two-up (not one per row)`, per.one <= Math.ceil(per.rows * 0.35) && per.rows < per.n * 0.75, JSON.stringify(per));
			await p2.context().close();
		}
	},

	async lightbox() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		await page.goto(U('blog/pages/amsterdam.html'), { waitUntil: 'load' });
		await page.waitForTimeout(800);
		const total = await page.locator('a[data-lb]').count();
		const tile = page.locator('.jg__item a').nth(5);
		await tile.scrollIntoViewIfNeeded(); await page.waitForTimeout(700);
		const idx6 = await tile.getAttribute('data-lb');
		await tile.click(); await page.waitForTimeout(900);
		const open = () => page.locator('.lb.is-open').count();
		t.check('lightbox: opens on click', (await open()) === 1);
		t.check('lightbox: dialog semantics and a counter', (await page.$eval('.lb', (e) => e.getAttribute('role') === 'dialog' && e.getAttribute('aria-modal') === 'true')) && (await page.locator('.lb__count').textContent()).trim() === `${String(+idx6 + 1).padStart(2, '0')} / ${total}`);
		t.check('lightbox: the page behind is inert', await page.$eval('main', (e) => e.inert === true));
		t.check('lightbox: focus moves to Close', await page.evaluate(() => document.activeElement.classList.contains('lb__close')));
		t.check('lightbox: aria-live region announces the photo', /^Photo \d+ of \d+/.test(await page.$eval('.lb .vh', (e) => e.textContent)));
		const h0 = await page.evaluate(() => history.length);
		t.check('lightbox: #photo-N is in the address bar', (await page.evaluate(() => location.hash)) === `#photo-${+idx6 + 1}`);
		await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
		t.check('lightbox: → shows the next photo and updates the hash', (await page.evaluate(() => location.hash)) === `#photo-${+idx6 + 2}`);
		t.check('lightbox: moving between photos does not add history entries', (await page.evaluate(() => history.length)) === h0);
		await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500);
		t.check('lightbox: ← twice goes back two photos', (await page.evaluate(() => location.hash)) === `#photo-${+idx6}`);
		await page.keyboard.press('End'); await page.waitForTimeout(400);
		t.check('lightbox: End jumps to the last photo', (await page.evaluate(() => location.hash)) === `#photo-${total}`);
		await page.keyboard.press('Home'); await page.waitForTimeout(400);
		t.check('lightbox: Home jumps to the first photo', (await page.evaluate(() => location.hash)) === '#photo-1');
		await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
		t.check('lightbox: ← on the first photo wraps to the last', (await page.evaluate(() => location.hash)) === `#photo-${total}`);
		const trapped = [];
		for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); trapped.push(await page.evaluate(() => document.activeElement.className)); }
		t.check('lightbox: Tab cycles inside the dialog (focus trap)', trapped.every((c) => /lb__/.test(c)), trapped.join(' | '));
		await page.keyboard.press('Shift+Tab');
		t.check('lightbox: Shift+Tab stays inside too', /lb__/.test(await page.evaluate(() => document.activeElement.className)));
		// swipe left = next
		const box = await page.locator('.lb__stage').boundingBox();
		const before = await page.evaluate(() => location.hash);
		await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5); await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(700);
		t.check('lightbox: swiping left shows the next photo', (await page.evaluate(() => location.hash)) !== before);
		// swipe down closes
		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3); await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.75, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(800);
		t.check('lightbox: a long drag down closes it', (await open()) === 0);
		t.check('lightbox: closing returns focus to the photo that opened it and clears the hash', (await page.evaluate(() => location.hash)) === '' && (await page.evaluate(() => document.activeElement.getAttribute('data-lb'))) === idx6);
		t.check('lightbox: the page is usable again (not inert)', await page.$eval('main', (e) => e.inert === false));
		await tile.click(); await page.waitForTimeout(700);
		await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(900);
		t.check('lightbox: pressing Esc twice never leaves the story page', page.url().includes('/blog/pages/amsterdam.html') && (await open()) === 0);
		t.check('lightbox: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async history() {
		// The phone Back button/gesture must close the viewer and stay on the story page.
		const page = await newPage(browser, { w: 390, h: 844, mobile: true });
		await page.goto(U('blog/index.html'), { waitUntil: 'load' });
		await page.goto(U('blog/pages/rmnp.html'), { waitUntil: 'load' });
		await page.waitForTimeout(800);
		const tile = page.locator('.jg__item a').nth(2);
		await tile.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
		const len0 = await page.evaluate(() => history.length);
		await tile.tap(); await page.waitForTimeout(700);
		t.check('history: opening the viewer pushes exactly one entry', (await page.evaluate(() => history.length)) === len0 + 1 && (await page.locator('.lb.is-open').count()) === 1);
		await page.locator('.lb__nav--next').tap(); await page.waitForTimeout(300); await page.locator('.lb__nav--next').tap(); await page.waitForTimeout(500);
		const hash = await page.evaluate(() => location.hash);
		t.check('history: changing photos keeps history flat', (await page.evaluate(() => history.length)) === len0 + 1 && hash === '#photo-5', hash);
		await page.goBack(); await page.waitForTimeout(700);
		t.check('history: Back closes the viewer and stays on the story page', page.url().endsWith('/blog/pages/rmnp.html') && (await page.locator('.lb.is-open').count()) === 0);
		t.check('history: after Back the focus is back on the photo and the page is not inert', (await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-lb'))) && (await page.$eval('main', (e) => e.inert === false)));
		await page.goForward(); await page.waitForTimeout(700);
		t.check('history: Forward re-opens the viewer on the same photo', (await page.locator('.lb.is-open').count()) === 1 && (await page.evaluate(() => location.hash)) === '#photo-5');
		await page.goBack(); await page.waitForTimeout(500);
		await page.goBack(); await page.waitForTimeout(900);
		t.check('history: a second Back leaves the story for the page before it', page.url().endsWith('/blog/index.html'));
		// closing with the X after a push uses Back under the hood: still one entry only
		await page.goForward(); await page.waitForTimeout(900);
		const t2 = page.locator('.jg__item a').nth(1); await t2.scrollIntoViewIfNeeded(); await t2.tap(); await page.waitForTimeout(600);
		const l1 = await page.evaluate(() => history.length);
		await page.locator('.lb__close').tap(); await page.waitForTimeout(800);
		t.check('history: closing with the button returns to the page with the hash cleared', (await page.locator('.lb.is-open').count()) === 0 && (await page.evaluate(() => location.hash)) === '' && page.url().endsWith('rmnp.html'));
		// deep link: opens without pushing; Esc clears the hash; Back leaves the page
		await page.goto(U('blog/pages/rmnp.html#photo-7'), { waitUntil: 'load' }); await page.waitForTimeout(900);
		t.check('history: a #photo-7 deep link opens the viewer on photo 7', (await page.locator('.lb.is-open').count()) === 1 && /07 \/ /.test(await page.locator('.lb__count').textContent()));
		await page.keyboard.press('Escape'); await page.waitForTimeout(600);
		t.check('history: Esc on a deep link closes it and clears the hash (no extra history entry)', (await page.locator('.lb.is-open').count()) === 0 && (await page.evaluate(() => location.hash)) === '' && page.url().endsWith('rmnp.html'));
		// typing a #photo hash by hand (hashchange + popstate fire together): handled once
		await page.evaluate(() => { location.hash = '#photo-3'; }); await page.waitForTimeout(700);
		t.check('history: a hash edit opens the viewer once', (await page.locator('.lb.is-open').count()) === 1 && /03 \/ /.test(await page.locator('.lb__count').textContent()));
		await page.goBack(); await page.waitForTimeout(600);
		t.check('history: Back from a hash edit closes the viewer', (await page.locator('.lb.is-open').count()) === 0);
		t.check('history: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},

	async navigation() {
		const page = await newPage(browser, { w: 1440, h: 900 });
		let ok = 0, bad = [];
		for (let i = 0; i < stories.length; i++) {
			await page.goto(U(stories[i].href), { waitUntil: 'domcontentloaded' });
			const r = await page.evaluate(() => ({ prev: (document.querySelector('a[rel=prev]') || {}).getAttribute && document.querySelector('a[rel=prev]').getAttribute('href'), next: (document.querySelector('a[rel=next]') || {}).getAttribute && document.querySelector('a[rel=next]').getAttribute('href'), all: document.querySelector('.snav--all').getAttribute('href') }));
			const older = stories[i + 1], newer = stories[i - 1];
			const expPrev = older ? `${older.slug}.html` : null, expNext = newer ? `${newer.slug}.html` : null;
			if ((r.prev || null) === expPrev && (r.next || null) === expNext && r.all === '../index.html#list') ok++; else bad.push(`${stories[i].slug}: prev=${r.prev} (want ${expPrev}) next=${r.next} (want ${expNext})`);
		}
		t.check('navigation: Previous (older) / Next (newer) links are right on every story', bad.length === 0, bad.slice(0, 3).join(' | '));
		await page.goto(U('blog/index.html'), { waitUntil: 'load' }); await freezeHero(page);
		await page.evaluate(() => document.querySelector('.tile').scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(500);
		await Promise.all([page.waitForURL('**/blog/pages/*.html'), page.locator('.tile:not([hidden]) a').first().click()]);
		t.check('navigation: a tile opens its story', /\/blog\/pages\/[a-z0-9-]+\.html$/.test(page.url()));
		await page.goBack(); await page.waitForTimeout(900);
		t.check('navigation: Back returns to the index with the scroll position kept', page.url().endsWith('/blog/index.html') && (await page.evaluate(() => window.scrollY)) > 300, String(await page.evaluate(() => window.scrollY)));
		// Back from a story to a FILTERED index keeps the reader where they were (the list is not re-scrolled to its top)
		await page.goto(U('blog/index.html') + '#tag=mountains', { waitUntil: 'load' }); await freezeHero(page); await page.waitForTimeout(900);
		await page.evaluate(() => window.scrollBy(0, 700)); await page.waitForTimeout(500);
		const yBefore = await page.evaluate(() => Math.round(window.scrollY));
		await Promise.all([page.waitForURL('**/blog/pages/*.html'), page.locator('.tile:not([hidden]) a').nth(2).click()]);
		await page.goBack(); await page.waitForTimeout(1200);
		t.check('navigation: Back to a filtered index keeps the scroll position and the filter', Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - yBefore) < 400 && (await page.evaluate(() => location.hash)) === '#tag=mountains' && (await page.locator('.tile:not([hidden])').count()) === stories.filter((s) => s.tags.includes('mountains')).length, `${yBefore} -> ${await page.evaluate(() => Math.round(window.scrollY))}`);
		// a tag on a story opens the filtered index
		await page.goto(U('blog/pages/bigbend.html'), { waitUntil: 'load' });
		await Promise.all([page.waitForURL('**/index.html#tag=*'), page.locator('.tagchip').first().click()]);
		await page.waitForTimeout(1200);
		const tg = await page.evaluate(() => location.hash.replace('#tag=', ''));
		t.check('navigation: a story tag opens the filtered index', (await page.locator('.tile:not([hidden])').count()) === stories.filter((s) => s.tags.includes(tg)).length, tg);
		t.check('navigation: no console errors', page.problems.length === 0, page.problems.join(' | '));
		await page.context().close();
	},
};

(async () => {
	srv = await start({ root: SITE_ROOT });
	URL_ = srv.url;
	stories = sitePages().stories;
	browser = await launch();
	try {
		for (const [name, fn] of Object.entries(scenarios)) {
			if (only.length && !only.includes(name)) continue;
			try { await fn(); } catch (e) { t.check(`${name} (exception)`, false, e.message.split('\n')[0]); }
		}
	} finally { await browser.close(); await srv.close(); }
	process.exit(t.summary() ? 0 : 1);
})();
