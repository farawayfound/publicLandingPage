'use strict';
/* File-system helpers: case-correct path resolution and image header parsing. Zero dependencies.
 *
 * Why resolveCase exists: macOS and Windows file systems ignore letter case, the Raspberry Pi (ext4) does not.
 * A reference such as "assets/images/rainiernp/x.jpg" works on the Mac but 404s on the Pi when the folder is
 * really "rainierNP". Every image path in the content is resolved against the real on-disk spelling at build
 * time and the generated HTML only ever contains the real spelling.
 */
const fs = require('fs');
const path = require('path');

class Resolver {
	constructor(root) { this.root = root; this.dirs = new Map(); }

	list(dir) {
		if (this.dirs.has(dir)) return this.dirs.get(dir);
		let entry = null;
		try {
			const names = fs.readdirSync(dir);
			const lower = new Map();
			for (const n of names) {
				const k = n.normalize('NFC').toLowerCase();
				if (!lower.has(k)) lower.set(k, []);
				lower.get(k).push(n);
			}
			entry = { names: new Set(names.map((n) => n.normalize('NFC'))), raw: new Map(names.map((n) => [n.normalize('NFC'), n])), lower };
		} catch (e) { entry = null; }
		this.dirs.set(dir, entry);
		return entry;
	}

	/** @returns {{rel:string, fixed:boolean}|null} the on-disk spelling of `rel`, or null when the file does not exist */
	resolve(rel) {
		if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('\\')) return null;
		let cur = this.root;
		const out = [];
		let fixed = false;
		for (const rawPart of rel.split('/')) {
			if (rawPart === '' || rawPart === '.') continue;
			if (rawPart === '..') return null;
			const part = rawPart.normalize('NFC');
			const L = this.list(cur);
			if (!L) return null;
			let hit = L.names.has(part) ? L.raw.get(part) : null;
			if (!hit) {
				const c = L.lower.get(part.toLowerCase());
				if (c && c.length === 1) { hit = c[0]; fixed = true; }
				else return null; // missing, or ambiguous on a case-sensitive disk
			}
			out.push(hit);
			cur = path.join(cur, hit);
		}
		return { rel: out.join('/'), fixed };
	}

	/** forget cached directory listings (after files were generated) */
	invalidate() { this.dirs.clear(); }
}

/** Read width/height from the file header (JPEG, PNG, WebP, GIF). Returns {w,h} or null. */
function imageSizeOfFile(file) {
	let fd;
	try {
		fd = fs.openSync(file, 'r');
		const b = Buffer.alloc(32);
		const n = fs.readSync(fd, b, 0, 32, 0);
		if (n < 10) return null;
		if (b[0] === 0xff && b[1] === 0xd8) {
			const m = Buffer.alloc(9);
			let pos = 2;
			for (let guard = 0; guard < 400; guard++) {
				if (fs.readSync(fd, m, 0, 4, pos) < 4) break;
				if (m[0] !== 0xff) { pos++; continue; }
				const mk = m[1];
				if (mk === 0xff) { pos++; continue; }
				if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { pos += 2; continue; }
				const len = m.readUInt16BE(2);
				if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
					fs.readSync(fd, m, 0, 9, pos + 4);
					return { w: m.readUInt16BE(3), h: m.readUInt16BE(1) };
				}
				pos += 2 + len;
			}
			return null;
		}
		if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
			const tag = b.toString('ascii', 12, 16);
			if (tag === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
			if (tag === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
			if (tag === 'VP8X') return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
			return null;
		}
		if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
		if (b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
		return null;
	} catch (e) {
		return null;
	} finally {
		if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
	}
}

module.exports = { Resolver, imageSizeOfFile };
