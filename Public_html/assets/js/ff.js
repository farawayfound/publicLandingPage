/* ==========================================================================
   FarawayFound - page behaviour. Vanilla JS, no dependencies, works from file://.
   Everything here is progressive enhancement: the pages are complete HTML and CSS without it.
   Every module runs inside safe(), so one failing feature never takes the others down.

   header - reveal - hero (slideshow) - counters - strip - clip - progress - locator fade - gallery (justified rows)
   explorer (timeline, filters) - lightbox
   The dot-matrix map lives in ff-map.js; the terminal animation in terminal.js.
   ========================================================================== */
(function () {
	'use strict';

	var D = document, W = window, R = D.documentElement;
	if (/(^|\s)no-js(\s|$)/.test(R.className)) R.className = R.className.replace(/(^|\s)no-js(\s|$)/, ' js '); // the page's failsafe timer gave up before this script arrived: take over again
	var motionQuery = W.matchMedia ? W.matchMedia('(prefers-reduced-motion: reduce)') : null;
	var REDUCE = !!(motionQuery && motionQuery.matches);
	var SAVE = !!(W.navigator && W.navigator.connection && W.navigator.connection.saveData);

	function $(s, c) { return (c || D).querySelector(s); }
	function $$(s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); }
	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function pad2(n) { return (n < 10 ? '0' : '') + n; }
	function raf(fn) { return W.requestAnimationFrame ? W.requestAnimationFrame(fn) : setTimeout(fn, 16); }
	function safe(name, fn) { try { fn(); } catch (e) { if (W.console) console.error('[ff:' + name + ']', e); } }
	function fire(name, detail) { try { D.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* old browser */ } }
	function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

	W.FF = W.FF || {};
	W.FF.safe = safe;
	W.FF.ready = true; // the inline failsafe in the page (templates/layout.js) leaves the .js class alone once this script has run
	function fmtNum(v) { try { return v.toLocaleString('en-US'); } catch (e) { return String(v); } } // 1400 -> "1,400", the same grouping as the generated HTML

	/* ---------------------------------------------------------------- header: solid on scroll, menu, section links */
	safe('header', function () {
		var bar = $('[data-header]');
		if (!bar) return;
		var ticking = false;
		function update() { bar.classList.toggle('is-scrolled', W.pageYOffset > 24); ticking = false; }
		W.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(update); } }, { passive: true });
		update();

		var tg = $('.bar__toggle', bar);
		function setOpen(open) { bar.classList.toggle('is-open', open); if (tg) tg.setAttribute('aria-expanded', open ? 'true' : 'false'); }
		if (tg) {
			tg.addEventListener('click', function () { setOpen(!bar.classList.contains('is-open')); });
			$$('.bar__nav a', bar).forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
			D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bar.classList.contains('is-open')) { setOpen(false); tg.focus(); } });
			W.addEventListener('resize', function () { if (W.innerWidth > 760) setOpen(false); });
			// a tap outside the open menu, or scrolling the page, closes it too
			D.addEventListener('pointerdown', function (e) { if (bar.classList.contains('is-open') && !bar.contains(e.target)) setOpen(false); });
			var menuY = 0;
			W.addEventListener('scroll', function () {
				if (!bar.classList.contains('is-open')) { menuY = W.pageYOffset; return; }
				if (Math.abs(W.pageYOffset - menuY) > 24) setOpen(false);
			}, { passive: true });
		}

		// highlight the nav link of the section in view (blog index)
		var links = $$('.bar__nav a[data-sec]', bar);
		if (links.length) {
			var secs = links.map(function (a) { return { a: a, el: D.getElementById(a.getAttribute('data-sec')) }; }).filter(function (s) { return s.el; });
			var spinning = false;
			var spy = function () {
				spinning = false;
				var cur = null;
				secs.forEach(function (s) { if (s.el.getBoundingClientRect().top <= W.innerHeight * 0.4) cur = s; });
				links.forEach(function (a) { a.classList.toggle('is-active', !!cur && cur.a === a && cur.el.id !== 'home'); });
			};
			W.addEventListener('scroll', function () { if (!spinning) { spinning = true; raf(spy); } }, { passive: true });
			spy();
		}
	});

	/* ---------------------------------------------------------------- scroll reveals */
	safe('reveal', function () {
		var els = $$('.reveal');
		if (!els.length) return;
		function show(n) {
			n.classList.add('in');
			// once settled drop the helper classes so hover transforms are never delayed by the reveal transition
			if (!n.classList.contains('full')) setTimeout(function () { n.classList.remove('reveal', 'in'); n.style.removeProperty('--d'); }, 1700);
		}
		if (REDUCE || !('IntersectionObserver' in W)) { els.forEach(function (n) { if (n.classList.contains('full')) n.classList.add('in'); else n.classList.remove('reveal'); }); return; }
		var io = new IntersectionObserver(function (entries) {
			entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); show(en.target); } });
		}, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
		els.forEach(function (n) { io.observe(n); });
		// failsafe: never leave something above or near the fold invisible
		setTimeout(function () { $$('.reveal:not(.in)').forEach(function (n) { var r = n.getBoundingClientRect(); if (r.top < W.innerHeight * 1.2) { io.unobserve(n); show(n); } }); }, 2800);
	});

	/* ---------------------------------------------------------------- hero slideshow (landing + blog index) */
	safe('hero', function () {
		var hero = $('[data-hero]');
		var items = W.FF_HERO;
		if (!hero || !items || !items.length) return;
		var stage = $('.hero__stage', hero), front = $('.slide', stage);
		var ticker = $('[data-ticker]', hero);
		if (!stage || !front) return;
		var pauseBtn = ticker && $('.ticker__pause', ticker);
		var idxEl = ticker && $('.tick__idx', ticker), linkEl = ticker && $('.tick__link', ticker);
		var tEl = linkEl && $('.tick__t', linkEl), cEl = linkEl && $('.tick__c', linkEl);

		var order = items.slice();
		if (hero.classList.contains('hero--home') && order.length > 2) {
			// keep the lead photo, shuffle the rest (same idea as the owner's original slideshow)
			var rest = order.slice(1);
			for (var i = rest.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
			order = [order[0]].concat(rest);
		}
		var N = order.length;
		function label(n) { return pad2(n + 1) + ' / ' + pad2(N); }
		function caption(n) {
			var it = order[n];
			if (idxEl) idxEl.textContent = label(n);
			if (linkEl) {
				if (it.href) { linkEl.hidden = false; linkEl.setAttribute('href', it.href); if (tEl) tEl.textContent = it.title || ''; if (cEl) cEl.textContent = it.coord || ''; }
				else linkEl.hidden = true;
			}
		}
		caption(0);

		// reduced motion (or a single photo): one calm frame, no controls
		if (REDUCE || N < 2) { hero.classList.add('is-static'); return; }

		var interval = hero.classList.contains('hero--home') ? 7000 : 7500;
		var ticksEl = ticker && $('[data-ticks]', ticker), ticks = [];
		if (ticker) ticker.style.setProperty('--iv', interval + 'ms');
		if (ticksEl) {
			var many = N > 12;
			if (many) ticksEl.classList.add('ticks--single');
			for (var k = 0; k < (many ? 1 : N); k++) { var el = D.createElement('i'); ticksEl.appendChild(el); ticks.push(el); }
		}
		function setTick(n) {
			ticks.forEach(function (el, k) {
				var cls = ticks.length === 1 ? 'is-active' : (k < n ? 'is-done' : k === n ? 'is-active' : '');
				el.className = ''; void el.offsetWidth; el.className = cls;
			});
		}
		setTick(0);

		var back = D.createElement('img');
		back.className = 'slide'; back.alt = ''; back.setAttribute('aria-hidden', 'true'); back.decoding = 'async'; back.sizes = '100vw';
		back.setAttribute('width', front.getAttribute('width') || '1920'); back.setAttribute('height', front.getAttribute('height') || '1080');
		stage.appendChild(back);
		var cur = 0, busy = false, timer = null, paused = false, visible = true;
		front.style.transformOrigin = '50% 50%';

		function load(it, cb) {
			var im = new Image();
			im.decoding = 'async'; im.sizes = '100vw';
			im.onload = function () { if (im.decode) im.decode().then(function () { cb(im); }, function () { cb(im); }); else cb(im); };
			im.onerror = function () { cb(null); };
			if (it.set) im.srcset = it.set;
			im.src = it.src;
		}
		function running() { return !paused && visible && !D.hidden; }
		function schedule() { clearTimeout(timer); if (running()) timer = setTimeout(function () { go((cur + 1) % N); }, interval); }
		function go(n) {
			if (busy) return;
			busy = true;
			var it = order[n];
			load(it, function (im) {
				if (!im) { busy = false; cur = n; schedule(); return; }
				if (it.set) back.srcset = it.set; else back.removeAttribute('srcset');
				back.src = it.src;
				if (it.w && it.h) { back.setAttribute('width', it.w); back.setAttribute('height', it.h); }
				back.style.objectPosition = it.pos || '50% 50%';
				hero.style.setProperty('--shade', String(it.shade || 0)); hero.style.setProperty('--shade-m', String(it.shadeM || 0)); // the flat darkening this photo needs behind the words (it fades with the crossfade)
				back.style.transformOrigin = (25 + Math.random() * 50).toFixed(0) + '% ' + (25 + Math.random() * 50).toFixed(0) + '%';
				back.classList.remove('is-leaving'); void back.offsetWidth;
				back.classList.add('is-active');
				front.classList.remove('is-active'); front.classList.add('is-leaving');
				var old = front;
				setTimeout(function () { old.classList.remove('is-leaving'); }, 2000);
				front = back; back = old; cur = n; busy = false;
				caption(n); setTick(n);
				schedule();
			});
		}
		if (pauseBtn) {
			pauseBtn.addEventListener('click', function () {
				paused = !paused;
				pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
				pauseBtn.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
				if (ticker) ticker.classList.toggle('is-paused', paused);
				if (paused) clearTimeout(timer); else { setTick(cur); schedule(); }
			});
		}
		D.addEventListener('visibilitychange', function () { if (D.hidden) clearTimeout(timer); else if (running()) { setTick(cur); schedule(); } });
		W.addEventListener('pageshow', function (e) { if (e.persisted && running()) { setTick(cur); schedule(); } });
		if ('IntersectionObserver' in W) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (!visible) clearTimeout(timer); else if (running()) { setTick(cur); schedule(); } }, { threshold: 0.05 }).observe(hero);
		schedule();
	});

	/* ---------------------------------------------------------------- count-up numbers (the HTML already holds the final value) */
	safe('counters', function () {
		var nums = $$('[data-count]');
		if (!nums.length || REDUCE || !('IntersectionObserver' in W)) return;
		function run(n) {
			var to = parseInt(n.getAttribute('data-count'), 10);
			if (!(to > 0) || D.hidden) return;
			var t0 = null, dur = 1300;
			n.textContent = '0';
			(function tick(now) {
				if (D.hidden) { n.textContent = fmtNum(to); return; }
				if (t0 === null) t0 = now;
				var k = clamp((now - t0) / dur, 0, 1);
				n.textContent = fmtNum(Math.round(to * (1 - Math.pow(1 - k, 3))));
				if (k < 1) raf(tick); else n.textContent = fmtNum(to);
			})(performance.now());
		}
		var io = new IntersectionObserver(function (entries) {
			entries.forEach(function (en) {
				if (!en.isIntersecting) return;
				io.unobserve(en.target);
				// numbers in the hero fade in after the title has drawn itself; start them then
				var delay = en.target.closest('.hero__foot') ? 2300 : 0;
				setTimeout(function () { run(en.target); }, delay);
			});
		}, { threshold: 0.5 });
		nums.forEach(function (n) { io.observe(n); });
	});

	/* ---------------------------------------------------------------- landing: latest-stories strip */
	safe('strip', function () {
		var strip = $('.strip'), btns = $$('[data-strip]');
		if (!strip) return;
		function step() { var it = $('.poster', strip); return it ? it.getBoundingClientRect().width + 19 : 300; }
		function sync() {
			var max = strip.scrollWidth - strip.clientWidth - 2;
			btns.forEach(function (b) { b.disabled = b.getAttribute('data-strip') === '-1' ? strip.scrollLeft <= 2 : strip.scrollLeft >= max; });
		}
		btns.forEach(function (b) { b.addEventListener('click', function () { strip.scrollBy({ left: step() * (+b.getAttribute('data-strip')), behavior: REDUCE ? 'auto' : 'smooth' }); }); });
		strip.addEventListener('scroll', function () { raf(sync); }, { passive: true });
		W.addEventListener('resize', sync);
		sync();

		// mouse drag (touch scrolls natively)
		var down = false, sx = 0, sl = 0, moved = 0;
		strip.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse' || e.button !== 0) return; down = true; sx = e.clientX; sl = strip.scrollLeft; moved = 0; });
		W.addEventListener('pointermove', function (e) {
			if (!down) return;
			var dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx));
			if (moved > 5) { strip.classList.add('is-dragging'); strip.scrollLeft = sl - dx; }
		});
		W.addEventListener('pointerup', function () { if (!down) return; down = false; strip.classList.remove('is-dragging'); });
		strip.addEventListener('click', function (e) { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
		strip.addEventListener('dragstart', function (e) { e.preventDefault(); });
	});

	/* ---------------------------------------------------------------- landing: the snowboard clip plays only while visible */
	safe('clip', function () {
		$$('video[data-lazyvideo]').forEach(function (v) {
			// reduced motion, Save-Data or no IntersectionObserver: the poster stays, the file is never requested
			if (REDUCE || SAVE || !('IntersectionObserver' in W)) return;
			new IntersectionObserver(function (es) {
				es.forEach(function (e) {
					if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () { /* autoplay refused */ }); } else v.pause();
				});
			}, { threshold: 0.25 }).observe(v);
		});
	});

	/* ---------------------------------------------------------------- story page: reading progress hairline */
	safe('progress', function () {
		var bar = $('[data-progress]');
		if (!bar) return;
		var ticking = false;
		function update() { ticking = false; var max = R.scrollHeight - W.innerHeight; bar.style.transform = 'scaleX(' + (max > 0 ? clamp(W.pageYOffset / max, 0, 1) : 0).toFixed(4) + ')'; }
		W.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(update); } }, { passive: true });
		W.addEventListener('resize', update);
		update();
	});

	/* ---------------------------------------------------------------- story page: the sticky locator steps aside for full-bleed photos */
	safe('locator', function () {
		var aside = $('.locator'), figs = $$('.story__body .full');
		if (!aside || !figs.length) return;
		var ticking = false;
		function check() {
			ticking = false;
			if (W.getComputedStyle(aside).position !== 'sticky') { aside.classList.remove('is-faded'); return; }
			var a = aside.getBoundingClientRect();
			var hit = figs.some(function (f) { var r = f.getBoundingClientRect(); return r.top < a.bottom + 24 && r.bottom > a.top - 24; });
			aside.classList.toggle('is-faded', hit);
		}
		W.addEventListener('scroll', function () { if (!ticking) { ticking = true; raf(check); } }, { passive: true });
		W.addEventListener('resize', debounce(check, 100));
		check();
	});

	/* ---------------------------------------------------------------- story page: justified gallery
	   Plain CSS flex rows (the fallback without JavaScript) leave a lone photo on the last row and let row heights wander.
	   Here every photo's aspect ratio is known, so the rows are planned together: dynamic programming picks the line breaks
	   that keep every row (the last one too) close to one target height, then each row is scaled to fill the width exactly.
	   Nothing is distorted: a photo is only cropped when its ratio is extreme (a 1:3 sliver or a 4:1 strip). */
	safe('gallery', function () {
		var lists = $$('[data-gallery]');
		if (!lists.length) return;
		var MIN_R = 0.5, MAX_R = 3, MAX_PER_ROW = 8;

		function plan(ratios, width, gap, target, minW) {
			var n = ratios.length, best = [0], from = [0], i, j, k;
			var up = width >= 600 ? 10 : 5;                                    // phones: a tall row (two portraits side by side) is fine, a sliver is not
			function rowH(a, b) { var sum = 0; for (k = a; k < b; k++) sum += ratios[k]; return (width - gap * (b - a - 1)) / sum; }
			function cost(a, b) {
				var h = rowH(a, b), c = Math.pow(Math.log(h / target), 2) * (h < target ? 10 : up);
				if (h > target * 2.4) c += 15 * (h / target - 2.4);            // one photo stretched across the whole row (a lone landscape) is the last resort
				for (k = a; k < b; k++) { var w = ratios[k] * h; if (w < minW) c += Math.pow((minW - w) / minW, 2) * 30; }   // no slivers
				return c;
			}
			for (j = 1; j <= n; j++) {
				best[j] = Infinity;
				for (i = Math.max(0, j - MAX_PER_ROW); i < j; i++) {
					var c = best[i] + cost(i, j);
					if (c < best[j]) { best[j] = c; from[j] = i; }
				}
			}
			var rows = [];
			for (j = n; j > 0; j = from[j]) rows.unshift([from[j], j]);
			return rows;
		}

		function layout(ul) {
			var items = $$('.jg__item', ul), width = Math.floor(ul.getBoundingClientRect().width * 100) / 100 - 0.02;
			if (!items.length || width < 60) return;
			var gap = parseFloat(getComputedStyle(ul).columnGap) || 8;
			var rem = (parseFloat(getComputedStyle(R).fontSize) || 16) / 16;
			var target = width >= 900 ? 270 * rem : width >= 600 ? 240 : Math.max(96, Math.min(200, (width - gap) / 2.3));
			var minW = width >= 600 ? 120 : Math.max(96, width * 0.3);   // no photo narrower than this unless the alternative is far worse
			var ratios = items.map(function (el) { var r = parseFloat(el.style.getPropertyValue('--r')); return clamp(r > 0 ? r : 1.5, MIN_R, MAX_R); });
			var rows = plan(ratios, width, gap, target, minW);
			rows.forEach(function (row) {
				var a = row[0], b = row[1], sum = 0, k;
				for (k = a; k < b; k++) sum += ratios[k];
				var h = (width - gap * (b - a - 1)) / sum, cap = target * 2.4;
				if (h > cap) h = cap;                                           // only when forced (one or two photos in the whole gallery)
				for (k = a; k < b; k++) {
					items[k].style.width = (Math.floor(ratios[k] * h * 100) / 100) + 'px';
					items[k].style.height = (Math.round(h * 100) / 100) + 'px';
				}
			});
			ul.classList.add('is-laid');
			ul.setAttribute('data-rows', rows.length);
		}

		lists.forEach(function (ul) {
			var last = 0, queued = false;
			function go() { queued = false; var w = ul.getBoundingClientRect().width; if (Math.abs(w - last) < 0.5 && ul.classList.contains('is-laid')) return; last = w; layout(ul); }
			function queue() { if (!queued) { queued = true; raf(go); } }
			go();
			if ('ResizeObserver' in W) new ResizeObserver(queue).observe(ul); else W.addEventListener('resize', debounce(queue, 120));
			if (D.fonts && D.fonts.ready) D.fonts.ready.then(queue);          // the root size does not change with fonts, but be safe
		});
	});

	/* ---------------------------------------------------------------- story index: timeline rail, filters, layout planner */
	safe('explorer', function () {
		var root = $('[data-explorer]');
		if (!root) return;
		var Plan = W.FFPlan;
		var groups = $$('.ygroup', root);
		var tiles = $$('.tile', root).map(function (el) {
			return { el: el, slug: el.getAttribute('data-slug'), year: el.getAttribute('data-year'), tags: (el.getAttribute('data-tags') || '').split(' ').filter(Boolean), img: $('img', el), group: el.closest('.ygroup') };
		});
		var rail = $('[data-rail]', root), railList = rail && $('.rail__list', rail);
		var railRows = $$('.rail__row', root), tagChips = $$('.filters .chip[data-tag]', root);
		var filters = $('[data-filters]', root), toggle = filters && $('.filters__toggle', filters), toggleN = filters && $('[data-filter-n]', filters);
		var summary = $('#summary'), shownEl = summary && $('[data-shown]', summary), clearBtn = summary && $('.summary__clear', summary), emptyEl = $('#empty');
		var years = railRows.map(function (b) { return b.getAttribute('data-year'); }).filter(Boolean);
		var tagSet = {}; tagChips.forEach(function (b) { tagSet[b.getAttribute('data-tag')] = 1; });
		var state = { year: '', tag: '' }, currentYear = '';

		function match(t, tag, year) { return (!tag || t.tags.indexOf(tag) > -1) && (!year || t.year === year); }

		/* tile size classes + the right image for the span (cover for big tiles, card thumbnail otherwise) */
		function setPlan(t, plan) {
			var el = t.el;
			['c2', 'c3', 'c4', 'c6', 'is-feature', 'm1', 'm2'].forEach(function (c) { el.classList.remove(c); });
			plan.cls.split(' ').forEach(function (c) { el.classList.add(c); });
			if (!t.img || !Plan) return;
			var large = Plan.isLarge(plan);
			if (String(large ? 1 : 0) !== el.getAttribute('data-large')) {
				var cur = t.img.getAttribute('srcset'), alt = t.img.getAttribute('data-alt-set');
				if (alt) { t.img.setAttribute('srcset', alt); t.img.setAttribute('data-alt-set', cur); }
				el.setAttribute('data-large', large ? '1' : '0');
				var pos = t.img.getAttribute('data-pos');
				t.img.style.objectPosition = large && pos ? pos : '';
			}
			t.img.setAttribute('sizes', Plan.sizes(plan));
		}

		function apply(opts) {
			opts = opts || {};
			var vis = [], byGroup = {};
			tiles.forEach(function (t) {
				var ok = match(t, state.tag, state.year);
				if (t.el.hidden === ok) t.el.hidden = !ok;
				if (ok) { vis.push(t); (byGroup[t.year] = byGroup[t.year] || []).push(t); }
			});
			groups.forEach(function (g) {
				var list = byGroup[g.getAttribute('data-year')] || [];
				g.hidden = list.length === 0;
				var c = $('[data-total]', g); if (c) c.textContent = list.length;
				var noun = $('[data-noun]', g); if (noun) noun.textContent = list.length === 1 ? 'story' : 'stories';
				if (Plan) { var plan = Plan.planGroup(list.length); list.forEach(function (t, i) { setPlan(t, plan[i]); }); }
			});
			// faceted counts: each chip counts against the OTHER active filter
			tagChips.forEach(function (b) {
				var tg = b.getAttribute('data-tag'), n = tiles.filter(function (t) { return match(t, tg, state.year); }).length;
				var nn = $('.n', b); if (nn) nn.textContent = n;
				b.setAttribute('aria-pressed', state.tag === tg ? 'true' : 'false');
				b.classList.toggle('is-zero', n === 0 && state.tag !== tg);
			});
			railRows.forEach(function (b) {
				var y = b.getAttribute('data-year'), n = tiles.filter(function (t) { return match(t, state.tag, y); }).length;
				var nn = $('[data-n]', b); if (nn) nn.textContent = n;
				b.setAttribute('aria-pressed', state.year === y ? 'true' : 'false');
				b.classList.toggle('is-zero', n === 0 && state.year !== y);
			});
			if (shownEl) shownEl.textContent = vis.length;
			if (clearBtn) clearBtn.hidden = !(state.tag || state.year);
			if (emptyEl) emptyEl.hidden = vis.length > 0;
			if (toggleN) { var f = (state.tag ? 1 : 0); toggleN.hidden = !f; toggleN.textContent = f; }
			writeHash();
			var detail = { slugs: vis.map(function (t) { return t.slug; }), year: state.year, tag: state.tag };
			W.FF.filter = detail; // ff-map.js may load after this ran: it reads the latest state when it starts
			fire('ff:filter', detail);
			spy(true);
			if (opts.scroll) scrollToList();
		}

		function listTop() { var el = $('#list'); return el ? el.getBoundingClientRect().top + W.pageYOffset : 0; }
		function scrollToList(instant) {
			var offs = rail && W.getComputedStyle(rail).position === 'sticky' && W.innerWidth < 1100 ? 70 : 0;
			W.scrollTo({ top: Math.max(0, listTop() - offs - 12), behavior: instant || REDUCE ? 'instant' : 'smooth' });
		}

		/* ---- URL state: #year=2016&tag=snow (restored on load, written with replaceState so Back is untouched) */
		function writeHash() {
			var h = [];
			if (state.year) h.push('year=' + encodeURIComponent(state.year));
			if (state.tag) h.push('tag=' + encodeURIComponent(state.tag));
			if (!h.length && location.hash.indexOf('=') < 0) return;
			try { history.replaceState(history.state, '', location.pathname + location.search + (h.length ? '#' + h.join('&') : '')); } catch (e) { /* file:// quirks */ }
		}
		function readHash() {
			var h = location.hash.replace(/^#/, '');
			if (h.indexOf('=') < 0) return null;
			var next = { year: '', tag: '' };
			h.split('&').forEach(function (kv) {
				var p = kv.split('='), k = p[0], v = '';
				try { v = decodeURIComponent(p[1] || ''); } catch (e) { v = ''; } // a malformed escape (#tag=%E0%A4%A) means "no value"
				if (k === 'year' && years.indexOf(v) > -1) next.year = v;
				if (k === 'tag' && tagSet[v]) next.tag = v;
			});
			return next;
		}

		tagChips.forEach(function (b) { b.addEventListener('click', function () { var tg = b.getAttribute('data-tag'); state.tag = state.tag === tg ? '' : tg; apply(); }); });
		railRows.forEach(function (b) { b.addEventListener('click', function () { var y = b.getAttribute('data-year'); state.year = (!y || state.year === y) ? '' : y; apply({ scroll: !!state.year || !y }); }); });
		if (clearBtn) clearBtn.addEventListener('click', function () { state.tag = ''; state.year = ''; apply(); });
		if (toggle) toggle.addEventListener('click', function () { var open = !filters.classList.contains('is-open'); filters.classList.toggle('is-open', open); toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); });

		/* hover: the minimap pin of a tile lights up */
		tiles.forEach(function (t) {
			t.el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') fire('ff:hot', { slug: t.slug }); });
			t.el.addEventListener('pointerleave', function () { fire('ff:hot', { slug: null }); });
			t.el.addEventListener('focusin', function () { fire('ff:hot', { slug: t.slug }); });
			t.el.addEventListener('focusout', function () { fire('ff:hot', { slug: null }); });
		});

		/* ---- scroll-spy: which year group is in view */
		var spyTick = false;
		function spy(force) {
			spyTick = false;
			var line = W.innerHeight * 0.38, cy = '';
			groups.forEach(function (g) { if (!g.hidden && g.getBoundingClientRect().top <= line) cy = g.getAttribute('data-year'); });
			var lst = $('#list'); if (lst && lst.getBoundingClientRect().top > line) cy = '';
			if (state.year) cy = state.year;
			if (cy !== currentYear || force === true) {
				var changed = cy !== currentYear;
				currentYear = cy;
				railRows.forEach(function (b) { b.classList.toggle('is-current', !!cy && b.getAttribute('data-year') === cy && !state.year); });
				if (changed) { W.FF.year = cy; fire('ff:year', { year: cy }); keepActiveVisible(); }
			}
		}
		/* keep the active year in view inside the rail (a scrolling chip bar on small screens, a tall list on desktop) */
		function keepActiveVisible() {
			var cur = railRows.filter(function (b) { return b.classList.contains('is-current') || (state.year && b.getAttribute('aria-pressed') === 'true'); })[0];
			if (!cur || !rail || !railList) return;
			if (W.getComputedStyle(railList).display === 'flex') {
				railList.scrollTo({ left: cur.offsetLeft - (railList.clientWidth - cur.offsetWidth) / 2, behavior: REDUCE ? 'auto' : 'smooth' });
			} else if (rail.scrollHeight > rail.clientHeight + 4) {
				var top = cur.offsetTop - (rail.clientHeight - cur.offsetHeight) / 2;
				rail.scrollTo({ top: top, behavior: 'auto' });
			}
		}
		W.addEventListener('scroll', function () { if (!spyTick) { spyTick = true; raf(spy); } }, { passive: true });
		if (railList) {
			var edge = function () { railList.classList.toggle('at-end', railList.scrollLeft + railList.clientWidth >= railList.scrollWidth - 2); };
			railList.addEventListener('scroll', edge, { passive: true }); W.addEventListener('resize', debounce(edge, 100)); edge();
		}

		/* ---- start: hash state, then the first layout pass */
		var init = readHash();
		if (init) { state.year = init.year; state.tag = init.tag; }
		apply();
		// a link such as ../index.html#tag=snow lands on the list; Back/Forward and reloads keep the browser's own scroll position
		var navEntry = W.performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
		if (init && (init.year || init.tag) && (!navEntry || navEntry.type === 'navigate')) {
			W.addEventListener('load', function () { setTimeout(function () { scrollToList(true); }, 30); });
			if (D.readyState === 'complete') setTimeout(function () { scrollToList(true); }, 30);
		}
		// Back/Forward or a pasted link between filter hashes on the same page
		function onHash() { var h = readHash(); if (h && (h.year !== state.year || h.tag !== state.tag)) { state.year = h.year; state.tag = h.tag; apply({ scroll: true }); } }
		W.addEventListener('hashchange', onHash);
		W.addEventListener('popstate', onHash);
		spy(true);
	});

	/* ---------------------------------------------------------------- story page: photo viewer
	   History model: opening pushes ONE entry (#photo-N); moving between photos only replaces it, so the phone's Back
	   button/gesture closes the viewer and stays on the page. A page opened on #photo-N (deep link) pushes nothing.
	   popstate and hashchange both call sync(), which is idempotent, so they never double-handle. */
	safe('lightbox', function () {
		var anchors = $$('a[data-lb]');
		if (!anchors.length) return;
		var items = [];
		anchors.forEach(function (a) { var i = parseInt(a.getAttribute('data-lb'), 10); if (!items[i]) items[i] = { href: a.getAttribute('href'), set: a.getAttribute('data-set') || '', cap: a.getAttribute('data-cap') || '', alt: a.getAttribute('data-alt') || '', el: a }; });
		items = items.filter(Boolean);
		var n = items.length;
		if (!n) return;

		var lb, img, capEl, countEl, liveEl, closeBtn, prevBtn, nextBtn, stage, prog;
		var idx = 0, isOpen = false, pushed = false, closing = false, opener = null, token = 0, cache = {};

		function build() {
			if (lb) return;
			var x = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5L5 19"/></svg>';
			var l = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
			var r = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7"/></svg>';
			var title = ($('.statement__text') || $('h1') || {}).textContent || D.title;
			lb = D.createElement('div');
			lb.className = 'lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Photo viewer');
			lb.innerHTML =
				'<div class="lb__top"><span class="lb__count mono"></span><span class="lb__title mono"></span><button type="button" class="lb__btn lb__close" aria-label="Close">' + x + '</button></div>' +
				'<figure class="lb__stage"><img class="lb__img" alt="" draggable="false"><span class="lb__spin" aria-hidden="true"></span>' +
				'<button type="button" class="lb__btn lb__nav lb__nav--prev" aria-label="Previous photo">' + l + '</button>' +
				'<button type="button" class="lb__btn lb__nav lb__nav--next" aria-label="Next photo">' + r + '</button></figure>' +
				'<p class="lb__cap"></p><div class="lb__progress" aria-hidden="true"><i></i></div><p class="vh" aria-live="polite"></p>';
			D.body.appendChild(lb);
			img = $('.lb__img', lb); capEl = $('.lb__cap', lb); countEl = $('.lb__count', lb); liveEl = $('.vh', lb);
			closeBtn = $('.lb__close', lb); prevBtn = $('.lb__nav--prev', lb); nextBtn = $('.lb__nav--next', lb); stage = $('.lb__stage', lb); prog = $('.lb__progress i', lb);
			$('.lb__title', lb).textContent = String(title).trim();
			if (n < 2) { prevBtn.hidden = true; nextBtn.hidden = true; }
			closeBtn.addEventListener('click', close);
			prevBtn.addEventListener('click', function () { show(idx - 1, -1); });
			nextBtn.addEventListener('click', function () { show(idx + 1, 1); });
			lb.addEventListener('click', function (e) { if (moved) { moved = false; return; } if (e.target === lb || e.target === stage) close(); });

			// swipe: left/right = previous/next, a long drag down = close
			var sx = 0, sy = 0, dx = 0, dy = 0, drag = false, t0 = 0;
			stage.addEventListener('pointerdown', function (e) {
				if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target.closest && e.target.closest('.lb__btn'))) return;
				drag = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = Date.now(); stage.classList.add('is-drag');
				try { stage.setPointerCapture(e.pointerId); } catch (x1) { /* ignore */ }
			});
			stage.addEventListener('pointermove', function (e) {
				if (!drag) return;
				dx = e.clientX - sx; dy = e.clientY - sy;
				if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
				if (Math.abs(dx) > Math.abs(dy)) { img.style.transform = 'translateX(' + dx + 'px)'; img.style.opacity = String(1 - Math.min(0.55, Math.abs(dx) / 700)); }
				else if (dy > 0) { img.style.transform = 'translateY(' + dy * 0.6 + 'px)'; img.style.opacity = String(1 - Math.min(0.6, dy / 500)); }
			});
			function end() {
				if (!drag) return;
				drag = false; stage.classList.remove('is-drag');
				setTimeout(function () { moved = false; }, 60);
				var fast = Date.now() - t0 < 320;
				img.style.transform = ''; img.style.opacity = '';
				if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30))) show(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
				else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) close();
			}
			stage.addEventListener('pointerup', end);
			stage.addEventListener('pointercancel', end);
		}
		var moved = false;

		function wrap(i) { return (i + n) % n; }
		function hashIndex() { var m = /^#photo-(\d+)$/.exec(location.hash); var k = m ? parseInt(m[1], 10) - 1 : -1; return k >= 0 && k < n ? k : -1; }
		function writeHash(i, push) {
			var url = location.pathname + location.search + '#photo-' + (i + 1);
			try { if (push) history.pushState({ ffLb: 1 }, '', url); else history.replaceState(history.state, '', url); return true; } catch (e) { return false; }
		}
		/* the same candidate the viewer will pick (a 1600px WebP, or the original on high-density screens) */
		function fetchImg(d, im) { im.decoding = 'async'; im.sizes = '100vw'; if (d.set) im.srcset = d.set; im.src = d.href; return im; }
		function preload(i) { i = wrap(i); if (cache[i]) return; cache[i] = fetchImg(items[i], new Image()); }

		function show(i, dir) {
			idx = wrap(i);
			var d = items[idx], my = ++token;
			countEl.textContent = pad2(idx + 1) + ' / ' + pad2(n);
			capEl.textContent = d.cap;
			liveEl.textContent = 'Photo ' + (idx + 1) + ' of ' + n + (d.cap ? ': ' + d.cap : '');
			prog.style.setProperty('--p', ((idx + 1) / n * 100).toFixed(2) + '%'); prog.parentNode.style.setProperty('--p', ((idx + 1) / n * 100).toFixed(2) + '%');
			lb.classList.add('is-busy');
			if (!REDUCE) img.classList.add('is-loading');
			var loader = new Image();
			loader.onload = loader.onerror = function () {
				if (my !== token) return;
				img.sizes = '100vw'; if (d.set) img.srcset = d.set; else img.removeAttribute('srcset');
				img.src = d.href; img.alt = d.alt || d.cap;
				img.style.transform = ''; img.style.opacity = '';
				lb.classList.remove('is-busy');
				raf(function () { img.classList.remove('is-loading'); });
				if (!REDUCE && dir && img.animate) img.animate([{ opacity: 0, transform: 'translate3d(' + (dir * 42) + 'px,0,0) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
			};
			fetchImg(d, loader);
			var reach = SAVE ? 1 : 2;
			for (var k = 1; k <= reach; k++) { preload(idx + k); preload(idx - k); }
			Object.keys(cache).forEach(function (key) { var dist = Math.abs(+key - idx); if (Math.min(dist, n - dist) > reach + 1) delete cache[key]; });
			if (isOpen) writeHash(idx, false);
		}

		function inertOthers(on) {
			$$('body > *').forEach(function (el) {
				if (el === lb || el.tagName === 'SCRIPT') return;
				if (on) { try { el.inert = true; } catch (e) { /* old browser */ } el.setAttribute('data-lb-inert', ''); }
				else if (el.hasAttribute('data-lb-inert')) { try { el.inert = false; } catch (e) { /* old browser */ } el.removeAttribute('data-lb-inert'); }
			});
		}

		function open(i, from, viaHistory) {
			build();
			if (isOpen) { show(i, 0); return; }
			opener = from || D.activeElement;
			isOpen = true; closing = false;
			lb.classList.add('is-open'); R.classList.add('lb-open');
			inertOthers(true);
			pushed = viaHistory ? false : writeHash(i, true);
			show(i, 0);
			closeBtn.focus({ preventScroll: true });
		}
		function uiClose() {
			if (!isOpen) return;
			isOpen = false; closing = false; pushed = false; token++;
			lb.classList.remove('is-open', 'is-busy'); R.classList.remove('lb-open');
			inertOthers(false);
			var back = opener && D.contains(opener) ? opener : (items[idx] && items[idx].el);
			if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
		}
		/* user closes the viewer (button, Esc, backdrop, swipe down) */
		function close() {
			if (!isOpen || closing) return;
			closing = true;
			if (pushed && history.state && history.state.ffLb) { history.back(); setTimeout(function () { if (isOpen) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } uiClose(); } }, 400); }
			else { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } uiClose(); }
		}
		/* the address bar (Back, Forward, a pasted #photo-N) decides; calling this twice is harmless */
		function sync() {
			var k = hashIndex();
			if (k > -1) { if (!isOpen) open(k, null, true); else if (k !== idx) show(k, 0); }
			else if (isOpen) uiClose();
		}

		D.addEventListener('click', function (e) {
			var a = e.target.closest ? e.target.closest('a[data-lb]') : null;
			if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
			e.preventDefault();
			open(parseInt(a.getAttribute('data-lb'), 10) % n, a, false);
		});
		D.addEventListener('keydown', function (e) {
			if (!isOpen) return;
			if (e.key === 'Escape') { e.preventDefault(); close(); }
			else if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1, -1); }
			else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1, 1); }
			else if (e.key === 'Home') { e.preventDefault(); show(0, -1); }
			else if (e.key === 'End') { e.preventDefault(); show(n - 1, 1); }
			else if (e.key === 'Tab') {
				var f = [closeBtn, prevBtn, nextBtn].filter(function (b) { return !b.hidden; }), k = f.indexOf(D.activeElement);
				e.preventDefault();
				f[k < 0 ? 0 : (k + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
			}
		});
		W.addEventListener('popstate', sync);
		W.addEventListener('hashchange', sync);
		W.addEventListener('pageshow', function (e) { if (e.persisted) sync(); });
		sync(); // #photo-N deep link on load
	});
})();
