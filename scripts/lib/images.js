'use strict';
/* Image pipeline: aspect-preserving WebP derivatives plus 1200x630 share images. Zero npm dependencies.
 *
 * The photos on disk are large (covers up to 4.4 MB, 3840 px wide; legacy gallery thumbnails are 600x392 centre
 * crops). Pages must never ship those directly, so the build creates, next to the originals,
 *   assets/images/derived/<same folders>/<name>-<width>.webp
 * and every <img> uses srcset over those files. The derived files are committed with the site (the Pi only
 * rsyncs Public_html), so the encoder is only needed on the machine where you build.
 *
 * Encoders: `cwebp` (package "webp") is preferred, `ffmpeg` is the fallback. A derived file that already exists
 * is never touched (use --force-images to rebuild), so a normal build is fast and offline.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { imageSizeOfFile } = require('./fsx');
const { safeName } = require('./util');

/** target widths per use. The original is only added as the largest srcset entry when asked for. */
const WIDTHS = {
	hero: [1280, 1920],       // landing slideshow (originals are 2560 px WebP and are added as the top entry)
	cover: [960, 1600, 2560], // story covers: hero image, big index tiles, og image source
	card: [480, 960, 1600],   // story thumbnails: index tiles (span by plan), strip, pager, map popover
	photo: [480, 960],        // gallery photos
	view: [1600],             // what the lightbox shows (the original is the top entry): only made for heavy originals
};
const VIEW_MIN_BYTES = 450 * 1024; // originals below this size (already efficient WebP) are shown as they are
const DERIVED_DIR = 'assets/images/derived';
const QUALITY = { 480: 76, 960: 78, 1280: 80, 1600: 80, 1920: 82, 2560: 82 };
const OG = { w: 1200, h: 630 };

function has(cmd, args) {
	try { return cp.spawnSync(cmd, args, { stdio: 'ignore' }).status === 0; } catch (e) { return false; }
}
function ffmpegHasWebp() {
	try {
		const r = cp.spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
		return r.status === 0 && /libwebp/.test(r.stdout || '');
	} catch (e) { return false; }
}
function detectTool() {
	if (has('cwebp', ['-version'])) return 'cwebp';
	if (ffmpegHasWebp()) return 'ffmpeg'; // only when this ffmpeg build includes libwebp
	return null;
}

function webpArgs(tool, src, dst, w, q) {
	if (tool === 'cwebp') return ['cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', '-metadata', 'icc', '-resize', String(w), '0', src, '-o', dst]];
	// -map_metadata -1: nothing of the source's EXIF / XMP (camera serials, GPS) may travel into a published file
	return ['ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', src, '-map_metadata', '-1', '-vf', `scale=${w}:-1:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', '-f', 'webp', dst]];
}

class Images {
	/**
	 * @param {{root:string, resolver:object, enabled?:boolean, force?:boolean, log?:function}} o
	 *   root: the site root (Public_html); derived files are written below it.
	 */
	constructor(o) {
		this.root = o.root;
		this.resolver = o.resolver;
		this.enabled = o.enabled !== false;
		this.force = !!o.force;
		this.log = o.log || (() => {});
		this.tool = this.enabled ? detectTool() : null;
		this.ffmpeg = this.enabled && has('ffmpeg', ['-hide_banner', '-version']);
		this.sizes = new Map();
		this.owner = new Map();   // derived rel -> source rel (collision check)
		this.done = new Set();    // derived rel handled in this run
		this.stats = { generated: 0, reused: 0, missingTool: 0, failed: 0, og: 0 };
		this.problems = [];
	}

	abs(rel) { return path.join(this.root, rel); }

	/** original/derived dimensions from the file header (cached) */
	size(rel) {
		if (!this.sizes.has(rel)) this.sizes.set(rel, imageSizeOfFile(this.abs(rel)));
		return this.sizes.get(rel);
	}

	derivedRel(srcRel, w) {
		const parts = srcRel.split('/');
		if (parts[0] === 'assets' && parts[1] === 'images') parts.splice(0, 2); else parts.unshift('_other');
		const file = parts.pop();
		const stem = safeName(file.replace(/\.[^.]+$/, ''));
		const dirs = parts.map(safeName);
		return [DERIVED_DIR, ...dirs, `${stem}-${w}.webp`].join('/');
	}

	_claim(dst, srcRel) {
		const prev = this.owner.get(dst);
		if (prev && prev !== srcRel) throw new Error(`derived-name collision: ${srcRel} and ${prev} both map to ${dst}`);
		this.owner.set(dst, srcRel);
	}

	/** synchronously make sure the derived file exists; returns its rel path or null when it cannot be made */
	ensureSync(srcRel, w) {
		const dst = this.derivedRel(srcRel, w);
		this._claim(dst, srcRel);
		const abs = this.abs(dst);
		const exists = fs.existsSync(abs);
		if (exists && !(this.force && !this.done.has(dst))) { this.stats.reused += this.done.has(dst) ? 0 : 1; this.done.add(dst); return dst; }
		if (!this.enabled) return exists ? dst : null;
		if (!this.tool) { this.stats.missingTool++; return exists ? dst : null; }
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		const tmp = abs.replace(/\.webp$/, '.tmp.webp');
		const [cmd, args] = webpArgs(this.tool, this.abs(srcRel), tmp, w, QUALITY[w] || 78);
		const r = cp.spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		if (r.status !== 0 || !fs.existsSync(tmp)) {
			this.stats.failed++;
			this.problems.push(`could not create ${dst}: ${String(r.stderr || '').split('\n')[0]}`);
			try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
			return exists ? dst : null;
		}
		fs.renameSync(tmp, abs);
		this.sizes.delete(dst);
		this.stats.generated++;
		this.done.add(dst);
		return dst;
	}

	/** create many derived files with a small process pool (the build calls this before rendering) */
	async prewarm(items) {
		if (!this.enabled || !this.tool) return;
		const jobs = [];
		const seen = new Set();
		for (const { src, widths, minBytes } of items) {
			const sz = this.size(src);
			if (!sz) continue;
			if (minBytes) { try { if (fs.statSync(this.abs(src)).size < minBytes) continue; } catch (e) { continue; } }
			for (const w of widths) {
				if (w >= sz.w - 8) continue;
				const dst = this.derivedRel(src, w);
				if (seen.has(dst)) continue;
				seen.add(dst);
				this._claim(dst, src);
				if (fs.existsSync(this.abs(dst)) && !this.force) continue;
				jobs.push({ src, dst, w });
			}
		}
		if (!jobs.length) return;
		this.log(`images: creating ${jobs.length} derived file(s) with ${this.tool} ...`);
		let next = 0, finished = 0;
		const workers = Math.max(2, Math.min(8, os.cpus().length - 1));
		const run = () => new Promise((resolve) => {
			const step = () => {
				const j = jobs[next++];
				if (!j) return resolve();
				fs.mkdirSync(path.dirname(this.abs(j.dst)), { recursive: true });
				const tmp = this.abs(j.dst).replace(/\.webp$/, '.tmp.webp');
				const [cmd, args] = webpArgs(this.tool, this.abs(j.src), tmp, j.w, QUALITY[j.w] || 78);
				const child = cp.spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
				let err = '';
				child.stderr.on('data', (d) => { err += d; });
				child.on('close', (code) => {
					if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, this.abs(j.dst)); this.stats.generated++; this.done.add(j.dst); }
					else { this.stats.failed++; this.problems.push(`could not create ${j.dst}: ${err.split('\n')[0]}`); try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } }
					finished++;
					if (finished % 100 === 0) this.log(`  ... ${finished}/${jobs.length}`);
					step();
				});
				child.on('error', () => { this.stats.failed++; finished++; step(); });
			};
			step();
		});
		await Promise.all(Array.from({ length: workers }, run));
		this.resolver.invalidate();
	}

	/**
	 * Candidate files for one photo.
	 * @returns {{src:string,w:number,h:number,list:{rel:string,w:number,h:number}[],pick:function,srcset:function}|null}
	 */
	variants(srcRel, widths, opts = {}) {
		const sz = this.size(srcRel);
		if (!sz) return null;
		const list = [];
		if (opts.minBytes) { try { if (fs.statSync(this.abs(srcRel)).size < opts.minBytes) widths = []; } catch (e) { widths = []; } }
		for (const w of widths) {
			if (w >= sz.w - 8) continue; // never upscale, skip near-duplicates of the original
			const rel = this.ensureSync(srcRel, w);
			const d = rel && this.size(rel);
			if (d) list.push({ rel, w: d.w, h: d.h });
		}
		if ((opts.original && sz.w <= (opts.maxOriginal || Infinity)) || list.length === 0) list.push({ rel: srcRel, w: sz.w, h: sz.h });
		list.sort((a, b) => a.w - b.w);
		return {
			src: srcRel, w: sz.w, h: sz.h, list,
			/** smallest candidate that is at least `target` px wide, else the largest */
			pick(target) { return list.find((c) => c.w >= target) || list[list.length - 1]; },
			srcset(prefix, enc) { return list.map((c) => `${prefix}${enc(c.rel)} ${c.w}w`).join(', '); },
		};
	}

	/**
	 * 1200x630 JPEG for link previews (WebP is not accepted everywhere). `pos` is a CSS object-position such as
	 * "57% 30%" so the crop follows the story's coverPosition. Returns the rel path or null.
	 */
	og(srcRel, name, pos) {
		const dst = `${DERIVED_DIR}/og/${safeName(name)}.jpg`;
		const abs = this.abs(dst);
		if (fs.existsSync(abs) && !this.force) { this.stats.reused++; return dst; }
		if (!this.ffmpeg) return null;
		let px = 0.5, py = 0.5;
		const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(pos || '');
		if (m) { px = Math.min(1, Math.max(0, +m[1] / 100)); py = Math.min(1, Math.max(0, +m[2] / 100)); }
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		const vf = `scale=${OG.w}:${OG.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OG.w}:${OG.h}:(iw-${OG.w})*${px}:(ih-${OG.h})*${py}`;
		const tmp = abs.replace(/\.jpg$/, '.tmp.jpg');
		const r = cp.spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', this.abs(srcRel), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-vf', vf, '-frames:v', '1', '-q:v', '3', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
		if (r.status !== 0 || !fs.existsSync(tmp)) { this.problems.push(`could not create ${dst}`); try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } return null; }
		fs.renameSync(tmp, abs);
		this.stats.og++;
		return dst;
	}
}

module.exports = { Images, WIDTHS, VIEW_MIN_BYTES, DERIVED_DIR, OG };
