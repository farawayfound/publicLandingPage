#!/usr/bin/env node
'use strict';
/* Every local file a generated page, data file or the stylesheet refers to exists on disk with EXACTLY that letter case
 * (the Raspberry Pi is case-sensitive; macOS and Windows are not). Also: no references to the old vendor files, and
 * every path in srcset/data-set is well formed (no unescaped spaces).
 *   node tests/links.js */
const fs = require('fs');
const path = require('path');
const { SITE_ROOT, sitePages, Tester } = require('./lib');
const { resolveExact } = require('./serve');

const t = new Tester('links');
const { pages, stories } = sitePages();
const exists = (abs) => { const r = resolveExact(SITE_ROOT, path.relative(SITE_ROOT, abs).split(path.sep).map(encodeURIComponent).join('/')); return !!r && fs.existsSync(r); };

function refsOf(html) {
	const out = [];
	for (const m of html.matchAll(/\s(?:src|href|poster|data-src)="([^"]*)"/g)) out.push(m[1]);
	for (const m of html.matchAll(/\s(?:srcset|imagesrcset|data-set|data-alt-set)="([^"]*)"/g)) m[1].split(/,\s+(?=\S)/).forEach((c) => out.push(c.trim().split(/\s+/)[0]));
	for (const m of html.matchAll(/FF_HERO=(\[[\s\S]*?\]);<\/script>/g)) { try { JSON.parse(m[1].replace(/\\u003c/g, '<')).forEach((i) => { out.push(i.src); String(i.set || '').split(/,\s+/).forEach((c) => out.push(c.trim().split(/\s+/)[0])); }); } catch (e) { out.push('!!FF_HERO unparsable'); } }
	return out.filter(Boolean);
}

let total = 0;
for (const rel of pages) {
	const file = path.join(SITE_ROOT, rel);
	const html = fs.readFileSync(file, 'utf8');
	const bad = [], vendor = [];
	for (const r of refsOf(html)) {
		if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(r) || r === '') continue;
		total++;
		const clean = r.split('#')[0].split('?')[0];
		if (!clean) continue;
		if (/ /.test(clean)) { bad.push(`unescaped space: ${r}`); continue; }
		const abs = path.resolve(path.dirname(file), decodeURIComponent(clean));
		if (!exists(abs)) bad.push(r);
		if (/bootstrap|jquery|flexslider|modernizr|animate\.css|lightbox|icomoon|style\.css/.test(clean)) vendor.push(r);
	}
	t.check(`${rel}: every local reference exists with the exact on-disk case`, bad.length === 0, bad.slice(0, 4).join(' | '));
	t.check(`${rel}: no reference to the old vendor CSS/JS`, vendor.length === 0, vendor.join(', '));
	t.check(`${rel}: no lower-case rainiernp path`, !/assets\/images\/rainiernp\//.test(html));
}

// data files + stylesheet
const data = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, 'assets/data/stories.json'), 'utf8'));
const missing = [];
for (const s of data) for (const f of [...s.card, ...s.cover]) if (!exists(path.join(SITE_ROOT, f.src))) missing.push(f.src);
t.check('assets/data/stories.json: every image it lists exists', missing.length === 0, missing.slice(0, 3).join(', '));
const sj = fs.readFileSync(path.join(SITE_ROOT, 'assets/data/stories.js'), 'utf8');
const compact = JSON.parse(sj.slice(sj.indexOf('=') + 1, sj.lastIndexOf(';')));
t.check('assets/data/stories.js: every thumbnail path exists', compact.every((s) => exists(path.join(SITE_ROOT, s.img)) && exists(path.join(SITE_ROOT, s.p))), '');
t.check('stories.js lists every story that has coordinates', compact.length === stories.filter((s) => s.coords).length);
const css = fs.readFileSync(path.join(SITE_ROOT, 'assets/css/ff.css'), 'utf8');
for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) if (!/^(data:|#|%23|https?:)/.test(m[1])) t.check(`ff.css: ${m[1]} exists`, exists(path.resolve(SITE_ROOT, 'assets/css', m[1].split('?')[0])));
if (fs.existsSync(path.join(SITE_ROOT, 'sitemap.xml'))) {
	const sm = fs.readFileSync(path.join(SITE_ROOT, 'sitemap.xml'), 'utf8');
	t.check('sitemap.xml lists every page once', (sm.match(/<loc>/g) || []).length === pages.length, String((sm.match(/<loc>/g) || []).length));
}
console.log(`  (${total} references checked)`);
process.exit(t.summary() ? 0 : 1);
