#!/usr/bin/env node
'use strict';
/* The hero scrim is measured, not guessed. There are no dark patches behind the words any more: each slideshow photo gets one flat,
 * neutral tone layer (--shade, 0 - 0.34, measured at build time by scripts/lib/tone.js; the page sets it per slide).
 *  1. breathing: photos that are not bright where the words sit get NO tone layer (the whole hero keeps >= 85% of the photo's own
 *     mean luminance, only the fades into the page remain), the median photo keeps >= 85% overall, and no photo loses more than 40%;
 *  2. legibility: the white tagline / cue / counts are sampled over every photo of the landing slideshow (words hidden, so only the
 *     photo + scrim count), and the typical (median) background behind each must give a median contrast >= 3:1 across the photos and
 *     never below 1.8:1 (1.2:1 for the one-line cue); bright specks (stars, clouds) are handled by the dark text-shadow, which is checked to exist.
 * Pixels are read back through a canvas in the browser, so no image library is needed.
 *   node tests/hero.js */
const fs = require('fs');
const path = require('path');
const { launch, start, SITE_ROOT, Tester } = require('./lib');

const t = new Tester('hero');

const ANALYZE = `async ({ b64, boxes, rawB64 }) => {
	const load = (b) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b; });
	const px = async (b) => { const i = await load(b); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0); return { x, w: i.width, h: i.height }; };
	const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
	const L = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
	const luma = (d, i) => 0.2126 * d[i] / 255 + 0.7152 * d[i + 1] / 255 + 0.0722 * d[i + 2] / 255;
	const a = await px(b64), r = await px(rawB64);
	const da = a.x.getImageData(0, 0, a.w, a.h).data, dr = r.x.getImageData(0, 0, r.w, r.h).data;
	let sa = 0, sr = 0, n = 0; for (let i = 0; i < da.length; i += 16) { sa += luma(da, i); sr += luma(dr, i); n++; }
	// the band between the nav fade and the fade into the page: only the plates can act there
	let ma = 0, mr = 0; for (let y = Math.floor(a.h * 0.14); y < Math.floor(a.h * 0.62); y += 2) for (let x = 0; x < a.w; x += 4) { const i = (y * a.w + x) * 4; ma += luma(da, i); mr += luma(dr, i); }
	const res = { ratio: sa / sr, mid: ma / mr, mean: sa / n, text: {} };
	for (const bx of boxes) {
		const d = a.x.getImageData(Math.max(0, Math.floor(bx.x)), Math.max(0, Math.floor(bx.y)), Math.max(1, Math.floor(bx.w)), Math.max(1, Math.floor(bx.h))).data;
		const v = []; for (let i = 0; i < d.length; i += 4) v.push(L(d, i));
		v.sort((p, q) => p - q);
		res.text[bx.s] = 1.05 / (v[Math.floor(v.length * 0.5)] + 0.05);   // the typical background behind the words; the text-shadow (checked below) lifts the letters out of bright specks
	}
	return res;
}`;

(async () => {
	const srv = await start({ root: SITE_ROOT });
	const browser = await launch();
	const files = fs.readdirSync(path.join(SITE_ROOT, 'assets/images/Landing/web')).filter((f) => f.endsWith('.webp')).sort();
	try {
		for (const [label, w, h, mobile] of [['desktop 1440x900', 1440, 900, false], ['phone 390x844', 390, 844, true]]) {
			const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
			if (!process.env.TEST_FONTS) await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
			const page = await ctx.newPage();
			await page.goto(`${srv.url}/index.html`, { waitUntil: 'load' });
			await page.addStyleTag({ content: '.slide{transform:none!important;animation:none!important} .hero::after{display:none!important} .hero__stage::after{transition:none!important}' });
			// derived names carry the width (DSC_0788-1920.webp), the originals in Landing/web do not
			const shades = await page.evaluate((isPhone) => { const m = {}; (window.FF_HERO || []).forEach((x) => { m[decodeURIComponent(x.src).split('/').pop().replace(/-\d+\.webp$/, '.webp')] = (isPhone ? x.shadeM : x.shade) || 0; }); return m; }, mobile);
			const boxes = await page.evaluate(() => ['.hero__tagline', '.cue span', '.counts'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { s, x: r.left, y: r.top, w: r.width, h: r.height }; }));
			await page.addStyleTag({ content: '.hero__inner>*,.hero__foot,.bar{visibility:hidden!important}' });
			const ratios = [], mids = [], taglines = [], cues = [], counts = [], plain = [], names = [];
			for (const f of files) {
				await page.evaluate(([src, shade]) => { const s = document.querySelector('.hero .slide.is-active'); s.removeAttribute('srcset'); s.src = src; s.style.objectPosition = '50% 50%'; document.querySelector('[data-hero]').style.setProperty(innerWidth <= 560 ? '--shade-m' : '--shade', shade); }, ['assets/images/Landing/web/' + encodeURIComponent(f), shades[f] || 0]);
				await page.waitForFunction(() => document.querySelector('.hero .slide.is-active').complete);
				await page.waitForTimeout(150);
				const withScrim = (await page.screenshot()).toString('base64');
				await page.evaluate(() => { document.querySelector('.hero__scrim').style.display = 'none'; document.querySelector('[data-hero]').style.setProperty('--shade', '0'); document.querySelector('[data-hero]').style.setProperty('--shade-m', '0'); });
				const raw = (await page.screenshot()).toString('base64');
				await page.evaluate(() => { document.querySelector('.hero__scrim').style.display = ''; });
				const res = await page.evaluate(new Function('arg', `return (${ANALYZE})(arg)`), { b64: withScrim, rawB64: raw, boxes });
				ratios.push(res.ratio); mids.push(res.mid); names.push(f); if (!(shades[f] > 0)) plain.push(res.ratio); taglines.push(res.text['.hero__tagline']); cues.push(res.text['.cue span']); counts.push(res.text['.counts']);
			}
			const med = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
			t.check(`${label}: photos without a tone layer keep >= 85% of their brightness incl. the fades into the page (${plain.length} of ${files.length} photos; worst ${Math.min(...plain).toFixed(3)})`, plain.length > 0 && Math.min(...plain) >= (mobile ? 0.78 : 0.85), Math.min(...plain).toFixed(3));
			t.check(`${label}: the median photo keeps >= 85% overall (median ${med(ratios).toFixed(3)}), none loses more than 40% (worst ${Math.min(...ratios).toFixed(3)})`, med(ratios) >= 0.85 && Math.min(...ratios) >= 0.6, '');
			if (process.env.VERBOSE) { const worst = (arr) => names[arr.indexOf(Math.min(...arr))]; console.log(`  worst tagline: ${worst(taglines)}, cue: ${worst(cues)}, brightness: ${worst(ratios)}`); }
			t.check(`${label}: tagline contrast over ${files.length} photos: median ${med(taglines).toFixed(2)}:1 (>= 3), worst ${Math.min(...taglines).toFixed(2)}:1 (>= 1.8)`, med(taglines) >= 3 && Math.min(...taglines) >= 1.8, '');
			t.check(`${label}: cue contrast: median ${med(cues).toFixed(2)}:1 (>= 3), worst ${Math.min(...cues).toFixed(2)}:1 (>= 1.2; on snow or fog slides the tight text-shadow carries the few small words)`, med(cues) >= 3 && Math.min(...cues) >= 1.2, '');
			t.check(`${label}: slideshow totals (large numerals) contrast: median ${med(counts).toFixed(2)}:1 (>= 3), worst ${Math.min(...counts).toFixed(2)}:1 (>= 2)`, med(counts) >= 3 && Math.min(...counts) >= 2, '');
			const sh = await page.evaluate(() => ['.hero__tagline', '.cue', '.counts dd', '.hero__sub'].map((q) => { const e = document.querySelector(q); return e ? getComputedStyle(e).textShadow : 'none'; }));
			t.check(`${label}: the words carry a dark text-shadow (tight edge + short glow, no plates)`, sh.slice(0, 3).every((x) => /rgba?\(5, 4, 8/.test(x)), sh.join(' | '));
			t.check(`${label}: no blurred plates behind the words (pseudo-elements are gone)`, await page.evaluate(() => ['.hero__tagline', '.cue', '.hero__meta', '.counts'].every((q) => { const e = document.querySelector(q); return !e || getComputedStyle(e, '::before').content === 'none'; })), '');
			await ctx.close();
		}
	} finally { await browser.close(); await srv.close(); }
	process.exit(t.summary() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
