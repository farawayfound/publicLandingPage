#!/usr/bin/env node
'use strict';
/* Accessibility spot checks that can be automated: landmarks, heading order, accessible names, skip link, visible focus,
 * AA colour contrast of text on solid backgrounds (peach on white must use the deeper --accent-ink), touch target sizes.
 * Text over photographs cannot be checked by a script from the stylesheet alone; the hero scrim is tuned by measuring pixels
 * (see README, "Testing").
 *   node tests/a11y.js */
const { launch, start, SITE_ROOT, Tester, newPage, freezeHero } = require('./lib');

const t = new Tester('a11y');

/* runs in the page: contrast of an element's text colour against the composited background behind it */
const CONTRAST = `(sel) => {
	const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
	const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
	const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
	const el = document.querySelector(sel); if (!el) return null;
	const layers = []; for (let e = el; e; e = e.parentElement) { const bg = parse(getComputedStyle(e).backgroundColor); if (bg && bg.a > 0) layers.push(bg); if (bg && bg.a === 1) break; }
	let base = { r: 15, g: 5, b: 30, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
	const fg0 = parse(getComputedStyle(el).color); const fg = over(fg0, base);
	const a = lum(fg), b = lum(base), hi = Math.max(a, b), lo = Math.min(a, b);
	const fs = parseFloat(getComputedStyle(el).fontSize), bold = parseInt(getComputedStyle(el).fontWeight, 10) >= 700;
	return { ratio: (hi + 0.05) / (lo + 0.05), large: fs >= 24 || (bold && fs >= 18.66), fs };
}`;

const SAMPLES = {
	'index.html': [['.card__label', 'peach label on the white card'], ['.card__cta', 'peach call to action on the white card'], ['.card h2', 'card title'], ['.card p', 'card text'], ['.hero__badge', 'pill text on white'], ['.latest .title', 'Latest stories'], ['.link-arrow', 'All stories link'], ['.stats dt', 'map stat label'], ['.stats dd', 'map stat value'], ['.foot p', 'footer text'], ['.foot a', 'footer link'], ['.atlas__regions .chip', 'region chip']],
	'blog/index.html': [['.intro .eyebrow', 'counts line'], ['.intro .lead', 'intro paragraph'], ['.display', 'Stories heading'], ['.filters .chip', 'tag chip'], ['.filters .chip[aria-pressed="true"]', 'pressed tag chip'], ['.rail__y', 'rail year'], ['.rail__n', 'rail count'], ['.summary', 'summary line'], ['.ygroup__meta', 'year count'], ['.about__meta', 'about line'], ['.about__text', 'about text'], ['.contact__p', 'contact text'], ['.contact .btn', 'button (ink on peach)'], ['.foot p', 'footer']],
	'blog/pages/rmnp.html': [['.story__body > p.is-lead', 'lead paragraph'], ['.story__body > p:not(.is-lead)', 'body paragraph'], ['.story__title', 'section title'], ['.facts dt', 'fact label'], ['.facts dd', 'fact value'], ['.tagchip', 'tag chip'], ['.row-head .muted', 'photo count'], ['.snav__all', 'all-stories count'], ['.foot a', 'footer link']],
};

const TARGETS = [['.chip', 44, 'filter/region chip'], ['.rail__row', 44, 'year chip'], ['.ticker__pause', 44, 'slideshow pause'], ['.pin__hit', 44, 'map pin'], ['.bar__toggle', 44, 'menu button'], ['.filters__toggle', 44, 'Filter button'], ['.summary__clear', 24, 'Clear filters'], ['.tagchip', 24, 'tag chip on a story']];

(async () => {
	const srv = await start({ root: SITE_ROOT });
	const browser = await launch();
	try {
		for (const rel of ['index.html', 'blog/index.html', 'blog/pages/rmnp.html', 'blog/pages/amsterdam.html']) {
			const page = await newPage(browser, { w: 1440, h: 900 });
			await page.goto(`${srv.url}/${rel}`, { waitUntil: 'load' });
			await page.waitForTimeout(700);
			await freezeHero(page);
			const r = await page.evaluate(() => {
				const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.offsetParent !== null || getComputedStyle(h).position === 'fixed').map((h) => +h.tagName[1]);
				let jumps = 0; heads.forEach((l, i) => { if (i === 0 ? l !== 1 : l > heads[i - 1] + 1) jumps++; });
				const name = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby')) && document.getElementById(e.getAttribute('aria-labelledby')).textContent) || e.textContent || (e.querySelector('img') && e.querySelector('img').alt) || e.title || '').trim();
				const unnamed = [...document.querySelectorAll('a[href], button, [role=button]')].filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 80));
				const navs = [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'));
				const skip = document.querySelector('a.skip');
				return {
					heads, jumps, unnamed, navs, banner: document.querySelectorAll('body > header, header[role=banner]').length, mains: document.querySelectorAll('main').length, footers: document.querySelectorAll('footer').length,
					skip: !!skip && skip.getAttribute('href') === '#main' && !!document.getElementById('main'), firstFocus: document.querySelector('a, button') === skip,
					pressed: [...document.querySelectorAll('.chip, .rail__row, .ticker__pause')].every((b) => b.hasAttribute('aria-pressed')),
					lang: document.documentElement.lang, regions: [...document.querySelectorAll('section[aria-label],section[aria-labelledby]')].length,
				};
			});
			t.check(`${rel}: landmarks (banner, main, footer) and labelled navs`, r.banner === 1 && r.mains === 1 && r.footers === 1 && r.navs.every(Boolean), JSON.stringify(r.navs));
			t.check(`${rel}: heading levels never skip (${r.heads.join('')})`, r.jumps === 0, JSON.stringify(r.heads));
			t.check(`${rel}: every link and button has an accessible name`, r.unnamed.length === 0, r.unnamed.slice(0, 3).join(' | '));
			t.check(`${rel}: skip link is first and targets #main`, r.skip && r.firstFocus);
			t.check(`${rel}: toggle buttons expose aria-pressed`, r.pressed);
			// visible focus on the first 20 tab stops
			let blind = [];
			for (let i = 0; i < 20; i++) {
				await page.keyboard.press('Tab');
				const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const inner = e.querySelector && e.querySelector('.pin__hit'); const si = inner ? getComputedStyle(inner) : null; const ring = (x) => x && x.outlineStyle !== 'none' && parseFloat(x.outlineWidth) > 0; return { tag: e.tagName + '.' + (e.className || ''), ok: ring(s) || ring(si) || s.boxShadow !== 'none' || e.classList.contains('skip') || !!e.closest('.tile, .jg__item, .poster, .card') }; });
				if (f && !f.ok) blind.push(f.tag);
			}
			t.check(`${rel}: the first 20 tab stops all show a focus indicator`, blind.length === 0, blind.slice(0, 3).join(', '));
			// contrast
			for (const [sel, what] of SAMPLES[rel] || []) {
				const c = await page.evaluate(`(${CONTRAST})(${JSON.stringify(sel)})`);
				if (!c) { t.check(`${rel}: contrast of ${what}`, false, `no element ${sel}`); continue; }
				const need = c.large ? 3 : 4.5;
				t.check(`${rel}: ${what} has AA contrast (${c.ratio.toFixed(2)}:1, needs ${need})`, c.ratio >= need, `${sel} ${c.ratio.toFixed(2)} fs=${c.fs}`);
			}
			t.check(`${rel}: no console errors`, page.problems.length === 0, page.problems.join(' | '));
			await page.context().close();
		}

		// touch target sizes on a phone
		for (const rel of ['index.html', 'blog/index.html', 'blog/pages/rmnp.html']) {
			const page = await newPage(browser, { w: 390, h: 844, mobile: true });
			await page.goto(`${srv.url}/${rel}`, { waitUntil: 'load' });
			await page.waitForTimeout(900);
			await freezeHero(page);
			if (rel === 'blog/index.html') { await page.evaluate(() => { const b = document.querySelector('.filters__toggle'); if (b) b.click(); }); await page.waitForTimeout(300); }
			for (const [sel, min, what] of TARGETS) {
				const sizes = await page.$$eval(sel, (els) => els.filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && s.visibility !== 'hidden' && !e.closest('[hidden]') && s.display !== 'none' && e.offsetParent !== null; }).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
				if (!sizes.length) continue;
				t.check(`${rel} (phone): ${what} is at least ${min}px`, Math.min(...sizes) >= min - 0.6, `${sel} min ${Math.min(...sizes).toFixed(1)}`);
			}
			await page.context().close();
		}
	} finally { await browser.close(); await srv.close(); }
	process.exit(t.summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
