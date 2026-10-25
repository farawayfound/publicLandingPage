'use strict';
/* Hero tone: how much flat, neutral darkening a hero photo needs so the white words on it stay readable.
 *
 * The words of a hero (date line, title, cue / tagline) sit in the middle band of the photo. A bright sky, snow or haze
 * there leaves white text with almost no contrast. Instead of a dark blurred plate behind the words (which reads as a
 * smudge) the page lays one flat, neutral layer over the whole photo, and only as much as that photo needs:
 *
 *   shade = 0 for dark / mid photos (they are left completely alone), up to MAX_SHADE for white skies.
 *
 * The photo is decoded with ffmpeg at 108x60 (and 48x104 for a phone), cropped like the page crops it (object-fit: cover around the cover
 * position), the luminance behind the words is measured, and the shade is derived from its 75th percentile. Measured values
 * are remembered in Public_html/assets/data/hero-tone.json (keyed by file, size, position and band), so a build on a machine
 * without ffmpeg keeps the last values and a normal rebuild does not decode anything. Override per story with "heroShade"
 * in the story JSON or content/site.json -> hero.shade { "<slug>": 0.3 } (for stories whose JSON cannot be edited).
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DIM = { d: [108, 60], m: [48, 104] };   // decoded sizes: a desktop hero is about 1.8:1, a phone hero about 0.46:1
const TARGET = 2.4;                       // white text on the band should reach about this contrast; the dark text-shadow and the outlined frame add the rest
const MAX_SHADE = 0.34;                   // never wash a photo out: this is the most any hero is darkened
const STEP = 0.02;
/* where the words sit in the hero crop, as fractions (x0, y0, x1, y1) of a 1440x900 desktop screen; the union is measured */
const BANDS = {
	post: [[0.33, 0.33, 0.67, 0.56], [0.34, 0.235, 0.66, 0.29], [0.42, 0.59, 0.58, 0.65]],   // boxed title, date line, cue
	blog: [[0.14, 0.34, 0.86, 0.56], [0.42, 0.62, 0.58, 0.69]],                               // wide one-line title, cue
	home: [[0.35, 0.28, 0.65, 0.38], [0.24, 0.41, 0.76, 0.46], [0.4, 0.5, 0.6, 0.58]],        // pill, tagline, cue
	/* the same on a 390x844 phone (the photo is cropped to its middle strip and the words fill the width) */
	'post-m': [[0.24, 0.33, 0.76, 0.44], [0.2, 0.27, 0.8, 0.32], [0.3, 0.45, 0.7, 0.52]],
	'blog-m': [[0.15, 0.3, 0.85, 0.5], [0.3, 0.53, 0.7, 0.58]],
	'home-m': [[0.25, 0.33, 0.75, 0.36], [0.1, 0.4, 0.9, 0.45], [0.12, 0.475, 0.88, 0.5]],
};
const CACHE_REL = 'assets/data/hero-tone.json';
const VERSION = 3;                        // bump when the measurement (bands, percentile, crop) changes: older cached values are dropped

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

function ffmpegOk() {
	try { return cp.spawnSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0; } catch (e) { return false; }
}

/** raw rgb24 pixels of the photo, scaled and cropped like object-fit: cover at W:H around `pos` ("57% 30%") */
function decode(abs, pos, W, H) {
	let px = 0.5, py = 0.5;
	const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(pos || '');
	if (m) { px = Math.min(1, Math.max(0, +m[1] / 100)); py = Math.min(1, Math.max(0, +m[2] / 100)); }
	const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=area,crop=${W}:${H}:(iw-${W})*${px}:(ih-${H})*${py}`;
	const r = cp.spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', abs, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 3 + 4096 });
	if (r.status !== 0 || !r.stdout || r.stdout.length < W * H * 3) return null;
	return r.stdout;
}

/** 75th-percentile relative luminance (0..1) over all the boxes (the words together; a single small bright patch is the text-shadow's job) */
function bandLuminance(buf, boxes, W, H) {
	const v = [];
	for (const b of boxes) {
		const x0 = Math.floor(b[0] * W), x1 = Math.max(x0 + 1, Math.ceil(b[2] * W)), y0 = Math.floor(b[1] * H), y1 = Math.max(y0 + 1, Math.ceil(b[3] * H));
		for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
			const i = (y * W + x) * 3;
			v.push(0.2126 * lin(buf[i]) + 0.7152 * lin(buf[i + 1]) + 0.0722 * lin(buf[i + 2]));
		}
	}
	v.sort((p, q) => p - q);
	return v[Math.floor(v.length * 0.75)];
}

/** the flat darkening (0..MAX_SHADE) that brings white text on luminance `lum` up to TARGET:1 (sRGB scaling: L' ~ L * f^2.2) */
function shadeFor(lum) {
	const need = (1.05 / TARGET - 0.05) / Math.max(lum, 1e-4);
	if (need >= 1) return 0;
	const f = Math.pow(need, 1 / 2.2);
	const a = Math.min(MAX_SHADE, 1 - f);
	const q = Math.round(a / STEP) * STEP;
	return q < 0.05 ? 0 : +q.toFixed(2);
}

class Tone {
	/** @param {{root:string, enabled?:boolean, log?:function, warn?:function}} o  root = site root (Public_html) */
	constructor(o) {
		this.root = o.root;
		this.enabled = o.enabled !== false;
		this.warn = o.warn || (() => {});
		this.file = path.join(this.root, CACHE_REL);
		this.cache = {};
		try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (j.version === VERSION) this.cache = j.items || {}; } catch (e) { /* none yet */ }
		this.used = {};
		this.ffmpeg = this.enabled && ffmpegOk();
		this.dirty = false;
		this.missing = 0;
	}

	/** luminance of the text band of a hero photo (rel = path below Public_html), cached by file size */
	lum(rel, pos, kind) {
		const band = BANDS[kind] || BANDS.post;
		const [W, H] = DIM[/-m$/.test(kind) ? 'm' : 'd'];
		const key = `${rel}|${pos || ''}|${kind}`;
		const abs = path.join(this.root, rel);
		let size = 0;
		try { size = fs.statSync(abs).size; } catch (e) { return null; }
		const hit = this.cache[key];
		if (hit && hit.size === size) { this.used[key] = hit; return hit.lum; }
		if (this.ffmpeg) {
			const buf = decode(abs, pos, W, H);
			if (buf) {
				const l = +bandLuminance(buf, band, W, H).toFixed(4);
				this.used[key] = { size, lum: l };
				this.dirty = true;
				return l;
			}
		}
		if (hit) { this.used[key] = hit; return hit.lum; }
		this.missing++;
		return null;
	}

	/** flat shade for a hero photo: 0 when it is dark enough (or cannot be measured) */
	shade(rel, pos, kind, override) {
		if (typeof override === 'number' && override >= 0) return Math.min(0.6, +override.toFixed(2));
		const l = this.lum(rel, pos, kind);
		return l == null ? 0 : shadeFor(l);
	}

	/** { d, m }: the flat darkening on a desktop screen and on a phone (the words sit over different parts of the photo) */
	shades(rel, pos, kind, override) {
		return { d: this.shade(rel, pos, kind, override), m: this.shade(rel, pos, kind + '-m', override) };
	}

	/** write the cache (only the entries still in use, sorted, so the file is stable) */
	save() {
		const keys = Object.keys(this.used).sort();
		const next = {};
		for (const k of keys) next[k] = this.used[k];
		const text = JSON.stringify({ _readme: 'Generated by scripts/build-site.js (scripts/lib/tone.js). Luminance of the text band of every hero photo; the page darkens bright heroes by a flat, neutral amount derived from it.', version: VERSION, items: next }, null, 1) + '\n';
		let prev = '';
		try { prev = fs.readFileSync(this.file, 'utf8'); } catch (e) { /* new */ }
		if (prev !== text) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, text); }
	}
}

module.exports = { Tone, shadeFor, bandLuminance, decode, BANDS, DIM, MAX_SHADE, TARGET };
