'use strict';
/* Small helpers shared by the generator and its templates. Zero dependencies. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Escape text for HTML (also safe inside double-quoted attributes). */
const esc = (s) => String(s == null ? '' : s)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Percent-encode every path segment: file names on the NAS contain spaces and parentheses. */
const encPath = (p) => String(p).split('/').map((seg) => encodeURIComponent(seg).replace(/%2F/gi, '/')).join('/');

/** JSON that is safe to embed inside a <script> element. */
const jsonForScript = (o) => JSON.stringify(o)
	.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
	.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const pad2 = (n) => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const fmtLat = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`;
/** "48.7°N 121.2°W" with a no-break space so it never wraps mid-coordinate. */
const fmtCoord = (c) => `${fmtLat(c[0])}\u00a0${fmtLon(c[1])}`;

/** Parse "YYYY-MM" or "YYYY-MM-DD". */
function parseDate(s) {
	const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ''));
	if (!m) return null;
	const y = +m[1], mo = +m[2];
	if (mo < 1 || mo > 12) return null;
	return { year: String(y), month: mo, label: `${MONTHS[mo - 1]} ${y}` };
}

/** File-system / URL friendly name: keeps letters, digits, dot, dash and underscore. */
const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';

/** First `limit` characters of a text, cut at a word boundary. */
function shorten(text, limit) {
	const t = String(text).replace(/\s+/g, ' ').trim();
	return t.length <= limit ? t : t.slice(0, limit).replace(/\s+\S*$/, '') + '\u2026';
}

const titleCase = (t) => { const s = String(t).replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };

/** Deterministic PRNG (used for the star texture). */
function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

module.exports = { MONTHS, esc, encPath, jsonForScript, pad2, plural, fmtNum, fmtLat, fmtLon, fmtCoord, parseDate, safeName, shorten, titleCase, mulberry32 };
