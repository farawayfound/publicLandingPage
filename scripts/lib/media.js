'use strict';
/* The landing page's snowboard clip. The original (assets/clips/tinySnowboarding.mp4, 10.5 MB, 852x480) is left
 * untouched; the page uses smaller transcodes created next to it:
 *   tinySnowboarding-480.mp4   H.264, no audio, about 1.5 MB   (the universal fallback)
 *   tinySnowboarding-480.webm  VP9, no audio, about 1.5 MB
 *   tinySnowboarding-poster.jpg  a still frame shown until the card scrolls into view
 * They are created only when missing and only when ffmpeg is installed.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CLIP = {
	src: 'assets/clips/tinySnowboarding.mp4',
	mp4: 'assets/clips/tinySnowboarding-480.mp4',
	webm: 'assets/clips/tinySnowboarding-480.webm',
	poster: 'assets/clips/tinySnowboarding-poster.jpg',
	posterAt: 3, // seconds
};

function run(cmd, args) {
	const r = cp.spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
	return r.status === 0 ? null : String(r.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || `${cmd} failed`;
}

/** @returns {{mp4:string|null, webm:string|null, poster:string|null, notes:string[]}} rel paths that exist */
function ensureClip(root, opts = {}) {
	const abs = (rel) => path.join(root, rel);
	const notes = [];
	const out = { mp4: null, webm: null, poster: null, notes };
	if (!fs.existsSync(abs(CLIP.src))) { notes.push(`missing ${CLIP.src}`); return out; }
	let ffmpeg = false;
	try { ffmpeg = cp.spawnSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0; } catch (e) { /* none */ }
	const make = (rel, args) => {
		if (fs.existsSync(abs(rel)) && !opts.force) return rel;
		if (!opts.enabled && opts.enabled !== undefined) return null;
		if (!ffmpeg) { notes.push(`${rel} is missing and ffmpeg is not installed`); return null; }
		const tmp = abs(rel).replace(/(\.[a-z0-9]+)$/, '.tmp$1');
		const err = run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', abs(CLIP.src), ...args, tmp]);
		if (err || !fs.existsSync(tmp)) { notes.push(`could not create ${rel}: ${err}`); try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } return null; }
		fs.renameSync(tmp, abs(rel));
		notes.push(`created ${rel} (${Math.round(fs.statSync(abs(rel)).size / 1024)} KB)`);
		return rel;
	};
	out.mp4 = make(CLIP.mp4, ['-an', '-vf', 'hqdn3d=2:2:6:6', '-c:v', 'libx264', '-preset', 'slow', '-crf', '34', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', '-f', 'mp4']);
	out.webm = make(CLIP.webm, ['-an', '-vf', 'hqdn3d=2:2:6:6', '-c:v', 'libvpx-vp9', '-b:v', '560k', '-maxrate', '900k', '-bufsize', '1800k', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-g', '120', '-tile-columns', '1', '-f', 'webm']);
	out.poster = make(CLIP.poster, ['-ss', String(CLIP.posterAt), '-frames:v', '1', '-q:v', '4', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg']);
	return out;
}

module.exports = { ensureClip, CLIP };
