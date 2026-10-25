#!/usr/bin/env node
'use strict';
/* Generator checks that never touch the real site:
 *  - the real content validates (exit 0);
 *  - a story with a missing image / bad date / broken JSON fails the build (exit 1) and writes nothing;
 *  - a NEW-STYLE story (subtitle, region, coverPosition, per-photo alt, featured, day in the date, a path with the wrong letter
 *    case, no w/h, a portrait, a photo that mentions a person) builds into a temp folder with the right photo break, sitemap,
 *    canonical and og tags.
 * The temp site shares assets/ with Public_html through symlinks (assets/data is private to the temp site), builds with --no-images
 * so nothing is written into the real tree, and is deleted afterwards.
 *   node tests/generator.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { SITE_ROOT, Tester } = require('./lib');

const t = new Tester('generator');
const REPO = path.resolve(SITE_ROOT, '..');
const BUILD = path.join(REPO, 'scripts', 'build-site.js');
const CONTENT = path.join(REPO, 'content');
const run = (args) => cp.spawnSync(process.execPath, [BUILD, '--no-images', '--quiet', ...args], { encoding: 'utf8' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-gen-'));
try {
	t.check('real content validates (--check exits 0)', run(['--check']).status === 0);

	// temp site: private copy of content + an out folder whose assets/ points at the real assets (except data/)
	const content = path.join(tmp, 'content'), out = path.join(tmp, 'out');
	fs.mkdirSync(path.join(content, 'posts'), { recursive: true });
	fs.copyFileSync(path.join(CONTENT, 'site.json'), path.join(content, 'site.json'));
	for (const f of fs.readdirSync(path.join(CONTENT, 'posts'))) fs.copyFileSync(path.join(CONTENT, 'posts', f), path.join(content, 'posts', f));
	fs.mkdirSync(path.join(out, 'assets', 'data'), { recursive: true });
	for (const d of fs.readdirSync(path.join(SITE_ROOT, 'assets'))) if (d !== 'data') fs.symlinkSync(path.join(SITE_ROOT, 'assets', d), path.join(out, 'assets', d));
	fs.copyFileSync(path.join(SITE_ROOT, 'assets/data/world-dots.json'), path.join(out, 'assets/data/world-dots.json'));

	// the new-style story reuses photos of north-cascades (already derived), spelled with the WRONG letter case on purpose
	const nc = JSON.parse(fs.readFileSync(path.join(CONTENT, 'posts', 'north-cascades.json'), 'utf8'));
	const wrongCase = (p) => p.replace('north-cascades', 'North-Cascades');
	const photos = nc.photos.slice(0, 16).map((p) => ({ src: wrongCase(p.src), w: p.w, h: p.h, caption: p.caption, alt: p.alt }));
	photos[1].alt = 'A hiker stands on a ridge looking over the valley.'; // people: never a photo break
	photos[2].featured = true; photos[2].caption = 'Featured Frame';
	delete photos[5].w; delete photos[5].h;                                // filled from the file
	const story = {
		slug: 'test-trip', title: 'Test Trip', subtitle: 'A temporary story.', date: '2019-06-15', location: 'Banff National Park, Alberta', region: 'Canadian Rockies', country: 'Canada',
		coords: [51.4, -116.5], tags: ['mountains', 'lakes'], sectionTitle: 'Proof', paragraphs: ['One. '.repeat(20), 'Two. '.repeat(20), 'Three. '.repeat(20), 'Four. '.repeat(20)],
		cover: wrongCase(nc.cover), coverPosition: '50% 35%', card: wrongCase(nc.card), photos, legacy: false,
	};
	fs.writeFileSync(path.join(content, 'posts', 'test-trip.json'), JSON.stringify(story));
	const r = run(['--content', content, '--out', out, '--site-url', 'https://example.test']);
	t.check('new-style story builds (exit 0)', r.status === 0, (r.stdout + r.stderr).split('\n').filter((l) => /ERROR|FAILED|  - test-trip/.test(l)).join(' | '));
	t.check('the warnings mention the letter-case fix and the missing w/h', /test-trip: .*differ in letter case/.test(r.stdout) && /test-trip: photo .* has no w\/h/.test(r.stdout));
	const file = path.join(out, 'blog/pages/test-trip.html');
	const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	t.check('the story page was written', html.length > 5000);
	t.check('no wrong-case path survived into the HTML', !/North-Cascades/.test(html) && /assets\/images\/north-cascades\//.test(html));
	const breaks = [...html.matchAll(/<figure class="full[^>]*>[\s\S]*?<\/figure>/g)].map((m) => m[0]);
	t.check('one photo break, and it is the featured frame', breaks.length === 1 && /Featured Frame/.test(breaks[0]), String(breaks.length));
	t.check('the photo that mentions a hiker is not used for a break', !breaks.some((b) => /Ridge|hiker/i.test(b)));
	t.check('subtitle and region are shown', html.includes('A temporary story.') && html.includes('Canadian Rockies'));
	t.check('object-position from coverPosition is applied to the cover', /object-position:50% 35%/.test(html));
	t.check('canonical + absolute og:image because --site-url was given', html.includes('<link rel="canonical" href="https://example.test/blog/pages/test-trip.html">') && /<meta property="og:image" content="https:\/\/example\.test\//.test(html));
	const sm = fs.existsSync(path.join(out, 'sitemap.xml')) ? fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8') : '';
	t.check('sitemap.xml lists every page (home + index + stories)', (sm.match(/<loc>/g) || []).length === 2 + fs.readdirSync(path.join(content, 'posts')).length && sm.includes('/blog/pages/test-trip.html'));
	const stories = JSON.parse(fs.readFileSync(path.join(out, 'assets/data/stories.json'), 'utf8'));
	t.check('stories.json includes the new story with its card/cover derivatives', stories.some((s) => s.slug === 'test-trip' && s.subtitle === 'A temporary story.' && s.card.length));
	const idx = fs.readFileSync(path.join(out, 'blog/index.html'), 'utf8');
	t.check('the story index lists it as a tile', /data-slug="test-trip"/.test(idx));
	t.check('the real assets/data was not touched', JSON.parse(fs.readFileSync(path.join(SITE_ROOT, 'assets/data/stories.json'), 'utf8')).every((s) => s.slug !== 'test-trip'));

	// hard errors: nothing is written, exit code 1
	const badContent = path.join(tmp, 'bad'); fs.cpSync(content, badContent, { recursive: true });
	const bad = JSON.parse(JSON.stringify(story)); bad.cover = 'assets/images/test-trip/nope.webp'; bad.date = '2019-13';
	fs.writeFileSync(path.join(badContent, 'posts', 'test-trip.json'), JSON.stringify(bad));
	fs.writeFileSync(path.join(badContent, 'posts', 'broken.json'), '{ "slug": ');
	const before = fs.statSync(path.join(out, 'blog/index.html')).mtimeMs;
	const rb = run(['--content', badContent, '--out', out]);
	t.check('broken JSON + bad date fail the build with exit 1', rb.status === 1 && /ERRORs?:/.test(rb.stdout) && /broken\.json/.test(rb.stdout) && /"date" must look like/.test(rb.stdout));
	t.check('a failed build writes nothing', fs.statSync(path.join(out, 'blog/index.html')).mtimeMs === before);
	fs.unlinkSync(path.join(badContent, 'posts', 'broken.json'));
	bad.date = '2019-06';
	fs.writeFileSync(path.join(badContent, 'posts', 'test-trip.json'), JSON.stringify(bad));
	const rm = run(['--content', badContent, '--out', out]);
	t.check('a missing cover file is a hard error (exit 1)', rm.status === 1 && /missing file assets\/images\/test-trip\/nope\.webp \(cover\)/.test(rm.stdout));
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(t.summary() ? 0 : 1);
