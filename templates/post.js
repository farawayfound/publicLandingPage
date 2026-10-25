'use strict';
/* templates/post.js - one story page: Public_html/blog/pages/<slug>.html
 * Sections: cover hero > story (title, text, sticky locator, full-bleed photo breaks) > justified gallery > prev/next. */
const { esc, encPath, fmtCoord, fmtLat, fmtLon, pad2, plural, titleCase } = require('../scripts/lib/util');
const { pickBreaks, describe } = require('../scripts/lib/content');
const { locatorSvg } = require('../scripts/lib/dots');
const L = require('./layout');
const P = require('./parts');
const { WIDTHS, VIEW_MIN_BYTES } = require('../scripts/lib/images');

module.exports = function post(ctx, p, idx) {
	const { site, posts, images } = ctx;
	const ui = site.ui;
	const prefix = ctx.prefix; // '../../'
	const older = posts[idx + 1] || null; // "Previous story" = earlier in time
	const newer = posts[idx - 1] || null; // "Next story"     = later in time
	const tagLabel = (t) => site.tagLabels[t] || titleCase(t);

	/* ------------------------------------------------------------ cover */
	const cover = images.variants(p.cover, WIDTHS.cover);
	const cfb = cover.pick(1600);
	const preload = `<link rel="preload" as="image" imagesrcset="${esc(cover.srcset(prefix, encPath))}" imagesizes="100vw" fetchpriority="high">`;
	const pos = p.coverPosition ? `object-position:${p.coverPosition}` : '';

	/* ------------------------------------------------------------ photos */
	const altOf = (ph) => ph.alt || [ph.caption, p.location].filter(Boolean).join(' — ') || p.title;
	// the lightbox shows a 1600px WebP where the original is a heavy JPEG (the original stays the link target and the sharpest candidate)
	const viewSet = (ph) => { const v = images.variants(ph.src, WIDTHS.view, { original: true, maxOriginal: 3000, minBytes: VIEW_MIN_BYTES }); return v && v.list.length > 1 ? v.srcset(prefix, encPath) : ''; };
	const anchor = (ph, i, inner) => { const set = viewSet(ph); return `<a href="${prefix}${encPath(ph.src)}" data-lb="${i}" data-cap="${esc(ph.caption)}" data-alt="${esc(altOf(ph))}"${set ? ` data-set="${esc(set)}"` : ''} aria-label="${esc(`Open photo ${i + 1} of ${p.photos.length}: ${altOf(ph)}`)}">${inner}</a>`; };

	const breaks = pickBreaks(p);
	const breakAt = new Map(breaks.map((b) => [b.after, b]));
	const used = new Set(breaks.map((b) => b.index));

	const breakFigure = (b) => {
		const ph = p.photos[b.index];
		const v = images.variants(ph.src, WIDTHS.cover, { original: true, maxOriginal: 2600 });
		const ar = Math.min(2.4, Math.max(1.45, ph.w / ph.h)).toFixed(3); // the photo's own ratio (pickBreaks only takes frames of 1.45 or wider): never cropped
		return `
      <figure class="full reveal" style="--ar:${ar}">
        ${anchor(ph, b.index, P.img(v, { prefix, alt: altOf(ph), sizes: '100vw', pick: 1600 }))}
        ${ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : ''}
      </figure>`;
	};

	const gallery = p.photos.map((ph, i) => {
		if (used.has(i)) return '';
		const v = images.variants(ph.src, WIDTHS.photo, { original: true, maxOriginal: 1000 });
		const r = ph.w / ph.h;
		return `
        <li class="jg__item" style="--r:${r.toFixed(4)}">
          ${anchor(ph, i, `${P.img(v, { prefix, alt: altOf(ph), sizes: '(max-width: 700px) 50vw, (max-width: 1100px) 34vw, 420px', pick: 960 })}${ph.caption ? `<span class="jg__cap" aria-hidden="true">${esc(ph.caption)}</span>` : ''}`)}
        </li>`;
	}).join('');

	/* ------------------------------------------------------------ locator (static; no JavaScript) */
	const loc = p.coords ? locatorSvg(ctx.world, p.lat, p.lon) : null;
	const place = (p.location.split(',')[0] || p.title).trim();
	const tagLinks = p.tags.map((t) => `<a class="tagchip" href="../index.html#tag=${encodeURIComponent(t)}">${esc(tagLabel(t))}</a>`).join('');
	const facts = [
		`<div><dt class="mono">${esc(ui.date)}</dt><dd><time datetime="${esc(p.date)}">${esc(p.dateLabel)}</time></dd></div>`,
		p.location ? `<div><dt class="mono">${esc(ui.place)}</dt><dd>${esc(p.location)}</dd></div>` : '',
		p.region ? `<div><dt class="mono">${esc(ui.region)}</dt><dd>${esc(p.region)}</dd></div>` : '',
		p.coords ? `<div><dt class="mono">${esc(ui.coordinates)}</dt><dd class="mono">${fmtCoord(p.coords)}</dd></div>` : '',
		p.photos.length ? `<div><dt class="mono">${esc(ui.photos)}</dt><dd class="mono">${p.photos.length}</dd></div>` : '',
		p.tags.length ? `<div><dt class="mono">${esc(ui.tags)}</dt><dd class="tagrow">${tagLinks}</dd></div>` : '',
	].filter(Boolean).join('\n            ');

	const locator = `
      <aside class="locator" aria-label="${esc(ui.place)}" data-locator>
        ${loc ? `<figure class="loc__map" role="img" aria-label="${esc(`${ui.map}: ${p.location || place}`)}">
          ${loc.svg}
          <span class="loc__pin" style="left:${loc.pin.x}%;top:${loc.pin.y}%"><i aria-hidden="true"></i><span class="loc__label mono">${esc(place)}</span></span>
        </figure>` : ''}
        <dl class="facts">
            ${facts}
        </dl>
        <a class="link-arrow link-arrow--sm" href="../index.html#map">${esc(ui.map)}</a>
      </aside>`;

	/* ------------------------------------------------------------ text with locator after paragraph 1 and photo breaks */
	const text = [];
	p.paragraphs.forEach((t, i) => {
		const cls = i === 0 ? (t.length <= 700 ? ' class="is-lead"' : ' class="is-drop"') : '';
		text.push(`<p${cls}>${esc(t)}</p>`);
		if (i === 0) text.push(locator);
		if (breakAt.has(i + 1)) text.push(breakFigure(breakAt.get(i + 1)));
	});
	if (!p.paragraphs.length) text.push(locator);

	/* ------------------------------------------------------------ prev / next */
	const nav = (s, dir) => {
		if (!s) return '';
		const v = images.variants(s.cardSrc, WIDTHS.card);
		return `<a class="snav snav--${dir}" href="${esc(s.slug)}.html" rel="${dir === 'prev' ? 'prev' : 'next'}">
          ${P.img(v, { prefix, alt: '', sizes: '(max-width: 820px) 92vw, 33vw', pick: 960 })}
          <span class="snav__body">
            <span class="snav__dir mono">${esc(dir === 'prev' ? ui.previousStory : ui.nextStory)}</span>
            <span class="snav__title">${esc(s.cardTitle)}</span>
            <span class="snav__meta mono">${esc(s.dateLabel)}</span>
          </span>
        </a>`;
	};

	const titleHtml = P.statement([p.title], '', 'frame--post');
	const subtitle = p.subtitle ? `<p class="hero__sub">${esc(p.subtitle)}</p>` : '';
	const metaBits = [p.dateLabel, p.location].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('<i aria-hidden="true"></i>');
	const og = ctx.og.post(p);

	const body = `<div class="progress" data-progress aria-hidden="true"></div>
${L.header(ctx, { brandHref: '../index.html', links: [{ href: '../index.html#list', label: ui.allStories }, { href: '../index.html#map', label: ui.map }] })}

<main id="main">
  <section class="hero hero--post" aria-label="Cover"${P.shadeStyle(ctx.tone.shades(p.cover, p.coverPosition, 'post', p.heroShade))}>
    <div class="hero__stage" aria-hidden="true">
      ${P.img(cover, { prefix, alt: '', cls: 'slide is-active is-single', sizes: '100vw', eager: true, pick: 1600, style: pos })}
    </div>
    <div class="hero__scrim" aria-hidden="true"></div>
    <div class="hero__inner">
      <p class="hero__meta">${metaBits}</p>
      ${titleHtml}
      ${subtitle}
      <a class="cue" href="#story"><span>${esc(p.scrollCue)}</span>${L.ICON.arrowDown}</a>
    </div>
  </section>

  <article class="story" id="story" aria-labelledby="story-h">
    <div class="story__body">
      <h2 class="story__title reveal" id="story-h">${esc(p.sectionTitle || p.title)}</h2>
      ${text.join('\n      ')}
    </div>
  </article>

  ${p.photos.length ? `<section class="gallery-sec" id="photos" aria-labelledby="photos-h">
    <div class="wrap wrap--wide">
      <header class="row-head reveal">
        <h2 class="title title--sm" id="photos-h">${esc(ui.photosHeading)}</h2>
        <span class="mono muted">${plural(p.photos.length, ui.photo, ui.photos)}</span>
      </header>
      <div class="jg-wrap">
        <ul class="jg" data-gallery>${gallery}
        </ul>
      </div>
    </div>
  </section>` : ''}

  <nav class="storynav" aria-label="${esc(ui.moreStories)}">
    <div class="wrap wrap--wide storynav__grid${older && newer ? '' : ' storynav__grid--two'}">
      ${nav(older, 'prev')}
      <a class="snav snav--all" href="../index.html#list"><span class="snav__all mono">${plural(posts.length, ui.story, ui.stories)}</span><span class="snav__title">${esc(ui.allStories)}</span></a>
      ${nav(newer, 'next')}
    </div>
  </nav>
</main>

${L.footer(`<p>${esc(site.blog.footer)}</p><p class="foot__links"><a href="../index.html#list">${esc(ui.allStories)}</a> <span aria-hidden="true">&middot;</span> <a href="../../index.html">${esc(site.blog.nav[0].label)}</a></p>`)}`;

	return L.page({
		ctx, template: 'post.js', bodyClass: 'page-post', body, preload,
		title: `${site.site.name} — ${p.titleTag || p.title}`, description: describe(p),
		pagePath: `blog/pages/${p.slug}.html`, og, ogType: 'article',
		scripts: ['assets/js/ff.js'],
	});
};
