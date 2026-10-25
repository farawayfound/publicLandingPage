'use strict';
/* Small building blocks shared by more than one template. */
const { esc, encPath, fmtCoord, fmtNum } = require('../scripts/lib/util');

/**
 * <img> for a set of candidates from Images.variants(). The browser picks from srcset; src is the fallback.
 * o: { prefix, alt, cls, sizes, eager, pick (target px for the fallback), style, attrs }
 */
function img(v, o) {
	const prefix = o.prefix || '';
	const fb = v.pick(o.pick || 960);
	const many = v.list.length > 1;
	const attrs = [];
	if (o.cls) attrs.push(`class="${o.cls}"`);
	attrs.push(`src="${prefix}${encPath(fb.rel)}"`);
	if (many) attrs.push(`srcset="${v.srcset(prefix, encPath)}"`, `sizes="${esc(o.sizes || '100vw')}"`);
	attrs.push(`width="${fb.w}"`, `height="${fb.h}"`);
	attrs.push(o.eager ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"');
	attrs.push(`alt="${esc(o.alt || '')}"`);
	if (o.style) attrs.push(`style="${esc(o.style)}"`);
	if (o.attrs) attrs.push(o.attrs);
	return `<img ${attrs.join(' ')}>`;
}

/** inline custom properties for a hero's flat darkening: s = { d, m } (desktop, phone); nothing when both are 0 */
const shadeStyle = (s) => {
	const css = [s && s.d > 0 ? `--shade:${s.d}` : '', s && s.m > 0 ? `--shade-m:${s.m}` : ''].filter(Boolean).join(';');
	return css ? ` style="${css}"` : '';
};

/** The boxed, white-bordered hero title: four lines that draw themselves, words that rise in. */
function statement(words, separator, cls) {
	const lines = '<i class="frame__l frame__l--t"></i><i class="frame__l frame__l--r"></i><i class="frame__l frame__l--b"></i><i class="frame__l frame__l--l"></i>';
	const inner = words.length > 1
		? words.map((t, i) => `<span class="w"><span style="--i:${i}">${esc(t)}</span></span>`).join(`<span class="sep" aria-hidden="true">${esc(separator)}</span>`)
		: esc(words[0]);
	return `<h1 class="statement frame${cls ? ' ' + cls : ''}">
        ${lines}
        <span class="statement__text">${inner}</span>
      </h1>`;
}

/** Hero counts (count-up numbers; the HTML always carries the final value). */
function counts(ctx, stats) {
	const ui = ctx.site.ui;
	const item = (label, n) => `<div><dt>${esc(label)}</dt><dd data-count="${n}">${fmtNum(n)}</dd></div>`;
	return `<dl class="counts" aria-label="${esc(ui.totals)}">
        ${item(stats.stories === 1 ? ui.story : ui.stories, stats.stories)}
        ${item(stats.countries === 1 ? ui.country : ui.countries, stats.countries)}
        ${item(ui.photos, stats.photos)}
      </dl>`;
}

/** The interactive dot-matrix map shell; assets/js/ff-map.js fills it. */
function atlas(ctx, o = {}) {
	const ui = ctx.site.ui;
	return `<div class="atlas" id="${o.id || 'atlas'}" data-atlas>
        <div class="atlas__top"><div class="atlas__regions" role="group" aria-label="${esc(ui.map)}" hidden></div></div>
        <div class="atlas__view" role="group" aria-label="${esc(ui.mapLabel)}">
          <svg class="atlas__dots" aria-hidden="true" focusable="false" preserveAspectRatio="none" viewBox="0 0 360 144"><path class="d0"/><path class="d1"/><path class="d2"/></svg>
          <svg class="atlas__grid" aria-hidden="true" focusable="false"></svg>
          <div class="atlas__pins"></div>
          <div class="atlas__pop" role="region" aria-label="${esc(ui.preview)}"></div>
        </div>
      </div>`;
}

module.exports = { img, statement, counts, atlas, fmtCoord, shadeStyle };
