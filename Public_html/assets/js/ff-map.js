/* ==========================================================================
   FarawayFound - the dot-matrix map. Vanilla JS, no tiles, no network.
   Needs window.FF_WORLD (assets/data/world-dots.js) and window.FF_STORIES (assets/data/stories.js).

   Atlas  the interactive map (landing "Map" band and the story index): region chips, agglomerative clusters sized
          by sqrt(n) with a soft peach glow, hover/tap photo card, list popover, keyboard + Esc handling.
   Dock   the small map beside the timeline rail; it follows the active year and the hovered tile.
   The story page locator is drawn at build time (no JavaScript).
   ========================================================================== */
(function () {
	'use strict';

	var D = document, W = window, R = D.documentElement;
	var REDUCE = !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches);
	var safe = (W.FF && W.FF.safe) || function (n, fn) { try { fn(); } catch (e) { if (W.console) console.error('[ff-map:' + n + ']', e); } };

	function $(s, c) { return (c || D).querySelector(s); }
	function $$(s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); }
	function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function raf(fn) { return W.requestAnimationFrame ? W.requestAnimationFrame(fn) : setTimeout(fn, 16); }
	function fmtLat(v) { return Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'N' : 'S'); }
	function fmtLon(v) { v = ((v + 540) % 360) - 180; return Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'E' : 'W'); }
	function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
	var BASE = D.documentElement.getAttribute('data-base') || ''; // site root relative to this page

	/* ---------------------------------------------------------------- data */
	function decodeWorld(w) {
		var out = [], half = w.step / 2;
		w.rows.forEach(function (r) { r[1].forEach(function (run) { for (var k = 0; k < run[1]; k++) out.push([+(-180 + (run[0] + 2 * k) * half).toFixed(2), r[0]]); }); });
		return out;
	}
	var DOTS = W.FF_WORLD ? decodeWorld(W.FF_WORLD) : [];
	var STEP = W.FF_WORLD ? W.FF_WORLD.step : 1.6;
	var STORIES = (W.FF_STORIES || []).filter(function (s) { return isFinite(s.lat) && isFinite(s.lon); });
	if (!DOTS.length || !STORIES.length) { R.classList.add('no-map'); return; } // data files missing: hide the empty frames

	var REGIONS = [
		{ id: 'world', label: 'World', b: [-180, -58, 180, 82] },
		{ id: 'na', label: 'North America', b: [-170, 12, -52, 72] },
		{ id: 'sa', label: 'South America', b: [-92, -57, -32, 14] },
		{ id: 'eu', label: 'Europe', b: [-14, 34, 42, 71] },
		{ id: 'af', label: 'Africa', b: [-20, -36, 54, 38] },
		{ id: 'as', label: 'Asia', b: [42, -12, 150, 58] },
		{ id: 'oc', label: 'Oceania', b: [110, -50, 180, -4] }
	];
	function inBounds(s, b) { return s.lon >= b[0] && s.lon <= b[2] && s.lat >= b[1] && s.lat <= b[3]; }
	function niceStep(d) { var s = [5, 10, 15, 30, 45, 60, 90]; for (var i = 0; i < s.length; i++) if (s[i] >= d) return s[i]; return 90; }
	function boundsOf(list) {
		var lons = list.map(function (s) { return s.lon; }), lats = list.map(function (s) { return s.lat; });
		return [Math.min.apply(null, lons), Math.min.apply(null, lats), Math.max.apply(null, lons), Math.max.apply(null, lats)];
	}

	/* ---------------------------------------------------------------- dot layer (three SVG paths: far, near, lit)
	   World view: the data's own dots (1.6 degree pitch). Zoomed in, those dots would sit 40-70px apart and read as a sparse
	   chessboard, so the land is re-sampled instead: a finer lattice, fixed to the screen (a dot-matrix display), where a dot is
	   lit when a land dot lies within ~0.9 pitch of it. Small islands survive and coasts follow the data. */
	var FINE_PITCH = 14, FINE_FROM = 19;      // finer lattice pitch in px; used once the data's own dots are more than FINE_FROM px apart
	var HASH = null;
	function landHash() {
		if (HASH) return HASH;
		HASH = {};
		DOTS.forEach(function (d) { var k = Math.floor(d[0] / STEP) + ',' + Math.floor(d[1] / STEP); (HASH[k] = HASH[k] || []).push(d); });
		return HASH;
	}
	function isLand(lon, lat) {
		var h = landHash(), cx = Math.floor(lon / STEP), cy = Math.floor(lat / STEP), r2 = STEP * STEP * 0.31, i, j, k, list, d;
		for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) {
			list = h[(cx + i) + ',' + (cy + j)]; if (!list) continue;
			for (k = 0; k < list.length; k++) { d = list[k]; if ((d[0] - lon) * (d[0] - lon) + (d[1] - lat) * (d[1] - lat) <= r2) return true; }
		}
		return false;
	}
	function DotLayer(svg) {
		var p0 = $('.d0', svg), p1 = $('.d1', svg), p2 = $('.d2', svg);
		var stories = [], coarse = null, fine = false;
		function dist(lon, lat) {                 // degrees to the nearest story (longitude scaled by latitude)
			var best = 1e9, c = Math.cos(lat * Math.PI / 180), j;
			for (j = 0; j < stories.length; j++) {
				var dl = Math.abs(lon - stories[j].lon); if (dl > 180) dl = 360 - dl;
				var dx = dl * c, dy = lat - stories[j].lat, d = dx * dx + dy * dy;
				if (d < best) best = d;
			}
			return Math.sqrt(best);
		}
		function paths(base, near, hot) { p0.setAttribute('d', base.join('')); p1.setAttribute('d', near.join('')); p2.setAttribute('d', hot.join('')); }
		return {
			/* dots close to a story light up: a footprint of where the stories have been */
			footprint: function (list) {
				stories = list;
				var base = [], near = [], hot = [], i;
				for (i = 0; i < DOTS.length; i++) {
					var seg = 'M' + DOTS[i][0] + ' ' + (-DOTS[i][1]) + 'h0', best = list.length ? dist(DOTS[i][0], DOTS[i][1]) : 1e9;
					if (best < 3.2) hot.push(seg); else if (best < 8) near.push(seg); else base.push(seg);
				}
				coarse = { base: base, near: near, hot: hot };
				paths(base, near, hot);
				fine = false;
			},
			/* viewBox in degrees; stroke width in degrees so the dot diameter is a fixed share of the dot pitch.
			   cw/ch (the panel size in px) switch on the finer lattice when zoomed in. */
			view: function (x0, yTop, span, spanLat, ppd, cw, ch) {
				svg.setAttribute('viewBox', x0 + ' ' + (-yTop) + ' ' + span + ' ' + spanLat);
				var useFine = !!(cw && STEP * ppd > FINE_FROM), dotPx;
				if (useFine) {
					var pitch = FINE_PITCH / ppd, base = [], near = [], hot = [], row, col, rows = Math.ceil(ch / FINE_PITCH) + 1, cols = Math.ceil(cw / FINE_PITCH) + 2;
					for (row = 0; row < rows; row++) {
						var lat = yTop - row * pitch;
						for (col = -1; col < cols; col++) {
							var lon = x0 + (col + (row & 1 ? 0.5 : 0)) * pitch;
							if (!isLand(lon, lat)) continue;
							var seg = 'M' + (+lon.toFixed(4)) + ' ' + (+(-lat).toFixed(4)) + 'h0', best = stories.length ? dist(lon, lat) : 1e9;
							if (best < 3.2) hot.push(seg); else if (best < 8) near.push(seg); else base.push(seg);
						}
					}
					paths(base, near, hot);
					fine = true;
					dotPx = FINE_PITCH * 0.4;
				} else {
					if (fine && coarse) paths(coarse.base, coarse.near, coarse.hot);
					fine = false;
					dotPx = clamp(STEP * ppd * 0.5, 1.3, 9.5);
				}
				var sw = (dotPx / ppd).toFixed(4);
				p0.setAttribute('stroke-width', sw); p1.setAttribute('stroke-width', sw); p2.setAttribute('stroke-width', sw);
			}
		};
	}

	/* ---------------------------------------------------------------- clusters: merge the closest overlapping pair until nothing overlaps */
	function clusterize(list, project, radiusOf, gap) {
		var out = list.map(function (s) { var p = project(s.lon, s.lat); return { items: [s], lon: s.lon, lat: s.lat, x: p[0], y: p[1] }; });
		for (var guard = 0; guard < 600; guard++) {
			var bi = -1, bj = -1, bd = 1e9;
			for (var i = 0; i < out.length; i++) for (var j = i + 1; j < out.length; j++) {
				var dx = out[i].x - out[j].x, dy = out[i].y - out[j].y;
				var room = Math.sqrt(dx * dx + dy * dy) - (radiusOf(out[i]) + radiusOf(out[j]) + gap);
				if (room < 0 && room < bd) { bd = room; bi = i; bj = j; }
			}
			if (bi < 0) break;
			var A = out[bi], B = out[bj], na = A.items.length, nb = B.items.length;
			A.items = A.items.concat(B.items);
			A.lon = (A.lon * na + B.lon * nb) / (na + nb); A.lat = (A.lat * na + B.lat * nb) / (na + nb);
			var q = project(A.lon, A.lat); A.x = q[0]; A.y = q[1];
			out.splice(bj, 1);
		}
		return out;
	}

	/* ================================================================ Atlas */
	function Atlas(root) {
		var viewEl = $('.atlas__view', root), svg = $('.atlas__dots', root), gridEl = $('.atlas__grid', root);
		var pinsEl = $('.atlas__pins', root), popEl = $('.atlas__pop', root), regionsEl = $('.atlas__regions', root);
		var layer = DotLayer(svg);
		var all = STORIES.slice(), list = all.slice();
		var cw = 1, ch = 1, v = { lon: 0, lat: 12, span: 360 }, vb = { x0: -180, yTop: 80, ppd: 1 };
		var compact = false, regionId = 'world', mode = 'auto', clusters = [], tween = null, hotSlug = null;   // mode: 'auto' (the page picks the view), 'region' (a chip was chosen), 'free' (zoomed into a cluster)
		var popOwner = null, popTimer = null, lastPointer = 'mouse', popInteractive = false;
		var MIN_SPAN = 118; // the dot data has a 1.6 degree pitch: never zoom past a continental view
		var HMIN = 190, HMAX = 470;

		function measure() { var r = viewEl.getBoundingClientRect(); cw = Math.max(1, r.width); ch = Math.max(1, r.height); compact = cw < 560; root.classList.toggle('is-compact', compact); }

		/* A view that frames bounds b. On phones the panel height follows the view (a world strip is short, a continent is
		   taller) so the map never floats in a mostly empty box; on wider screens the CSS aspect ratio decides the box. */
		function fit(b, pad, minSpan) {
			pad = pad == null ? 0.14 : pad; minSpan = minSpan || MIN_SPAN;
			var w = Math.max((b[2] - b[0]) * (1 + pad * 2), 1), h = Math.max((b[3] - b[1]) * (1 + pad * 2), 1);
			var view = { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
			if (compact) {
				// keep a bubble's radius of breathing room on every side, so no cluster is ever cut off by the panel edge
				var M = 28, span = clamp(Math.max(w * cw / (cw - 2 * M), h * cw / HMAX, minSpan), minSpan, 460), ppd = cw / span;
				view.span = span; view.h = clamp(h * ppd + 2 * M, HMIN, HMAX);
			} else {
				view.span = clamp(Math.max(w, h * cw / ch, minSpan), minSpan, 360);
			}
			return view;
		}
		function worldView() { return fit([-180, -58, 180, 82], 0.02, compact ? 380 : 360); }
		function dataView() { var b = boundsOf(list.length ? list : all); var f = fit(b, 0.2, compact ? 70 : MIN_SPAN); return f.span > (compact ? 340 : 300) ? worldView() : f; }
		function regionById(id) { return REGIONS.filter(function (x) { return x.id === id; })[0]; }
		/* most stories are in one place (77 of 85 are in North America): open on that region, with the World chip one tap away.
		   Needs 3+ stories and 75% of them inside a region; otherwise the whole world. Phones keep fitting the data. */
		function autoRegion() {
			var n = list.length, i;
			if (compact || n < 3) return 'world';
			for (i = 1; i < REGIONS.length; i++) if (list.filter(function (s) { return inBounds(s, REGIONS[i].b); }).length >= n * 0.75) return REGIONS[i].id;
			return 'world';
		}
		function homeView() {
			if (compact) return dataView();
			var id = autoRegion();
			return id === 'world' ? worldView() : fit(regionById(id).b, 0.06, MIN_SPAN);
		}
		function homeId(view) { return compact ? (view.span < 360 ? 'fit' : 'world') : autoRegion(); }

		function viewH(view) { return compact && view.h ? view.h : ch; }
		function project(lon, lat) { return [(lon - vb.x0) * vb.ppd, (vb.yTop - lat) * vb.ppd]; }

		function renderMap() {
			var h = viewH(v);
			if (compact && Math.abs(h - ch) > 0.5) { ch = h; viewEl.style.aspectRatio = 'auto'; viewEl.style.height = h.toFixed(1) + 'px'; }
			var ppd = cw / v.span, spanLat = h / ppd;
			vb.ppd = ppd; vb.x0 = v.lon - v.span / 2; vb.yTop = v.lat + spanLat / 2;
			layer.view(+vb.x0.toFixed(4), +vb.yTop.toFixed(4), +v.span.toFixed(4), +spanLat.toFixed(4), ppd, cw, h);
			drawGrid(spanLat);
			placePins();
		}

		function drawGrid(spanLat) {
			var ppd = vb.ppd, step = niceStep(104 / ppd), out = '', lab = '', g, x, y, labels = !compact;
			var latBottom = vb.yTop - spanLat;
			for (g = Math.ceil(latBottom / step) * step; g <= vb.yTop; g += step) {
				if (g < -90 || g > 90) continue;
				y = (vb.yTop - g) * ppd;
				out += '<line x1="0" x2="' + cw.toFixed(0) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"' + (g === 0 ? ' class="eq"' : '') + '/>';
				if (labels && y > 30 && y < ch - 10) lab += '<text x="10" y="' + (y - 5).toFixed(1) + '">' + (g === 0 ? '0°' : fmtLat(g)) + '</text>';
			}
			for (g = Math.ceil(vb.x0 / step) * step; g <= vb.x0 + v.span; g += step) {
				if (g < -180 || g > 180) continue;
				x = (g - vb.x0) * ppd;
				out += '<line y1="0" y2="' + ch.toFixed(0) + '" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '"' + (g === 0 ? ' class="eq"' : '') + '/>';
				if (labels && x > 30 && x < cw - 36) lab += '<text x="' + (x + 5).toFixed(1) + '" y="15">' + (g === 0 ? '0°' : fmtLon(g)) + '</text>';
			}
			gridEl.setAttribute('viewBox', '0 0 ' + cw.toFixed(0) + ' ' + ch.toFixed(0));
			gridEl.innerHTML = out + lab;
		}

		/* bubble diameter grows with the square root of the count; radius and halo are capped; on touch screens nothing is smaller
		   than a 44px tap target, and the clustering uses the same size so bubbles never overlap */
		var TOUCH = !!(W.matchMedia && W.matchMedia('(pointer: coarse)').matches), MIN_HIT = TOUCH ? 44 : 0;
		function bubble(n) { return Math.max(MIN_HIT, compact ? clamp(20 + 2 * Math.sqrt(n), 24, 32) : clamp(24 + 2.4 * Math.sqrt(n), 30, 40)); }
		function haloFor(size) { return Math.round(Math.min(size * (compact ? 2.1 : 2.6), compact ? 64 : 100)); }
		function radiusOf(c) { return c.items.length === 1 ? Math.max(7, MIN_HIT / 2) : bubble(c.items.length) / 2; }

		function rebuildPins() {
			hidePop(true);
			var focusFirst = pinsEl.contains(D.activeElement) ? D.activeElement.getAttribute('data-first') : null;
			pinsEl.innerHTML = '';
			clusters = clusterize(list, project, radiusOf, compact ? 6 : 12);   // the gap also leaves room for the hover growth and the glow
			clusters.forEach(function (c, idx) {
				var node, s = c.items[0], n = c.items.length, size = n === 1 ? 22 : bubble(n);
				if (n === 1) {
					node = D.createElement('a');
					node.className = 'pin';
					node.href = BASE + encPath(s.p);
					node.setAttribute('aria-label', s.t + ', ' + s.dl);
					node.innerHTML = '<span class="pin__hit"><i class="pin__ring"></i><i class="pin__core"></i></span>';
					node.style.setProperty('--pd', ((idx * 0.41) % 3.4).toFixed(2) + 's');
				} else {
					node = D.createElement('button');
					node.type = 'button';
					node.className = 'pin pin--cluster';
					node.setAttribute('aria-label', clusterLabel(c) + ' — open list');
					node.setAttribute('aria-haspopup', 'true');
					node.style.setProperty('--s', Math.round(size) + 'px');
					node.innerHTML = '<span class="pin__hit"><b>' + n + '</b></span>';
				}
				node.style.setProperty('--halo', haloFor(size) + 'px');
				node.setAttribute('data-first', s.s);
				c.node = node;
				bindPin(node, c);
				pinsEl.appendChild(node);
			});
			applyState();
			placePins();
			if (focusFirst) { var back = pinsEl.querySelector('[data-first="' + focusFirst + '"]'); if (back) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
		}

		/* "43 stories in North America" / "4 stories near Acadia National Park": a count and where, not just the newest story's name */
		function clusterLabel(c) {
			var n = c.items.length, place = (c.items[0].loc || c.items[0].t).split(',')[0], i;
			if (n <= 6) return n + ' stories near ' + place;
			for (i = 1; i < REGIONS.length; i++) if (inBounds({ lon: c.lon, lat: c.lat }, REGIONS[i].b)) return n + ' stories in ' + REGIONS[i].label;
			return n + ' stories near ' + place;
		}

		function placePins() {
			clusters.forEach(function (c) {
				var p = project(c.lon, c.lat);
				c.x = p[0]; c.y = p[1];
				var off = p[0] < -40 || p[0] > cw + 40 || p[1] < -40 || p[1] > ch + 40;
				c.node.style.display = off ? 'none' : '';
				c.node.style.transform = 'translate3d(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px,0)';
			});
			if (popOwner && popEl.classList.contains('is-open')) positionPop();
		}
		function applyState() { clusters.forEach(function (c) { c.node.classList.toggle('is-hot', !!hotSlug && c.items.some(function (s) { return s.s === hotSlug; })); }); }

		/* ---- the photo card / list popover
		   A single story: a photo card beside the pin (a small horizontal card on a phone). A cluster that cannot zoom further:
		   a scrolling list. On a phone that list is a bottom sheet outside the (clipping, 190px tall) map panel; elsewhere it sits
		   in the panel, on whichever side of the pin covers the fewest other pins, with a list height that fits the panel. */
		function popHTML(c) {
			if (c.items.length === 1) {
				var s = c.items[0];
				return '<a class="pop__card" href="' + BASE + encPath(s.p) + '"><img src="' + BASE + encPath(s.img) + '" alt="" width="256" height="144"><span class="pop__body"><span class="pop__meta">' + esc(s.dl) + ' · ' + fmtLat(s.lat) + ' ' + fmtLon(s.lon) + '</span><span class="pop__title">' + esc(s.t) + '</span><span class="pop__go">View story</span></span></a>';
			}
			var items = c.items.slice().sort(function (a, b) { return a.d < b.d ? 1 : -1; });
			return '<div class="pop__list-h"><span>' + items.length + ' stories</span><button type="button" class="pop__x" aria-label="Close">&times;</button></div><div class="pop__list">' + items.map(function (s) {
				return '<a class="pop__row" href="' + BASE + encPath(s.p) + '"><img src="' + BASE + encPath(s.img) + '" alt="" width="56" height="38" loading="lazy"><span><span class="pop__title">' + esc(s.t) + '</span><span class="pop__meta">' + esc(s.dl) + '</span></span></a>';
			}).join('') + '</div>';
		}
		function setSheet(on) {
			if (on) { if (popEl.parentNode !== D.body) D.body.appendChild(popEl); }
			else if (popEl.parentNode !== viewEl) viewEl.appendChild(popEl);
			popEl.classList.toggle('is-sheet', on);
		}
		function positionPop() {
			if (!popOwner || popEl.classList.contains('is-sheet')) return;
			var list = $('.pop__list', popEl);
			if (list) { var hh = ($('.pop__list-h', popEl) || { offsetHeight: 34 }).offsetHeight; list.style.maxHeight = Math.max(88, Math.min(252, ch - hh - 24)) + 'px'; }
			var pw = popEl.offsetWidth, ph = popEl.offsetHeight, ox = popOwner.x, oy = popOwner.y, M = 10;
			var spots = [
				[ox - pw / 2, oy - ph - 22],            // above
				[ox - pw / 2, oy + 26],                  // below
				[ox + 24, oy - ph / 2],                  // right
				[ox - pw - 24, oy - ph / 2]              // left
			];
			var best = null, bestScore = Infinity;
			spots.forEach(function (p, i) {
				var x = clamp(p[0], M, Math.max(M, cw - pw - M)), y = clamp(p[1], M, Math.max(M, ch - ph - M));
				var score = i * 0.6 + (Math.abs(x - p[0]) + Math.abs(y - p[1])) * 0.2;                    // prefer above, then below; moving the box off its spot costs a little
				clusters.forEach(function (o) { if (o !== popOwner && o.node.style.display !== 'none' && o.x > x - 14 && o.x < x + pw + 14 && o.y > y - 14 && o.y < y + ph + 14) score += 10; });   // every pin it would hide costs a lot
				if (Math.abs(ox - clamp(ox, x, x + pw)) < 16 && Math.abs(oy - clamp(oy, y, y + ph)) < 16) score += 25;   // never on top of its own pin
				if (score < bestScore) { bestScore = score; best = [x, y]; }
			});
			popEl.style.left = best[0].toFixed(0) + 'px'; popEl.style.top = best[1].toFixed(0) + 'px';
		}
		function openPop(c, interactive) {
			clearTimeout(popTimer);
			setSheet(compact && c.items.length > 1);
			if (popOwner !== c || popInteractive !== !!interactive || !popEl.firstChild) popEl.innerHTML = popHTML(c);
			popOwner = c; popInteractive = !!interactive;
			popEl.classList.add('is-open');
			popEl.classList.toggle('is-live', !!interactive || c.items.length > 1);
			positionPop();
		}
		function hidePop(now) {
			clearTimeout(popTimer);
			var fn = function () { popEl.classList.remove('is-open', 'is-live'); popOwner = null; popInteractive = false; };
			if (now) fn(); else popTimer = setTimeout(fn, 160);
		}
		function bindPin(node, c) {
			node.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || 'mouse'; });
			node.addEventListener('pointerenter', function (e) { if (e.pointerType === 'touch') return; if (c.items.length === 1) openPop(c, false); });
			node.addEventListener('pointerleave', function () { if (c.items.length === 1) hidePop(); });
			node.addEventListener('focus', function () { if (c.items.length === 1 && !popInteractive) openPop(c, false); });
			node.addEventListener('blur', function () { if (c.items.length === 1) hidePop(); });
			node.addEventListener('click', function (e) {
				if (c.items.length > 1) { e.preventDefault(); clusterClick(c, e.detail === 0); return; }
				// touch: the first tap previews the story, the card's own link opens it
				if (lastPointer === 'touch' || lastPointer === 'pen') { if (popOwner !== c || !popInteractive) { e.preventDefault(); openPop(c, true); } }
			});
		}
		/* a cluster zooms into its stories; when it cannot zoom any further it opens the list */
		function clusterClick(c, viaKeyboard) {
			var nv = fit(boundsOf(c.items), 0.6, 30);
			if (nv.span < v.span * 0.8) { hidePop(true); markRegion(null); mode = 'free'; animateTo(nv); }
			else { openPop(c, true); if (viaKeyboard) setTimeout(function () { var first = $('.pop__row', popEl); if (first) first.focus(); }, 60); }
		}
		popEl.addEventListener('pointerenter', function () { clearTimeout(popTimer); });
		popEl.addEventListener('pointerleave', function () { if (!popInteractive) hidePop(); });
		popEl.addEventListener('click', function (e) {
			if (!(e.target.closest && e.target.closest('.pop__x'))) return;
			var o = popOwner; hidePop(true); if (o && o.node) { try { o.node.focus({ preventScroll: true }); } catch (x) { /* ignore */ } }
		});
		D.addEventListener('pointerdown', function (e) { if (popEl.classList.contains('is-open') && !popEl.contains(e.target) && !(e.target.closest && e.target.closest('.pin'))) hidePop(true); });
		D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && popEl.classList.contains('is-open') && (root.contains(D.activeElement) || popEl.contains(D.activeElement) || popEl.classList.contains('is-sheet'))) { var o = popOwner; hidePop(true); if (o && o.node) o.node.focus(); } });

		function same(a, b) { return Math.abs(a.lon - b.lon) < 0.01 && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.span - b.span) < 0.01 && Math.abs(viewH(a) - viewH(b)) < 0.5; }

		/* ---- animated zoom */
		function animateTo(nv, dur) {
			if (tween) { W.cancelAnimationFrame(tween.id); tween = null; }
			if (REDUCE || dur === 0) { v = nv; renderMap(); rebuildPins(); return; }
			var from = { lon: v.lon, lat: v.lat, span: v.span, h: viewH(v) }, t0 = null; dur = dur || 900;
			var toH = viewH(nv);
			hidePop(true);
			function step(ts) {
				if (t0 === null) t0 = ts;
				var k = clamp((ts - t0) / dur, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
				v = { lon: from.lon + (nv.lon - from.lon) * e, lat: from.lat + (nv.lat - from.lat) * e, span: Math.exp(Math.log(from.span) + (Math.log(nv.span) - Math.log(from.span)) * e), h: from.h + (toH - from.h) * e };
				if (!compact) delete v.h;
				renderMap();
				if (k < 1) tween.id = raf(step); else { tween = null; v = nv; renderMap(); rebuildPins(); }
			}
			tween = { id: raf(step) };
		}

		/* ---- region chips (only regions that contain a story) */
		function markRegion(id) {
			regionId = id;
			$$('.chip', regionsEl).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-r') === id ? 'true' : 'false'); });
		}
		function buildRegions() {
			var avail = REGIONS.filter(function (r) { return r.id === 'world' || list.some(function (s) { return inBounds(s, r.b); }); });
			regionsEl.innerHTML = avail.map(function (r) { return '<button type="button" class="chip" data-r="' + r.id + '" aria-pressed="' + (r.id === regionId) + '">' + r.label + '</button>'; }).join('');
			regionsEl.hidden = avail.length < 2;
		}
		regionsEl.addEventListener('click', function (e) {
			var b = e.target.closest && e.target.closest('[data-r]'); if (!b) return;
			var id = b.getAttribute('data-r'), r = REGIONS.filter(function (x) { return x.id === id; })[0];
			markRegion(id); mode = 'region';
			animateTo(id === 'world' ? worldView() : fit(r.b, 0.06, MIN_SPAN));
		});

		/* ---- public */
		var api = {
			root: root,
			setStories: function (l) {
				list = l.slice();
				layer.footprint(list);
				var r = regionById(regionId);
				if (mode === 'region' && r && r.id !== 'world' && !list.some(function (s) { return inBounds(s, r.b); })) mode = 'auto'; // the chosen region lost all its stories to the filter
				if (mode === 'auto') {
					var nv = homeView();
					regionId = homeId(nv);
					buildRegions();
					if (!list.length || same(nv, v)) { renderMap(); rebuildPins(); } else animateTo(nv, 700);
				} else { buildRegions(); renderMap(); rebuildPins(); }
			},
			highlight: function (slug) { hotSlug = slug || null; applyState(); },
			view: function () { return v; }
		};

		measure();
		v = homeView();
		regionId = homeId(v);
		layer.footprint(list);
		buildRegions();
		renderMap();
		rebuildPins();
		if ('ResizeObserver' in W) {
			var lastW = cw;
			new ResizeObserver(function () {
				var r = viewEl.getBoundingClientRect();
				if (Math.abs(r.width - lastW) < 1) return;
				lastW = r.width;
				var was = compact; measure();
				if (was !== compact) { viewEl.style.height = ''; viewEl.style.aspectRatio = ''; measure(); }
				if (tween) return;
				var rr = REGIONS.filter(function (x) { return x.id === regionId; })[0];
				v = regionId === 'world' ? worldView() : regionId === 'fit' ? homeView() : rr ? fit(rr.b, 0.06, MIN_SPAN) : homeView();
				renderMap(); rebuildPins();
			}).observe(viewEl);
		}
		return api;
	}

	/* ================================================================ Dock: the small map beside the timeline */
	function Dock(el) {
		var svg = $('.dock__dots', el), pinsEl = $('.dock__pins', el), layer = DotLayer(svg);
		var list = STORIES.slice(), year = '', hotSlug = null, nodes = {}, cw = 1, ch = 1, vb = null;

		function measure() { var r = el.getBoundingClientRect(); cw = Math.max(1, r.width); ch = Math.max(1, r.height); }
		function view() {
			var b = boundsOf(list.length ? list : STORIES), pad = 0.22;
			var w = Math.max((b[2] - b[0]) * (1 + pad * 2), 40), h = Math.max((b[3] - b[1]) * (1 + pad * 2), 1);
			var span = clamp(Math.max(w, h * cw / ch), 40, 360);
			var lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2;
			if (span > 300) { span = 360; lon = 0; lat = 12; }
			var ppd = cw / span, spanLat = ch / ppd;
			return { x0: lon - span / 2, yTop: lat + spanLat / 2, span: span, spanLat: spanLat, ppd: ppd };
		}
		function render() {
			if (!el.offsetWidth) return;
			measure();
			vb = view();
			layer.view(+vb.x0.toFixed(3), +vb.yTop.toFixed(3), +vb.span.toFixed(3), +vb.spanLat.toFixed(3), vb.ppd);
			pinsEl.innerHTML = ''; nodes = {};
			list.forEach(function (s) {
				var n = D.createElement('i'); n.className = 'pin';
				n.innerHTML = '<span class="pin__hit"><i class="pin__core"></i></span>';
				n.style.transform = 'translate3d(' + ((s.lon - vb.x0) * vb.ppd).toFixed(1) + 'px,' + ((vb.yTop - s.lat) * vb.ppd).toFixed(1) + 'px,0)';
				nodes[s.s] = n; pinsEl.appendChild(n);
			});
			state();
		}
		function state() {
			list.forEach(function (s) {
				var n = nodes[s.s]; if (!n) return;
				n.classList.toggle('is-dim', !!year && s.y !== year);
				n.classList.toggle('is-hot', hotSlug === s.s);
			});
		}
		function footprint() { layer.footprint(year ? list.filter(function (s) { return s.y === year; }) : list); }
		footprint(); render();
		if ('ResizeObserver' in W) new ResizeObserver(function () { var r = el.getBoundingClientRect(); if (Math.abs(r.width - cw) > 1 || Math.abs(r.height - ch) > 1) render(); }).observe(el);
		return {
			setStories: function (l) { list = l.slice(); footprint(); render(); },
			setYear: function (y) { if (y === year) return; year = y || ''; footprint(); state(); },
			setHot: function (slug) { hotSlug = slug || null; state(); }
		};
	}

	/* ---------------------------------------------------------------- boot */
	var bySlug = {}; STORIES.forEach(function (s) { bySlug[s.s] = s; });
	var atlas = null, dock = null;
	safe('atlas', function () { var el = $('[data-atlas]'); if (el) atlas = Atlas(el); });
	safe('dock', function () { var el = $('[data-dock]'); if (el) dock = Dock(el); });
	function onFilter(detail) {
		var set = {}; detail.slugs.forEach(function (s) { set[s] = 1; });
		var vis = STORIES.filter(function (s) { return set[s.s]; });
		if (atlas) safe('atlas.filter', function () { atlas.setStories(vis); });
		if (dock) safe('dock.filter', function () { dock.setStories(vis); });
	}
	D.addEventListener('ff:filter', function (e) { onFilter(e.detail); });
	D.addEventListener('ff:year', function (e) { if (dock) dock.setYear(e.detail.year); });
	D.addEventListener('ff:hot', function (e) { if (dock) dock.setHot(e.detail.slug); if (atlas) atlas.highlight(e.detail.slug); });
	W.FF = W.FF || {};
	W.FF.atlas = atlas;
	// the story index runs first and may already be filtered (a #tag=... link): catch up
	if (W.FF.filter) onFilter(W.FF.filter);
	if (W.FF.year && dock) dock.setYear(W.FF.year);
})();
