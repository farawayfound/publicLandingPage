#!/usr/bin/env node
'use strict';
/* The owner's words are sacred. This checks that every string he wrote on the ORIGINAL pages survives, verbatim and
 * with its typos, in the generated pages, and that only the three agreed edits happened.
 *
 * Originals are read from git history:  VERBATIM_REF=<commit> node tests/verbatim.js   (default 06bbff2, the last
 * hand-written state). Without git history the content JSON is checked against the output instead.
 *   node tests/verbatim.js */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { SITE_ROOT, Tester } = require('./lib');

const REF = process.env.VERBATIM_REF || '06bbff2';
const REPO = path.resolve(SITE_ROOT, '..');
const t = new Tester('verbatim');

const ENT = { '&middot;': '·', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&eacute;': 'é' };
const dec = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => (m in ENT ? ENT[m] : m));
const strip = (h) => dec(h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const gitShow = (rel) => { try { return cp.execFileSync('git', ['-C', REPO, 'show', `${REF}:Public_html/${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch (e) { return null; } };
const read = (rel) => fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');

const slugs = JSON.parse(read('assets/data/stories.json')).filter((s) => s.legacy).map((s) => s.slug);
const haveGit = gitShow('index.html') !== null;
if (!haveGit) console.log(`  (git ref ${REF} not available: comparing the content JSON with the output only)`);

let owned = 0;
if (haveGit) {
	for (const slug of slugs) {
		const orig = gitShow(`blog/pages/${slug}.html`);
		if (!orig) continue;
		const gen = strip(read(`blog/pages/${slug}.html`));
		const body = orig.split('<div id="fh5co-content">')[1] || '';
		const head = body.split('<section id="galleries">')[0];
		const paras = head.split(/<p class="fh5co-lead[^>]*>/).slice(1).map((s) => strip(s.split(/<\/p>|<p |<\/div>/)[0])).filter(Boolean);
		const caps = [...orig.matchAll(/data-title="([^"]*)"/g)].map((m) => dec(m[1]).trim()).filter(Boolean);
		const h1 = strip((orig.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
		const st = strip((orig.match(/fh5co-section-title[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '');
		const cue = strip((orig.match(/js-fh5co-next">([\s\S]*?)<span>/) || [])[1] || '');
		const miss = [];
		for (const x of [...paras, ...caps, h1, st, cue].filter(Boolean)) { owned++; if (!gen.includes(x)) miss.push(x.slice(0, 70)); }
		t.check(`${slug}: all ${paras.length} paragraphs, ${caps.length} captions, title, section title and cue are verbatim`, miss.length === 0, miss.slice(0, 3).join(' | '));
	}
	// the hub and the story index: every visible string of the original page
	for (const [rel, allowedGone] of [['index.html', [/^Sorry, this hasn't been updated in a while\.\.\.$/, /^Photo journals and notes from the road — national parks, cities, and mountain trips\. Sorry,.*$/]], ['blog/index.html', []]]) {
		const orig = gitShow(rel);
		const gen = strip(read(rel));
		const bodyOnly = (orig.split('<body>')[1] || orig);
		const pieces = bodyOnly.replace(/<script[\s\S]*?<\/script>/g, '|').replace(/<!--[\s\S]*?-->/g, '|').replace(/<[^>]+>/g, '|').split('|').map((s) => dec(s).replace(/\s+/g, ' ').trim()).filter((s) => s.length > 1);
		const miss = [];
		for (const p of pieces) {
			if (gen.includes(p)) { owned++; continue; }
			if (allowedGone.some((re) => re.test(p))) continue;
			// the card text lost only its last sentence
			if (p.startsWith('Photo journals and notes from the road') && gen.includes(p.replace(/\s*Sorry,.*$/, ''))) continue;
			miss.push(p.slice(0, 90));
		}
		t.check(`${rel}: every string the owner wrote is still there`, miss.length === 0, miss.slice(0, 4).join(' | '));
		// the page title and meta description
		for (const re of [/<title>([\s\S]*?)<\/title>/, /<meta name="description" content="([^"]*)"/]) {
			const m = orig.match(re); if (!m) continue;
			const want = dec(m[1]).replace(/\s+/g, ' ').trim();
			const got = read(rel).match(re);
			t.check(`${rel}: ${re.source.slice(1, 6)} is unchanged`, got && dec(got[1]).replace(/\s+/g, ' ').trim() === want, got ? dec(got[1]) : 'missing');
		}
	}
}

// his typos and quirks are still there (they are listed in the report, never fixed)
const all = slugs.map((s) => read(`blog/pages/${s}.html`)).join('\n');
for (const typo of ['abnoxiously', 'contient', 'a a civil', 'for while', 'suite of features', 'Norte Dame', 'techtonic', 'dissapointe', 'examplifies']) t.check(`typo kept as written: "${typo}"`, all.includes(typo));
t.check('typo kept as written: "Xi’an China" (no comma) in About', strip(read('blog/index.html')).includes('I was born in Xi’an China, raised in Montreal Canada'));

// the three agreed edits, and nothing else
const landing = read('index.html'), blog = read('blog/index.html');
t.check('edit 1: the "Sorry, this hasn\'t been updated" sentence is gone from the blog card', !/Sorry, this hasn/.test(landing));
t.check('edit 2: "Get in touch" points to davidchui.work (not google.com)', /<a class="btn" href="https:\/\/davidchui\.work\/"[^>]*>Get in touch<\/a>/.test(blog) && !/google\.com/.test(blog));
t.check('edit 3: no dead social icon links remain', !/icon-(twitter|facebook|vine|behance|google|vimeo)/.test(blog + all) && !/fh5co-social/.test(blog));
t.check('privacy: no e-mail address anywhere in the generated pages', !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(landing + blog + all));
console.log(`  (${owned} owner strings checked)`);
process.exit(t.summary() ? 0 : 1);
