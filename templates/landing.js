'use strict';
/* templates/landing.js - the hub page: Public_html/index.html
 * Sections: hero slideshow (pill, tagline, counts) > two destination cards > latest stories strip > map band. */
const { esc, encPath, fmtCoord, fmtNum } = require('../scripts/lib/util');
const L = require('./layout');
const P = require('./parts');
const { WIDTHS } = require('../scripts/lib/images');

module.exports = function landing(ctx) {
	const { site, posts, stats, images, landing: hero } = ctx;
	const copy = site.landing;
	const ui = site.ui;
	const prefix = ctx.prefix; // ''

	/* --- hero slides: derived WebP candidates for every Landing photo --- */
	const slides = hero.items; // [{set, src, w, h}] first is the lead image
	const first = slides[0];
	const preload = `<link rel="preload" as="image" imagesrcset="${esc(first.set)}" imagesizes="100vw" fetchpriority="high">`;

	const pill = copy.headline.map((w) => esc(w)).join(`<span class="sep" aria-hidden="true">${esc(copy.headlineSeparator)}</span>`);

	/* --- destination cards (the owner's white cards) --- */
	const clip = ctx.clip;
	const cardMedia = (c) => {
		if (c.id === 'professional') {
			return `<div class="card__media card__media--terminal" id="terminal-card" role="img" aria-label="${esc(c.mediaLabel)}">
              <div class="t-static" aria-hidden="true">${ctx.terminalStill}</div>
            </div>`;
		}
		const sources = [clip.webm ? `<source src="${prefix}${encPath(clip.webm)}" type="video/webm">` : '', `<source src="${prefix}${encPath(clip.mp4 || clip.original)}" type="video/mp4">`].filter(Boolean).join('\n                ');
		return `<div class="card__media card__media--blog">
              <video muted loop playsinline preload="none"${clip.poster ? ` poster="${prefix}${encPath(clip.poster)}"` : ''} width="852" height="480" aria-hidden="true" tabindex="-1" data-lazyvideo>
                ${sources}
              </video>
            </div>`;
	};
	const cards = copy.cards.map((c, i) => `
        <article class="card reveal"${i ? ` style="--d:90ms"` : ''}>
          <a href="${esc(c.href)}"${c.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>
            ${cardMedia(c)}
            <div class="card__body">
              <span class="card__label">${esc(c.label)}</span>
              <h2>${esc(c.title)}</h2>
              <p>${esc(c.text)}</p>
              <span class="card__cta">${esc(c.cta)}</span>
            </div>
          </a>
        </article>`).join('\n');

	/* --- latest stories strip (card thumbnails, never covers) --- */
	const latest = posts.slice(0, 8).map((p, i) => {
		const v = images.variants(p.cardSrc, WIDTHS.card);
		return `
        <li class="poster">
          <a href="blog/pages/${esc(p.slug)}.html" aria-label="${esc(p.cardTitle)} — ${esc(p.dateLabel)}">
            ${P.img(v, { prefix, alt: '', sizes: '(max-width: 700px) 62vw, 23vw', pick: 480 })}
            <span class="poster__veil" aria-hidden="true"></span>
            <span class="poster__text"><span class="poster__meta">${esc(p.dateLabel)}</span><span class="poster__title">${esc(p.cardTitle)}</span></span>
          </a>
        </li>`;
	}).join('');

	const statsDl = `<dl class="stats mono">
          <div><dt>${esc(ui.stories)}</dt><dd>${fmtNum(stats.stories)}</dd></div>
          <div><dt>${esc(ui.countries)}</dt><dd>${fmtNum(stats.countries)}</dd></div>
          <div><dt>${esc(ui.years)}</dt><dd>${esc(stats.yearRange)}</dd></div>
          <div><dt>${esc(ui.photos)}</dt><dd>${fmtNum(stats.photos)}</dd></div>
        </dl>`;

	const f = copy.footer;
	const footerLinks = f.links.map((l) => `<a href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(l.label)}</a>`).join(esc(f.separator));

	const body = `${L.header(ctx, {
		brandHref: 'index.html',
		links: [
			{ href: 'blog/index.html', label: copy.footer.links[0].label },
			{ href: '#map', label: ui.map },
			{ href: copy.cards[0].href, label: copy.footer.links[1].label, external: true },
		],
	})}

<main id="main">
  <section class="hero hero--home" id="home" aria-label="Hero" data-hero${P.shadeStyle(first.shade)}>
    <div class="hero__stage" aria-hidden="true">
      <img class="slide is-active" src="${prefix}${encPath(first.src)}" srcset="${esc(first.set)}" sizes="100vw" width="${first.w}" height="${first.h}" fetchpriority="high" decoding="async" alt="">
    </div>
    <div class="hero__scrim" aria-hidden="true"></div>
    <div class="hero__inner">
      <h1 class="hero__badge">${pill}</h1>
      <p class="hero__tagline">${esc(copy.tagline)}</p>
      <a class="cue" href="#destinations"><span>${esc(copy.sub)}</span>${L.ICON.arrowDown}</a>
    </div>
    <div class="hero__foot">
      ${P.counts(ctx, stats)}
      ${L.ticker(ctx, { caption: `<span class="ticker__cap"><span class="tick__idx" id="tick-n">01 / ${String(slides.length).padStart(2, '0')}</span></span>` })}
    </div>
  </section>

  <section class="dest" id="destinations" aria-label="Destinations">
    <div class="wrap wrap--md">
      <div class="cards">${cards}
      </div>
    </div>
  </section>

  <section class="latest" aria-labelledby="latest-h">
    <div class="wrap">
      <header class="row-head reveal">
        <h2 class="title title--sm" id="latest-h">${esc(ui.latest)}</h2>
        <div class="row-head__ctl">
          <button class="round" type="button" data-strip="-1" aria-label="${esc(ui.previous)}">${L.ICON.chevL}</button>
          <button class="round" type="button" data-strip="1" aria-label="${esc(ui.next)}">${L.ICON.chevR}</button>
          <a class="link-arrow" href="blog/index.html#list">${esc(ui.allStories)}</a>
        </div>
      </header>
    </div>
    <ul class="strip" tabindex="0" aria-label="${esc(ui.latest)}">${latest}
    </ul>
  </section>

  <section class="atlas-sec has-stars" id="map" aria-labelledby="map-h">
    <div class="wrap">
      <header class="atlas-head reveal">
        <div>
          <p class="eyebrow">${esc(ui.explore)}</p>
          <h2 class="title" id="map-h">${esc(ui.map)}</h2>
        </div>
        ${statsDl}
      </header>
      <div class="reveal">
        ${P.atlas(ctx)}
        <noscript><p class="mono muted noscript">${esc(ui.mapNoScript)} <a href="blog/index.html#list">${esc(ui.allStories)}</a></p></noscript>
      </div>
      <p class="atlas-foot reveal"><a class="btn" href="blog/index.html#list">${esc(ui.allStories)}</a></p>
    </div>
  </section>
</main>

${L.footer(`<p>${esc(f.before)}${footerLinks}</p>`)}
${L.inlineJson('FF_HERO', slides.map((s) => ({ src: prefix + encPath(s.src), set: s.set, w: s.w, h: s.h, shade: (s.shade && s.shade.d) || 0, shadeM: (s.shade && s.shade.m) || 0 })))}`;

	return L.page({
		ctx, template: 'landing.js', bodyClass: 'page-home', body, preload,
		title: copy.title, description: copy.description, pagePath: '',
		og: ctx.og.home,
		scripts: ['assets/data/world-dots.js', 'assets/data/stories.js', 'assets/js/ff.js', 'assets/js/ff-map.js', 'assets/js/terminal.js'],
	});
};
