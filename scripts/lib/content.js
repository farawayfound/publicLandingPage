'use strict';
/* Reads content/site.json and content/posts/*.json, validates them, normalises every image path to the on-disk
 * spelling and returns the model the templates render. Nothing here writes files.
 *
 * Hard errors (the build exits non-zero and writes nothing): unreadable JSON, missing slug/title/date, bad date,
 * duplicate slug, any image path that does not exist on disk, photos whose size cannot be determined.
 * Warnings: letter-case fixes, JSON w/h that disagree with the file, duplicate photos, unknown tags, missing coords.
 */
const fs = require('fs');
const path = require('path');
const { parseDate } = require('./util');

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

class Report {
	constructor() { this.warnings = []; this.errors = []; }
	warn(m) { this.warnings.push(m); }
	error(m) { this.errors.push(m); }
}

function readJson(file, report, what) {
	try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
	catch (e) { report.error(`${what}: cannot read ${file} (${e.message})`); return null; }
}

function loadSite(contentDir, report) {
	const file = path.join(contentDir, 'site.json');
	const s = readJson(file, report, 'site.json');
	if (!s) return null;
	for (const key of ['landing', 'blog', 'ui', 'site']) if (!s[key]) report.error(`site.json: missing "${key}" section`);
	s.site = s.site || {};
	s.site.url = String(s.site.url || process.env.SITE_URL || '').replace(/\/+$/, '');
	s.hero = s.hero || {};
	s.tagLabels = s.tagLabels || {};
	s.photoBreaks = s.photoBreaks || {};
	return s;
}

/**
 * @param {{contentDir:string, resolver:object, images:object, site:object, report:Report}} o
 * @returns {object[]} posts, newest first
 */
function loadPosts(o) {
	const { contentDir, resolver, images, site, report } = o;
	const dir = path.join(contentDir, 'posts');
	let files = [];
	try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); }
	catch (e) { report.error(`cannot read ${dir} (${e.message})`); return []; }

	const posts = [];
	const seen = new Map();
	for (const f of files) {
		const raw = readJson(path.join(dir, f), report, f);
		if (!raw) continue;
		const p = normalisePost(raw, f, { resolver, images, site, report });
		if (!p) continue;
		if (seen.has(p.slug)) { report.error(`${f}: duplicate slug "${p.slug}" (also in ${seen.get(p.slug)})`); continue; }
		seen.set(p.slug, f);
		posts.push(p);
	}
	posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? -1 : 1));
	return posts;
}

function normalisePost(raw, file, ctx) {
	const { resolver, images, site, report } = ctx;
	const where = file.replace(/\.json$/, '');
	const bad = (m) => report.error(`${where}: ${m}`);
	const warn = (m) => report.warn(`${where}: ${m}`);

	if (typeof raw.slug !== 'string' || !SLUG_RE.test(raw.slug)) { bad(`invalid or missing "slug" (${JSON.stringify(raw.slug)}); use letters, digits, "-" and "_"`); return null; }
	if (!raw.title || typeof raw.title !== 'string') { bad('missing "title"'); return null; }
	const d = parseDate(raw.date);
	if (!d) { bad(`"date" must look like 2016-12 or 2016-12-24 (got ${JSON.stringify(raw.date)})`); return null; }
	if (raw.slug !== file.replace(/\.json$/, '')) warn(`file name does not match slug "${raw.slug}" (the page is written to ${raw.slug}.html)`);

	const p = {
		slug: raw.slug,
		title: String(raw.title).trim(),
		cardTitle: String(raw.cardTitle || raw.title).trim(),
		subtitle: raw.subtitle ? String(raw.subtitle).trim() : '',
		date: raw.date,
		dateLabel: raw.dateLabel ? String(raw.dateLabel).trim() : d.label,
		year: d.year,
		location: String(raw.location || '').trim(),
		region: raw.region ? String(raw.region).trim() : '',
		country: String(raw.country || '').trim(),
		tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
		sectionTitle: String(raw.sectionTitle || '').trim(),
		paragraphs: Array.isArray(raw.paragraphs) ? raw.paragraphs.map((t) => String(t).trim()).filter(Boolean) : [],
		titleTag: raw.titleTag ? String(raw.titleTag).trim() : String((site.titleTags || {})[raw.slug] || '').trim(),  // optional: the browser-tab title when it differs from the page title
		scrollCue: String(raw.scrollCue || 'memories below').trim(),
		coverPosition: raw.coverPosition ? String(raw.coverPosition).trim() : String((site.hero.coverPositions || {})[raw.slug] || '').trim(),  // site.json -> hero.coverPositions: for stories whose JSON is not edited by hand
		heroShade: Number.isFinite(raw.heroShade) ? raw.heroShade : (Number.isFinite((site.hero.shade || {})[raw.slug]) ? site.hero.shade[raw.slug] : undefined),  // optional: force the flat darkening of the cover (0 - 0.6); default is measured
		legacy: raw.legacy === true,
		hero: typeof raw.hero === 'boolean' ? raw.hero : undefined,
		coords: null, lat: null, lon: null,
		cover: null, cardSrc: null, cardThumb: null, photos: [],
	};

	const c = raw.coords;
	if (Array.isArray(c) && c.length === 2 && c.every((v) => Number.isFinite(v)) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180) { p.coords = [c[0], c[1]]; p.lat = c[0]; p.lon = c[1]; }
	else warn('no usable "coords" ([lat, lon]); the story is listed but not placed on the map');
	if (!p.paragraphs.length) warn('no paragraphs');
	if (!p.location) warn('no "location"');
	if (!p.country) warn('no "country" (it will not count towards the countries total)');
	for (const t of p.tags) if (!/^[a-z0-9-]+$/.test(t)) warn(`odd tag "${t}" (use lowercase words joined by "-")`);

	let caseFixes = 0, caseExample = '';
	const fix = (rel, what) => {
		if (!rel || typeof rel !== 'string') return null;
		const r = resolver.resolve(rel);
		if (!r) { bad(`missing file ${rel} (${what})`); return null; }
		if (r.fixed) { caseFixes++; if (!caseExample) caseExample = `${rel} -> ${r.rel}`; }
		return r.rel;
	};

	p.cover = fix(raw.cover, 'cover');
	const cardThumb = raw.card ? fix(raw.card, 'card') : null;
	p.cardThumb = cardThumb;
	// the card in the JSON is a 600x392 centre-cropped thumbnail; its full-size twin lives one folder up
	if (cardThumb) {
		const full = path.posix.join(path.posix.dirname(path.posix.dirname(cardThumb)), path.posix.basename(cardThumb));
		const r = path.posix.basename(path.posix.dirname(cardThumb)) === 'thumbs' ? resolver.resolve(full) : null;
		p.cardSrc = r ? r.rel : cardThumb;
	}

	const seen = new Set();
	let sizeMismatch = 0;
	for (const [i, ph] of (Array.isArray(raw.photos) ? raw.photos : []).entries()) {
		const src = fix(ph && ph.src, `photo ${i + 1}`);
		if (!src) continue;
		const thumb = ph.thumb ? fix(ph.thumb, `thumb ${i + 1}`) : null;
		const sz = images.size(src);
		let w = Number(ph.w), h = Number(ph.h);
		if (!sz) {
			if (!(w > 0 && h > 0)) { bad(`photo ${src} has no usable w/h and its size cannot be read from the file`); continue; }
		} else {
			if (!(w > 0 && h > 0)) warn(`photo ${src} has no w/h in the JSON; using ${sz.w}x${sz.h} from the file`);
			else if (Math.abs(sz.w - w) > 2 || Math.abs(sz.h - h) > 2) sizeMismatch++;
			w = sz.w; h = sz.h; // the file is the truth
		}
		if (seen.has(src)) warn(`duplicate photo ${src}`);
		seen.add(src);
		p.photos.push({
			src, thumb, w, h,
			caption: ph.caption ? String(ph.caption).trim() : '',
			alt: ph.alt ? String(ph.alt).trim() : '',
			featured: ph.featured === true,
		});
	}
	if (sizeMismatch) warn(`${sizeMismatch} photo(s) have w/h in the JSON that differ from the file (the file's size is used)`);

	// site.json can name photos that should be used for the full-bleed photo breaks (legacy posts cannot be edited)
	for (const want of site.photoBreaks[p.slug] || []) {
		const r = resolver.resolve(want);
		const ph = r && p.photos.find((x) => x.src === r.rel);
		if (ph) ph.featured = true; else warn(`site.json photoBreaks: ${want} is not a photo of this story`);
	}

	if (!p.cover) p.cover = p.cardSrc || (p.photos[0] && p.photos[0].src) || null;
	if (!p.cover) { bad('no cover image (set "cover", "card" or add photos)'); return null; }
	if (!p.cardSrc) p.cardSrc = p.cover;
	if (caseFixes) warn(`${caseFixes} path(s) differ in letter case from the files on disk (e.g. ${caseExample}); resolved to the on-disk spelling so the case-sensitive host serves them`);
	return p;
}

/* ------------------------------------------------------------------ derived data */

function computeStats(posts) {
	const countries = new Set(posts.map((p) => p.country).filter(Boolean));
	const years = [...new Set(posts.map((p) => p.year))].sort();
	return {
		stories: posts.length,
		countries: countries.size,
		photos: posts.reduce((n, p) => n + p.photos.length, 0),
		years,
		yearRange: years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] || '',
	};
}

/* words that suggest a photo shows people; such frames never become full-bleed photo breaks */
const PEOPLE = /\b(person|people|man|men|woman|women|boy|girl|child|children|kid|kids|baby|portrait|selfie|self-portrait|smile|smiles|face|faces|hiker|hikers|climber|climbers|couple|family|friend|friends|group|crowd|rider|snowboarder|skier|surfer|silhouette|figure|me|us|myself|brother|brothers|sister|wife|husband|son|daughter|dad|mom)\b/i;

/**
 * Choose the photos that become full-bleed "photo breaks" between paragraphs.
 * A story qualifies with 3+ paragraphs and 12+ photos. Photos flagged "featured" win; otherwise the widest frames,
 * spread through the gallery. Never a portrait, never the cover, never a frame whose alt/caption mentions people.
 * @returns {{after:number, index:number}[]} insert photo `index` after paragraph number `after` (1-based)
 */
function pickBreaks(p) {
	const n = p.paragraphs.length;
	if (n < 3 || p.photos.length < 12) return [];
	const k = n >= 10 ? 3 : n >= 6 ? 2 : 1;
	const cand = [];
	p.photos.forEach((ph, i) => {
		const ar = ph.w / ph.h;
		if (ar < 1.45 || ph.w < 1200) return;                 // wide frames only (never a portrait or a square)
		if (ph.src === p.cover) return;                       // the hero already uses it
		if (PEOPLE.test(`${ph.alt} ${ph.caption}`)) return;   // no people
		cand.push({ i, ar, w: ph.w, featured: ph.featured });
	});
	if (!cand.length) return [];
	const featured = cand.filter((c) => c.featured);
	const rest = cand.filter((c) => !c.featured);
	const chosen = featured.slice(0, k);
	if (chosen.length < k && rest.length) {
		// spread the remaining picks through the gallery, preferring wider, larger frames inside each slice
		const need = k - chosen.length;
		for (let j = 0; j < need; j++) {
			const lo = Math.floor((j * rest.length) / need), hi = Math.max(lo + 1, Math.floor(((j + 1) * rest.length) / need));
			const slice = rest.slice(lo, hi).sort((a, b) => (Math.min(b.ar, 2.4) * 1000 + Math.min(b.w, 3000) / 10) - (Math.min(a.ar, 2.4) * 1000 + Math.min(a.w, 3000) / 10));
			if (slice[0]) chosen.push(slice[0]);
		}
	}
	chosen.sort((a, b) => a.i - b.i);
	const out = [];
	let prev = 1;
	chosen.forEach((c, j) => {
		let after = j === 0 ? 2 : Math.round(2 + (j * (n - 2)) / chosen.length);
		after = Math.min(n - 1, Math.max(prev + 1, after));
		out.push({ after, index: c.i });
		prev = after;
	});
	return out;
}

/** one-line description for <meta name="description"> */
function describe(p, limit = 155) {
	const src = (p.subtitle || p.paragraphs[0] || p.location || p.title).replace(/\s+/g, ' ').trim();
	if (src.length <= limit) return src;
	return src.slice(0, limit).replace(/\s+\S*$/, '') + '…';
}

module.exports = { Report, loadSite, loadPosts, computeStats, pickBreaks, describe };
