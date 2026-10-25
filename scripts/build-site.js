#!/usr/bin/env node
'use strict';
/**
 * FarawayFound site generator. Node >= 18, zero npm dependencies.
 *
 *   node scripts/build-site.js              build everything into Public_html/
 *   node scripts/build-site.js --check      validate the content only, write nothing
 *
 * Reads    content/site.json            all site-level copy (the owner's words, verbatim)
 *          content/posts/*.json         one file per story (any number)
 * Writes   Public_html/index.html                     the hub / landing page
 *          Public_html/blog/index.html                story index (map, timeline, filters)
 *          Public_html/blog/pages/<slug>.html         one page per story (legacy slugs keep their file names)
 *          Public_html/assets/data/stories.json|.js   story list for the map and for other tools
 *          Public_html/assets/data/world-dots.js      run-length encoded world map (shared by all pages)
 *          Public_html/assets/images/derived/...      WebP derivatives + share images (created when missing)
 *          Public_html/assets/clips/*-480.*           small transcodes of the snowboard clip (created when missing)
 *          Public_html/assets/data/hero-tone.json     measured brightness behind the hero words (see scripts/lib/tone.js)
 *          Public_html/sitemap.xml, robots.txt        only when "site.url" is set in content/site.json
 * Templates live in templates/, CSS in Public_html/assets/css/ff.css, JS in Public_html/assets/js/.
 *
 * Options
 *   --content <dir>   content folder (default: ./content)
 *   --out <dir>       site root, the folder that holds assets/ (default: ./Public_html)
 *   --site-url <url>  public address, overrides "site.url" (also: SITE_URL environment variable)
 *   --no-images       never run an encoder; use whatever derived files already exist
 *   --force-images    rebuild every derived image and the clip transcodes
 *   --keep-going      write the pages even when the content has errors (they are still reported, exit code 1)
 *   --strict          turn the deploy blockers into hard errors: photos that still carry camera metadata (EXIF / GPS / XMP) and an empty site.url
 *   --quiet           print only warnings and errors
 *
 * The output is deterministic: building twice produces identical files. Hard errors (unreadable JSON, a missing
 * image, a bad date ...) stop the build before anything is written and exit with code 1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resolver } = require('./lib/fsx');
const { Images, WIDTHS, VIEW_MIN_BYTES } = require('./lib/images');
const { ensureClip } = require('./lib/media');
const { Tone } = require('./lib/tone');
const imgmeta = require('./lib/imgmeta');
const { Report, loadSite, loadPosts, computeStats } = require('./lib/content');
const dots = require('./lib/dots');
const sync = require('./sync-landing-images');
const { encPath, mulberry32, fmtCoord } = require('./lib/util');

const REPO = path.resolve(__dirname, '..');

function parseArgs(argv) {
	const a = { content: path.join(REPO, 'content'), out: path.join(REPO, 'Public_html'), images: true, force: false, keepGoing: false, quiet: false, check: false, siteUrl: '' };
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		if (k === '--content') a.content = path.resolve(argv[++i]);
		else if (k === '--out') a.out = path.resolve(argv[++i]);
		else if (k === '--site-url') a.siteUrl = argv[++i];
		else if (k === '--no-images') a.images = false;
		else if (k === '--force-images') a.force = true;
		else if (k === '--keep-going') a.keepGoing = true;
		else if (k === '--strict') a.strict = true;
		else if (k === '--quiet') a.quiet = true;
		else if (k === '--check') a.check = true;
		else if (k === '--help' || k === '-h') { const m = /\/\*\*([\s\S]*?)\*\//.exec(fs.readFileSync(__filename, 'utf8')); console.log(m[1].replace(/^ \* ?/gm, '').trim()); process.exit(0); }
		else { console.error(`unknown option ${k} (try --help)`); process.exit(2); }
	}
	return a;
}

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);

/* ------------------------------------------------------------------ generated static assets */

/** a faint, static star texture for the map panel, about, contact and footer bands (no animation) */
function starsSvg(size, n, bright, seed) {
	const rnd = mulberry32(seed);
	const tints = ['#f0e6ff', '#f0e6ff', '#f0e6ff', '#c8b8e8', '#f9ad81'];
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
	for (let i = 0; i < n; i++) {
		const x = (rnd() * size).toFixed(1), y = (rnd() * size).toFixed(1);
		const r = (0.3 + Math.pow(rnd(), 2.2) * 0.9).toFixed(2);
		const o = (0.16 + rnd() * 0.6).toFixed(2);
		s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${tints[Math.floor(rnd() * tints.length)]}" fill-opacity="${o}"/>`;
	}
	for (let i = 0; i < bright; i++) {
		const x = +(rnd() * size).toFixed(1), y = +(rnd() * size).toFixed(1);
		const L = +(3 + rnd() * 2.4).toFixed(1);
		s += `<path d="M${+(x - L).toFixed(1)} ${y}H${+(x + L).toFixed(1)}M${x} ${+(y - L).toFixed(1)}V${+(y + L).toFixed(1)}" stroke="#f0e6ff" stroke-opacity=".32" stroke-width=".5" stroke-linecap="round"/>`;
		s += `<circle cx="${x}" cy="${y}" r=".95" fill="#fff" fill-opacity=".9"/>`;
	}
	return s + '</svg>\n';
}

function terminalStill() {
	const p = (path) => `<span class="t-prompt">david@chui</span>:<span class="t-path">${path}</span>$ `;
	return [
		`<div class="t-line">${p('~/dev')}<span class="t-cmd">git log --oneline -5</span></div>`,
		'<div class="t-line"><span class="t-out">a3f9c12  feat: dark-mode toggle</span></div>',
		'<div class="t-line"><span class="t-out">b18e741  fix: mobile nav z-index</span></div>',
		'<div class="t-line"><span class="t-out">d9c3301  chore: bump dependencies</span></div>',
		'<div class="t-line"><span class="t-out">f551208  feat: project filter component</span></div>',
		`<div class="t-line">${p('~/dev')}<span class="t-cursor"></span></div>`,
	].join('');
}

/* ------------------------------------------------------------------ main */

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const t0 = Date.now();
	const log = (m) => { if (!args.quiet) console.log(m); };
	const report = new Report();

	const site = loadSite(args.content, report);
	if (!site) return finish(report, args, 0);
	if (args.siteUrl) site.site.url = args.siteUrl.replace(/\/+$/, '');
	const resolver = new Resolver(args.out);
	const images = new Images({ root: args.out, resolver, enabled: args.images, force: args.force, log });
	const posts = loadPosts({ contentDir: args.content, resolver, images, site, report });

	/* privacy: the originals are linked from the pages (lightbox), so they must carry no EXIF / GPS / XMP (see scripts/strip-metadata.js) */
	const priv = imgmeta.scan(path.join(args.out, 'assets/images'));
	if (priv.dirty.length) {
		const msg = `privacy: ${priv.dirty.length} of ${priv.total} photo file(s) in assets/images still carry camera metadata (GPS coordinates in ${priv.gps.length}, an e-mail address in ${priv.emails.length}, camera / owner serial numbers in ${priv.serial.length}) and the pages link the originals. Strip it losslessly with: node scripts/strip-metadata.js --write   (check with: node scripts/strip-metadata.js)`;
		if (args.strict) report.error(msg); else report.warn(msg);
	}

	// the landing slideshow photos (Landing/web/*.webp when present, else the originals)
	let landingFiles = [];
	try { landingFiles = sync.collectLandingImages(args.out); } catch (e) { report.error(`landing slideshow: ${e.message}`); }
	if (!landingFiles.length) report.error('landing slideshow: no photos found in assets/images/Landing');
	const stem = (rel) => path.posix.basename(rel).replace(/\.[^.]+$/, '');
	const lead = landingFiles.find((f) => stem(f) === site.hero.landingFirst);
	if (lead) landingFiles = [lead, ...landingFiles.filter((f) => f !== lead)];

	if (!posts.length) report.error('no stories found in content/posts');
	if (report.errors.length && !args.keepGoing) return finish(report, args, posts.length);
	if (args.check) { log(`checked ${posts.length} stories`); return finish(report, args, posts.length); }

	const stats = computeStats(posts);

	/* ---- derived images (parallel pre-warm; the templates then find every file in place) */
	const jobs = [];
	for (const f of landingFiles) jobs.push({ src: f, widths: WIDTHS.hero });
	for (const p of posts) {
		jobs.push({ src: p.cover, widths: WIDTHS.cover }, { src: p.cardSrc, widths: WIDTHS.card });
		for (const ph of p.photos) jobs.push({ src: ph.src, widths: WIDTHS.photo }, { src: ph.src, widths: WIDTHS.view, minBytes: VIEW_MIN_BYTES });
	}
	await images.prewarm(jobs);

	const clip = ensureClip(args.out, { force: args.force, enabled: args.images });
	clip.original = 'assets/clips/tinySnowboarding.mp4';
	for (const n of clip.notes) (n.startsWith('created') ? log : (m) => report.warn(m))(`clip: ${n}`);
	if (!clip.mp4) report.warn('clip: using the original 10 MB tinySnowboarding.mp4 (it only downloads when the card is visible); install ffmpeg and rebuild to create the small version');

	/* ---- landing hero + blog hero lists */
	const world = dots.readDots(path.join(args.out, 'assets/data/world-dots.json'));
	const heroVariants = (rel, widths) => images.variants(rel, widths, { original: true, maxOriginal: 2600 });
	const heroItem = (v, prefix, extra) => { const fb = v.pick(1920); return { src: fb.rel, set: v.srcset(prefix, encPath), w: fb.w, h: fb.h, ...extra }; };
	const tone = new Tone({ root: args.out, enabled: args.images });
	const landingItems = (prefix) => landingFiles.map((f) => heroItem(heroVariants(f, WIDTHS.hero), prefix, { shade: tone.shades(f, '', 'home') })).filter((x) => x.w);

	const coverAspect = (p) => { const s = images.size(p.cover); return s ? s.w / s.h : 0; };
	const storyHero = posts.filter((p) => p.hero === true || (p.hero !== false && !p.legacy && coverAspect(p) >= 1.4)).slice(0, site.hero.blogStories || 5);
	const blogHeroItems = (prefix) => {
		const stories = storyHero.map((p) => heroItem(heroVariants(p.cover, WIDTHS.cover), prefix, { pos: p.coverPosition || '', shade: tone.shades(p.cover, p.coverPosition, 'blog', p.heroShade), href: `pages/${p.slug}.html`, title: p.cardTitle, coord: p.coords ? fmtCoord(p.coords).replace(/ /g, ' ') : '' }));
		const want = (site.hero.blogPhotos || []).map((s) => landingFiles.find((f) => stem(f) === s)).filter(Boolean);
		const photos = want.map((f) => heroItem(heroVariants(f, WIDTHS.hero), prefix, { shade: tone.shades(f, '', 'blog') }));
		const out = [];
		for (let i = 0; out.length < (site.hero.blogMax || 8) && (i < stories.length || i < photos.length); i++) {
			if (stories[i]) out.push(stories[i]);
			if (photos[i] && out.length < (site.hero.blogMax || 8)) out.push(photos[i]);
		}
		return out.slice(0, site.hero.blogMax || 8);
	};

	/* ---- share images */
	const ogFor = (rel, name, pos, alt, fallbackV) => {
		const jpg = images.og(rel, name, pos);
		if (jpg) return { image: jpg, w: 1200, h: 630, alt };
		const fb = fallbackV && fallbackV.pick(1600);
		return fb ? { image: fb.rel, w: fb.w, h: fb.h, alt } : {};
	};
	const og = {
		home: ogFor(landingFiles[0], 'home', '50% 50%', site.site.name, images.variants(landingFiles[0], WIDTHS.hero)),
		blog: null,
		post: (p) => ogFor(p.cover, p.slug, p.coverPosition, `${p.title} — ${p.location}`, images.variants(p.cover, WIDTHS.cover)),
	};
	const bh0 = blogHeroItems('')[0];
	const bhSrc = storyHero[0] ? storyHero[0].cover : landingFiles[0];
	og.blog = ogFor(bhSrc, 'blog', bh0 && bh0.pos, site.site.name, images.variants(bhSrc, WIDTHS.cover));

	/* ---- shared (generated) data files: written first so their hashes can be part of the page URLs */
	const compact = posts.filter((p) => p.coords).map((p) => {
		const card = images.variants(p.cardSrc, [480]);
		const c = card && card.list[0];
		return { s: p.slug, t: p.cardTitle, d: p.date, dl: p.dateLabel, y: p.year, lat: p.lat, lon: p.lon, c: p.country, loc: p.location, tg: p.tags, n: p.photos.length, p: `blog/pages/${p.slug}.html`, img: c ? c.rel : p.cardSrc, iw: c ? c.w : 0, ih: c ? c.h : 0 };
	});
	const storiesJs = `/* Generated by scripts/build-site.js from content/posts/*.json. Do not edit. */\nwindow.FF_STORIES=${JSON.stringify(compact)};\n`;
	const storiesJson = JSON.stringify(posts.map((p) => {
		const card = images.variants(p.cardSrc, [480, 960]);
		const cover = images.variants(p.cover, [960, 1600]);
		return {
			slug: p.slug, title: p.title, cardTitle: p.cardTitle, subtitle: p.subtitle || undefined, date: p.date, dateLabel: p.dateLabel, year: p.year,
			location: p.location, region: p.region || undefined, country: p.country, coords: p.coords || undefined, tags: p.tags, photos: p.photos.length,
			href: `blog/pages/${p.slug}.html`, card: card.list.map((c) => ({ src: c.rel, w: c.w, h: c.h })), cover: cover.list.map((c) => ({ src: c.rel, w: c.w, h: c.h })),
			legacy: p.legacy,
		};
	}), null, 1) + '\n';
	const worldJs = dots.rleScript(world);
	const starsRel = 'assets/css/stars.svg';
	const starsSrc = starsSvg(1100, 120, 7, 11);

	const hashes = {};
	const hashFile = (rel) => { try { hashes[rel] = sha(fs.readFileSync(path.join(args.out, rel))); } catch (e) { hashes[rel] = ''; } };
	['assets/css/ff.css', 'assets/js/ff.js', 'assets/js/ff-map.js', 'assets/js/plan-group.js', 'assets/js/terminal.js'].forEach(hashFile);
	hashes['assets/data/stories.js'] = sha(storiesJs);
	hashes['assets/data/world-dots.js'] = sha(worldJs);

	/* ---- render */
	const base = { site, posts, stats, images, world, clip, og, tone, siteUrl: site.site.url, hash: (rel) => hashes[rel] || '', terminalStill: terminalStill() };
	const ctxFor = (prefix, extra) => Object.assign({}, base, { prefix }, extra);
	const out = new Map();
	out.set('index.html', require('../templates/landing')(ctxFor('', { landing: { items: landingItems('') } })));
	out.set('blog/index.html', require('../templates/blog-index')(ctxFor('../', { blogHero: { items: blogHeroItems('../') } })));
	posts.forEach((p, i) => out.set(`blog/pages/${p.slug}.html`, require('../templates/post')(ctxFor('../../'), p, i)));
	out.set('assets/data/stories.js', storiesJs);
	out.set('assets/data/stories.json', storiesJson);
	out.set('assets/data/world-dots.js', worldJs);
	out.set(starsRel, starsSrc);
	if (site.site.url) {
		const urls = ['', 'blog/index.html', ...posts.map((p) => `blog/pages/${p.slug}.html`)];
		out.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site.site.url}/${encPath(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
		out.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.site.url}/sitemap.xml\n`);
	} else {
		const msg = 'content/site.json "site.url" is EMPTY: every page ships a relative og:image (link-preview crawlers cannot use it) and there is no canonical link, sitemap.xml or robots.txt. Set "site.url" to the public address (or build with --site-url https://...) before deploying.';
		if (args.strict) report.error(msg); else report.warn(msg);
	}

	if (report.errors.length && !args.keepGoing) return finish(report, args, posts.length);

	let changed = 0;
	for (const [rel, text] of out) {
		const file = path.join(args.out, rel);
		let prev = null;
		try { prev = fs.readFileSync(file, 'utf8'); } catch (e) { /* new file */ }
		if (prev === text) continue;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
		changed++;
	}
	try { sync.writeLandingImagesJs(args.out); } catch (e) { report.warn(`landing-images.js: ${e.message}`); }
	if (args.images) tone.save();
	if (tone.missing) report.warn(`hero tone: ${tone.missing} hero photo(s) could not be measured (ffmpeg is missing and assets/data/hero-tone.json has no value for them); they get no darkening. Install ffmpeg and rebuild.`);

	if (images.problems.length) images.problems.forEach((m) => report.warn(`images: ${m}`));
	if (images.stats.missingTool) report.warn(`images: ${images.stats.missingTool} derived file(s) are missing and no encoder was found. Install "webp" (cwebp) or ffmpeg and rebuild, or the pages fall back to the full-size originals.`);

	log(`\n${posts.length} stories, ${stats.countries} countries, ${stats.photos} photos, ${stats.yearRange}`);
	log(`wrote ${out.size} files (${changed} changed) to ${path.relative(process.cwd(), args.out) || '.'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	log(`images: ${images.stats.generated} created, ${images.stats.reused} reused, ${images.stats.og} share image(s) created`);
	return finish(report, args, posts.length);
}

function finish(report, args, n) {
	const show = (label, list) => { if (list.length) { console.log(`\n${list.length} ${label}${list.length === 1 ? '' : 's'}:`); list.forEach((m) => console.log(`  - ${m}`)); } };
	show('warning', report.warnings);
	show('ERROR', report.errors);
	if (report.errors.length) {
		console.log(args.keepGoing ? '\nbuild finished with errors (--keep-going)' : '\nbuild FAILED: nothing was written.');
		process.exitCode = 1;
	}
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
