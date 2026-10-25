'use strict';
/* templates/blog-index.js - the story index: Public_html/blog/index.html
 * Sections: hero > "Stories" intro > map > explorer (year rail, filters, year groups of tiles) > about > contact. */
const { esc, encPath, fmtCoord, fmtNum, plural, pad2, shorten, titleCase } = require('../scripts/lib/util');
const L = require('./layout');
const P = require('./parts');
const Plan = require('../Public_html/assets/js/plan-group.js');
const { WIDTHS } = require('../scripts/lib/images');

module.exports = function blogIndex(ctx) {
	const { site, posts, stats, images, blogHero } = ctx;
	const copy = site.blog;
	const ui = site.ui;
	const prefix = ctx.prefix; // '../'
	const tagLabel = (t) => site.tagLabels[t] || titleCase(t);

	/* ---------------------------------------------------------------- tiles */
	const tile = (p, plan, i) => {
		const large = Plan.isLarge(plan);
		const card = images.variants(p.cardSrc, WIDTHS.card);
		const cover = images.variants(p.cover, WIDTHS.cover);
		const main = large ? cover : card, alt = large ? card : cover;
		const fb = main.pick(large ? 1600 : 960);
		const sizes = Plan.sizes(plan);
		const pos = p.coverPosition || '';
		const imgTag = `<img src="${prefix}${encPath(fb.rel)}" srcset="${esc(main.srcset(prefix, encPath))}" sizes="${esc(sizes)}" width="${fb.w}" height="${fb.h}" loading="lazy" decoding="async" alt=""` +
			` data-alt-set="${esc(alt.srcset(prefix, encPath))}"${pos ? ` data-pos="${esc(pos)}"` : ''}${large && pos ? ` style="object-position:${esc(pos)}"` : ''}>`;
		return `
          <li class="tile ${plan.cls}" data-slug="${esc(p.slug)}" data-year="${p.year}" data-tags="${esc(p.tags.join(' '))}" data-large="${large ? 1 : 0}">
            <a class="tile__a" href="pages/${esc(p.slug)}.html" aria-label="${esc(p.cardTitle)} — ${esc(p.dateLabel)}">
              ${imgTag}
              ${p.coords ? `<span class="tile__coord mono" aria-hidden="true">${fmtCoord(p.coords)}</span>` : ''}
              <span class="tile__over" aria-hidden="true">
                <span class="tile__meta">${esc(p.dateLabel)}</span>
                <span class="tile__title">${esc(p.cardTitle)}</span>
                <span class="tile__sub mono">${p.photos.length ? plural(p.photos.length, ui.photo, ui.photos) : esc(p.country)}</span>
              </span>
            </a>
          </li>`;
	};

	const byYear = new Map();
	for (const p of posts) { if (!byYear.has(p.year)) byYear.set(p.year, []); byYear.get(p.year).push(p); }
	const years = [...byYear.keys()].sort().reverse();
	const maxN = Math.max(...years.map((y) => byYear.get(y).length));

	const groups = years.map((y) => {
		const list = byYear.get(y);
		const plan = Plan.planGroup(list.length);
		return `
      <section class="ygroup" id="y${y}" data-year="${y}" aria-labelledby="yh-${y}">
        <header class="ygroup__head">
          <h3 class="ygroup__year" id="yh-${y}">${y}</h3>
          <span class="ygroup__rule" aria-hidden="true"></span>
          <span class="ygroup__meta mono"><b data-total>${list.length}</b> <span data-noun>${list.length === 1 ? ui.story : ui.stories}</span></span>
        </header>
        <ul class="tiles">${list.map((p, i) => tile(p, plan[i], i)).join('')}
        </ul>
      </section>`;
	}).join('');

	/* ---------------------------------------------------------------- rail + filters */
	const rail = years.map((y) => `
          <li><button class="rail__row" type="button" data-year="${y}" aria-pressed="false">
            <i class="rail__dot" aria-hidden="true"></i><span class="rail__y mono">${y}</span>
            <span class="rail__bar" aria-hidden="true"><b style="--w:${Math.max(6, Math.round((byYear.get(y).length / maxN) * 100))}%"></b></span>
            <span class="rail__n mono" data-n>${byYear.get(y).length}</span>
          </button></li>`).join('');

	const tagCount = {};
	posts.forEach((p) => p.tags.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
	const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a] || a.localeCompare(b));
	const chips = tags.map((t) => `<button class="chip" type="button" data-tag="${esc(t)}" aria-pressed="false">${esc(tagLabel(t))} <span class="n">${tagCount[t]}</span></button>`).join('\n            ');

	/* ---------------------------------------------------------------- hero */
	const items = blogHero.items;
	const h0 = items[0];
	const preload = `<link rel="preload" as="image" imagesrcset="${esc(h0.set)}" imagesizes="100vw" fetchpriority="high">`;
	const words = copy.headline.split(/\s+-\s+/);
	const cap = `<span class="ticker__cap"><span class="tick__idx">01 / ${pad2(items.length)}</span>` +
		`<a class="tick__link" href="${h0.href ? esc(h0.href) : '#'}"${h0.href ? '' : ' hidden'}><span class="tick__t">${esc(h0.title || '')}</span><span class="tick__c">${esc(h0.coord || '')}</span></a></span>`;

	const navLinks = copy.nav.map((n, i) => ({ href: n.href, label: n.label, sec: i === 1 ? 'home' : i === 2 ? 'stories' : i === 3 ? 'about' : i === 4 ? 'contact' : '' }));

	const body = `${L.header(ctx, { brandHref: 'index.html', links: navLinks, menu: true })}

<main id="main">
  <section class="hero hero--blog" id="home" aria-label="Hero" data-hero${P.shadeStyle(h0.shade)}>
    <div class="hero__stage" aria-hidden="true">
      <img class="slide is-active" src="${prefix}${encPath(h0.src)}" srcset="${esc(h0.set)}" sizes="100vw" width="${h0.w}" height="${h0.h}"${h0.pos ? ` style="object-position:${esc(h0.pos)}"` : ''} fetchpriority="high" decoding="async" alt="">
    </div>
    <div class="hero__scrim" aria-hidden="true"></div>
    <div class="hero__inner">
      ${P.statement(words, ' - ')}
      <a class="cue" href="#stories"><span>${esc(copy.cue)}</span>${L.ICON.arrowDown}</a>
    </div>
    <div class="hero__foot">
      ${L.ticker(ctx, { caption: cap })}
    </div>
  </section>

  <section class="intro" id="stories" aria-labelledby="stories-h">
    <div class="wrap wrap--wide intro__grid">
      <div class="reveal">
        <p class="eyebrow">${plural(stats.stories, ui.story, ui.stories)}<i class="dotsep" aria-hidden="true"></i>${plural(stats.countries, ui.country, ui.countries)}<i class="dotsep" aria-hidden="true"></i>${esc(stats.yearRange)}</p>
        <h2 class="display" id="stories-h">${esc(copy.stories.title)}</h2>
      </div>
      <p class="lead reveal" style="--d:120ms">${esc(copy.stories.intro)}</p>
    </div>
  </section>

  <section class="atlas-sec atlas-sec--blog has-stars" id="map" aria-label="${esc(ui.map)}">
    <div class="wrap wrap--wide reveal">
      ${P.atlas(ctx)}
      <noscript><p class="mono muted noscript">${esc(ui.mapNoScript)}</p></noscript>
    </div>
  </section>

  <section class="explorer-sec" id="list" aria-label="${esc(ui.allStories)}">
    <div class="wrap wrap--wide">
      <div class="explorer" data-explorer>
        <nav class="rail" aria-label="${esc(ui.yearsNav)}" data-rail>
          <p class="rail__title mono">${esc(ui.timeline)}</p>
          <ol class="rail__list">
            <li><button class="rail__row" type="button" data-year="" aria-pressed="true">
              <i class="rail__dot" aria-hidden="true"></i><span class="rail__y mono">${esc(ui.all)}</span>
              <span class="rail__bar" aria-hidden="true"><b style="--w:100%"></b></span>
              <span class="rail__n mono" data-n>${posts.length}</span>
            </button></li>${rail}
          </ol>
          <div class="rail__map" aria-hidden="true"><div class="dock" data-dock><svg class="dock__dots" focusable="false" preserveAspectRatio="none" viewBox="0 0 360 144"><path class="d0"/><path class="d1"/><path class="d2"/></svg><div class="dock__pins"></div></div></div>
        </nav>

        <div class="explorer__main">
          <div class="filters" data-filters>
            <button class="filters__toggle" type="button" aria-expanded="false" aria-controls="filters-panel"><span>${esc(ui.filter)}</span><b class="filters__n" data-filter-n hidden></b></button>
            <div class="filters__panel" id="filters-panel">
              <span class="filters__label mono">${esc(ui.filter)}</span>
              <div class="filters__row" role="group" aria-label="${esc(ui.tagFilterLabel)}">
            <button class="chip" type="button" data-tag="" aria-pressed="true">${esc(ui.all)} <span class="n">${posts.length}</span></button>
            ${chips}
              </div>
            </div>
          </div>
          <p class="summary mono" id="summary" aria-live="polite"><span><b data-shown>${posts.length}</b> / ${posts.length} ${esc(ui.stories)}</span><button class="summary__clear" type="button" hidden>${esc(ui.clearFilters)}</button></p>
          <p class="empty" id="empty" hidden>${esc(ui.noMatch)}</p>
          ${groups}
        </div>
      </div>
    </div>
  </section>

  <section class="about has-stars" id="about" aria-labelledby="about-h">
    <div class="wrap wrap--md about__grid">
      <div class="reveal">
        <p class="eyebrow">${esc(ui.about)}</p>
        <h2 class="title" id="about-h">${esc(copy.about.name)}</h2>
        ${copy.about.meta.map((m) => `<p class="about__meta">${esc(m)}</p>`).join('\n        ')}
      </div>
      <p class="about__text reveal" style="--d:100ms">${esc(copy.about.text)}</p>
    </div>
  </section>

  <section class="contact has-stars" id="contact" aria-labelledby="contact-h">
    <div class="wrap wrap--narrow reveal">
      <p class="eyebrow">${esc(copy.contact.title)}</p>
      <h2 class="contact__lead" id="contact-h">${esc(copy.contact.lead)}</h2>
      <p class="contact__p">${esc(copy.contact.text)}</p>
      <p><a class="btn" href="${esc(copy.contact.href)}" target="_blank" rel="noopener noreferrer">${esc(copy.contact.button)}</a></p>
    </div>
  </section>
</main>

${L.footer(`<p>${esc(copy.footer)}</p>`)}
${L.inlineJson('FF_HERO', items.map((s) => ({ src: prefix + encPath(s.src), set: s.set, w: s.w, h: s.h, shade: (s.shade && s.shade.d) || 0, shadeM: (s.shade && s.shade.m) || 0, pos: s.pos || '', href: s.href || '', title: s.title || '', coord: s.coord || '' })))}`;

	return L.page({
		ctx, template: 'blog-index.js', bodyClass: 'page-blog', body, preload,
		title: copy.title, description: shorten(copy.stories.intro, 155),
		pagePath: 'blog/index.html', og: ctx.og.blog,
		scripts: ['assets/data/world-dots.js', 'assets/data/stories.js', 'assets/js/plan-group.js', 'assets/js/ff.js', 'assets/js/ff-map.js'],
	});
};
