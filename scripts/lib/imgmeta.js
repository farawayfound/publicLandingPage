'use strict';
/* Photo metadata: find it and strip it, losslessly. Zero dependencies.
 *
 * Camera files carry EXIF (camera model and serial number, owner name, sometimes GPS), XMP, IPTC and comments. A published
 * photo must carry none of it. JPEG: every APPn / COM segment is dropped except what the picture needs to look right -
 * JFIF (APP0), the ICC colour profile (APP2) and Adobe's colour-transform marker (APP14) - and, when the photo is stored
 * rotated, a tiny new EXIF block that holds the Orientation tag and nothing else. The compressed picture data is copied
 * byte for byte, so nothing is re-encoded and the pixels do not change. Anything after the end-of-image marker (embedded
 * thumbnails, MPF trailers, maker-note blobs) is dropped. PNG: text / EXIF / time chunks are dropped. WebP: reported only
 * (the build's own WebP files come out of cwebp without metadata).
 */
const fs = require('fs');

const EMAIL_RE = /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9-]{2,}(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const asLatin1 = (buf) => buf.toString('latin1');

/* ---------------------------------------------------------------- JPEG */

/** list the segments of a JPEG header (up to the first SOS). buf must hold at least the header; `complete` is false when it ends mid-segment */
function jpegSegments(buf) {
	const segs = [];
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { ok: false, segs, sos: -1, complete: true };
	let pos = 2;
	while (pos + 4 <= buf.length) {
		if (buf[pos] !== 0xff) return { ok: false, segs, sos: -1, complete: true };
		while (buf[pos + 1] === 0xff) pos++;                          // fill bytes
		const marker = buf[pos + 1];
		if (marker === 0xda) return { ok: true, segs, sos: pos, complete: true };
		if (marker === 0xd9) return { ok: true, segs, sos: -1, complete: true };
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { pos += 2; continue; }
		const len = buf.readUInt16BE(pos + 2);
		if (pos + 2 + len > buf.length) return { ok: true, segs, sos: -1, complete: false };
		segs.push(describe(buf, pos, 2 + len, marker));
		pos += 2 + len;
	}
	return { ok: true, segs, sos: -1, complete: false };
}

function describe(buf, start, size, marker) {
	const body = buf.subarray(start + 4, start + size);
	const head = asLatin1(body.subarray(0, 40));
	let kind = 'other';
	if (marker === 0xe0) kind = /^JFIF\0|^JFXX\0/.test(head) ? 'jfif' : 'other';
	else if (marker === 0xe1) kind = /^Exif\0\0/.test(head) ? 'exif' : /^http:\/\/ns\.adobe\.com\/x(?:ap|mp)/.test(head) ? 'xmp' : 'other';
	else if (marker === 0xe2) kind = /^ICC_PROFILE\0/.test(head) ? 'icc' : /^MPF\0/.test(head) ? 'mpf' : 'other';
	else if (marker === 0xed) kind = 'iptc';
	else if (marker === 0xee) kind = /^Adobe/.test(head) ? 'adobe' : 'other';
	else if (marker === 0xfe) kind = 'comment';
	else if (marker >= 0xe0 && marker <= 0xef) kind = 'other';
	else kind = 'data';
	return { marker, start, size, kind };
}

/** the parts of a TIFF/EXIF block that matter for privacy and display */
function parseExif(body) {
	const out = { orientation: 1, gps: false, serial: false, owner: false, artist: '', copyright: '', make: '', model: '', entries: 0 };
	try {
		const t = body.subarray(6);
		const le = t[0] === 0x49;
		const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
		const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
		const str = (o, count) => { if (count <= 4) return asLatin1(t.subarray(o + 8, o + 8 + count)).replace(/\0.*$/, ''); const off = u32(o + 8); return asLatin1(t.subarray(off, off + count)).replace(/\0.*$/, ''); };
		const ifd = (off, visit) => { if (!off || off + 2 > t.length) return; const n = u16(off); for (let i = 0; i < n && off + 2 + i * 12 + 12 <= t.length; i++) visit(off + 2 + i * 12, u16(off + 2 + i * 12)); };
		let gpsOff = 0, exifOff = 0;
		ifd(u32(4), (e, tag) => {
			out.entries++;
			if (tag === 0x0112) out.orientation = u16(e + 8);
			else if (tag === 0x8825) gpsOff = u32(e + 8);
			else if (tag === 0x8769) exifOff = u32(e + 8);
			else if (tag === 0x013b) out.artist = str(e, u32(e + 4));
			else if (tag === 0x8298) out.copyright = str(e, u32(e + 4));
			else if (tag === 0x010f) out.make = str(e, u32(e + 4));
			else if (tag === 0x0110) out.model = str(e, u32(e + 4));
		});
		let lat = false, lon = false;
		ifd(gpsOff, (e, tag) => { if (tag === 0x0002) lat = true; if (tag === 0x0004) lon = true; });
		out.gps = lat && lon;
		ifd(exifOff, (e, tag) => { if (tag === 0xa431 || tag === 0xa435) out.serial = true; if (tag === 0xa430) out.owner = true; });
	} catch (e) { /* a damaged block: report what we have */ }
	return out;
}

/** what a JPEG carries. `buf` = at least the whole header (the first 256 KB is plenty). */
function inspectJpeg(buf) {
	const { ok, segs, sos, complete } = jpegSegments(buf);
	const r = { type: 'jpeg', ok, complete, exif: false, xmp: false, iptc: false, comment: false, other: 0, gps: false, serial: false, orientation: 1, emails: [], names: [], camera: '' };
	if (!ok) return r;
	for (const s of segs) {
		const bytes = buf.subarray(s.start + 4, s.start + s.size);
		if (s.kind === 'exif') {
			const x = parseExif(bytes);
			r.exif = r.exif || !(x.entries === 1 && x.orientation > 1);       // an Orientation-only block (what the strip leaves behind) is fine
			r.gps = r.gps || x.gps; r.serial = r.serial || x.serial || x.owner; r.orientation = x.orientation || 1;
			for (const n of [x.artist, x.copyright]) if (n && !r.names.includes(n)) r.names.push(n);
			r.camera = [x.make, x.model].filter(Boolean).join(' ').trim();
		} else if (s.kind === 'xmp') r.xmp = true;
		else if (s.kind === 'iptc') r.iptc = true;
		else if (s.kind === 'comment') r.comment = true;
		else if (s.kind === 'mpf' || s.kind === 'other') r.other++;
		if (s.kind === 'exif' || s.kind === 'xmp' || s.kind === 'iptc' || s.kind === 'comment') for (const m of asLatin1(bytes).match(EMAIL_RE) || []) if (!r.emails.includes(m)) r.emails.push(m);
	}
	return r;
}

/** Orientation-only EXIF block (APP1) */
function orientationExif(o) {
	const b = Buffer.alloc(36);
	b[0] = 0xff; b[1] = 0xe1; b.writeUInt16BE(34, 2);
	b.write('Exif\0\0', 4, 'latin1');
	b.write('MM', 10, 'latin1'); b.writeUInt16BE(0x2a, 12); b.writeUInt32BE(8, 14);   // TIFF header, IFD0 at offset 8
	b.writeUInt16BE(1, 18);                                                              // one entry
	b.writeUInt16BE(0x0112, 20); b.writeUInt16BE(3, 22); b.writeUInt32BE(1, 24); b.writeUInt16BE(o, 28);   // Orientation, SHORT
	return b;                                                                           // next-IFD offset (4 bytes) stays 0
}

/** a metadata-free copy of a whole JPEG (Buffer), or null when it cannot be parsed. Pixels are untouched. */
function stripJpeg(buf) {
	const { ok, segs, sos } = jpegSegments(buf);
	if (!ok || sos < 0) return null;
	let orientation = 1;
	const keep = [];
	for (const s of segs) {
		if (s.kind === 'exif') { const o = parseExif(buf.subarray(s.start + 4, s.start + s.size)).orientation; if (o > 1 && o <= 8) orientation = o; continue; }
		if (s.kind === 'xmp' || s.kind === 'iptc' || s.kind === 'comment' || s.kind === 'mpf' || s.kind === 'other') continue;
		keep.push(buf.subarray(s.start, s.start + s.size));
	}
	// the compressed data: from SOS to the first real EOI; metadata segments that sit between scans (rare) are cut out too
	const body = [];
	let pos = sos, from = sos, end = -1;
	while (pos + 1 < buf.length) {
		if (buf[pos] !== 0xff) { pos++; continue; }
		const m = buf[pos + 1];
		if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) { pos += 2; continue; }
		if (m === 0xff) { pos++; continue; }
		if (m === 0xd9) { end = pos + 2; break; }
		if (m === 0x01 || m === 0xd8) { pos += 2; continue; }
		const len = buf.readUInt16BE(pos + 2);
		const seg = describe(buf, pos, 2 + len, m);
		if (m >= 0xe0 && m <= 0xef || m === 0xfe) {
			if (!(seg.kind === 'icc' || seg.kind === 'adobe' || seg.kind === 'jfif')) { body.push(buf.subarray(from, pos)); from = pos + 2 + len; }
		}
		pos += 2 + len;
	}
	if (end < 0) return null;
	body.push(buf.subarray(from, end));
	return Buffer.concat([Buffer.from([0xff, 0xd8]), ...(orientation > 1 ? [orientationExif(orientation)] : []), ...keep, ...body]);
}

/* ---------------------------------------------------------------- PNG / WebP */

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function pngChunks(buf) {
	const out = [];
	if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
	let pos = 8;
	while (pos + 12 <= buf.length) {
		const len = buf.readUInt32BE(pos), type = asLatin1(buf.subarray(pos + 4, pos + 8));
		out.push({ type, start: pos, size: 12 + len });
		pos += 12 + len;
		if (type === 'IEND') break;
	}
	return out;
}
function inspectPng(buf) {
	const chunks = pngChunks(buf);
	const r = { type: 'png', ok: !!chunks, exif: false, xmp: false, iptc: false, comment: false, other: 0, gps: false, serial: false, orientation: 1, emails: [], names: [], camera: '' };
	if (!chunks) return r;
	for (const c of chunks) {
		if (c.type === 'eXIf') r.exif = true;
		if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') { r.comment = true; if (/XML:com\.adobe\.xmp/.test(asLatin1(buf.subarray(c.start + 8, c.start + 40)))) r.xmp = true; }
		if (c.type === 'tIME') r.other++;
		if (c.type === 'eXIf' || c.type === 'tEXt' || c.type === 'iTXt') for (const m of asLatin1(buf.subarray(c.start + 8, c.start + c.size - 4)).match(EMAIL_RE) || []) if (!r.emails.includes(m)) r.emails.push(m);
	}
	return r;
}
function stripPng(buf) {
	const chunks = pngChunks(buf);
	if (!chunks) return null;
	return Buffer.concat([buf.subarray(0, 8), ...chunks.filter((c) => !PNG_DROP.has(c.type)).map((c) => buf.subarray(c.start, c.start + c.size))]);
}

function inspectWebp(fd, size) {
	const r = { type: 'webp', ok: false, exif: false, xmp: false, iptc: false, comment: false, other: 0, gps: false, serial: false, orientation: 1, emails: [], names: [], camera: '' };
	const h = Buffer.alloc(12);
	if (fs.readSync(fd, h, 0, 12, 0) < 12 || asLatin1(h.subarray(0, 4)) !== 'RIFF' || asLatin1(h.subarray(8, 12)) !== 'WEBP') return r;
	r.ok = true;
	let pos = 12;
	const c = Buffer.alloc(8);
	while (pos + 8 <= size) {
		if (fs.readSync(fd, c, 0, 8, pos) < 8) break;
		const tag = asLatin1(c.subarray(0, 4)), len = c.readUInt32LE(4);
		if (tag === 'EXIF') r.exif = true;
		if (tag === 'XMP ') r.xmp = true;
		pos += 8 + len + (len & 1);
	}
	return r;
}

/* ---------------------------------------------------------------- files */

const EXT = /\.(jpe?g|png|webp)$/i;
/** inspect one file; returns { type, ok, exif, xmp, iptc, comment, gps, serial, emails, names, camera, dirty } or null for other file types */
function inspectFile(file, size) {
	if (!EXT.test(file)) return null;
	const fd = fs.openSync(file, 'r');
	try {
		size = size == null ? fs.fstatSync(fd).size : size;
		if (/\.webp$/i.test(file)) { const r = inspectWebp(fd, size); r.dirty = r.exif || r.xmp; return r; }
		let want = 262144, buf;
		for (;;) {
			buf = Buffer.alloc(Math.min(size, want));
			fs.readSync(fd, buf, 0, buf.length, 0);
			if (/\.png$/i.test(file)) { if (size > want) { want = size; continue; } const r = inspectPng(buf); r.dirty = r.exif || r.xmp || r.comment || r.other > 0; return r; }
			const r = inspectJpeg(buf);
			if (!r.complete && size > buf.length && want < 8 * 1024 * 1024) { want *= 4; continue; }
			r.dirty = r.exif || r.xmp || r.iptc || r.comment || r.other > 0;
			return r;
		}
	} finally { fs.closeSync(fd); }
}

/** all image files below dir (skips the listed folder names) */
function walk(dir, skip = []) {
	const out = [];
	const rec = (d) => {
		let list = [];
		try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
		for (const e of list) {
			const p = d + '/' + e.name;
			if (e.isDirectory()) { if (!skip.includes(e.name)) rec(p); } else if (EXT.test(e.name)) out.push(p);
		}
	};
	rec(dir);
	return out.sort();
}

/** summary used by the build and the CLI */
function scan(dir, skip = ['derived']) {
	const files = walk(dir, skip);
	const res = { total: files.length, dirty: [], gps: [], emails: [], serial: [], names: new Set(), byType: {} };
	for (const f of files) {
		let r = null;
		try { r = inspectFile(f); } catch (e) { continue; }
		if (!r) continue;
		res.byType[r.type] = (res.byType[r.type] || 0) + 1;
		if (!r.dirty) continue;
		res.dirty.push(f);
		if (r.gps) res.gps.push(f);
		if (r.emails.length) res.emails.push(f);
		if (r.serial) res.serial.push(f);
		r.names.forEach((n) => res.names.add(n));
	}
	return res;
}

module.exports = { inspectFile, inspectJpeg, stripJpeg, stripPng, orientationExif, walk, scan, EMAIL_RE };
