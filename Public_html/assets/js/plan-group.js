/* FarawayFound - tile layout planner for one year group on the story index.
 *
 * ONE implementation, shared by the build (scripts/build-site.js `require`s this file, so the HTML is laid
 * out correctly with JavaScript off) and by the browser (assets/js/ff.js re-runs it after every filter so the
 * rows stay complete). Do not copy this logic anywhere else.
 *
 * planGroup(n) returns n entries. Each entry says how wide the tile is on
 *   - the desktop 6-column grid:  d = "c6" | "c4 is-feature" | "c3" | "c2"
 *   - the compact 2-column grid:  m = "m2" (full width) | "m1" (half width)
 * Desktop: 1 -> one 21:9 banner; 2 -> two halves; 4 -> 2x2; otherwise a 4x2 feature tile beside two stacked
 * tiles, then rows of three (a remainder of 4 becomes 2x2, a remainder of 2 becomes a pair). Every count
 * produces complete rows - no orphan tile, no ragged last row.
 * Compact: an odd count opens with one full-width tile, everything else pairs up, so rows are complete too.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.FFPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	function desktop(n) {
		if (n < 1) return [];
		if (n === 1) return ['c6'];
		if (n === 2) return ['c3', 'c3'];
		if (n === 4) return ['c3', 'c3', 'c3', 'c3'];
		var out = ['c4 is-feature', 'c2', 'c2'];
		var rest = n - 3;
		while (rest > 0) {
			if (rest === 4) { out.push('c3', 'c3', 'c3', 'c3'); rest = 0; }
			else if (rest === 2) { out.push('c3', 'c3'); rest = 0; }
			else { out.push('c2', 'c2', 'c2'); rest -= 3; }
		}
		return out;
	}

	function compact(n) {
		var out = [];
		for (var i = 0; i < n; i++) out.push(n % 2 === 1 && i === 0 ? 'm2' : 'm1');
		return out;
	}

	function planGroup(n) {
		var d = desktop(n), m = compact(n), out = [];
		for (var i = 0; i < n; i++) out.push({ d: d[i], m: m[i], cls: d[i] + ' ' + m[i] });
		return out;
	}

	/* the big tiles (4 or 6 columns) show the story cover, every other tile its card thumbnail */
	function isLarge(plan) { return /\bc4\b|\bc6\b/.test(plan.d); }

	/* `sizes` for a tile image: compact layout (<= 900px) is two columns, otherwise the span decides the width */
	function sizes(plan) {
		var d = plan.d.split(' ')[0];
		var wide = { c6: 'min(92vw, 1240px)', c4: 'min(62vw, 800px)', c3: 'min(46vw, 600px)', c2: 'min(30vw, 380px)' }[d] || '33vw';
		return '(max-width: 900px) ' + (plan.m === 'm2' ? '92vw' : '46vw') + ', ' + wide;
	}

	return { planGroup: planGroup, isLarge: isLarge, sizes: sizes, desktop: desktop, compact: compact };
});
