#!/usr/bin/env node
'use strict';
/**
 * Photo privacy tool. Zero dependencies.
 *
 *   node scripts/strip-metadata.js                 check Public_html/assets/images (exit 1 when any photo carries metadata)
 *   node scripts/strip-metadata.js --write         strip it in place, losslessly (no re-encoding, the pixels do not change)
 *   node scripts/strip-metadata.js <dir|file> ...  check / strip other folders or files
 *
 * Camera files carry EXIF (camera and lens serial numbers, owner / artist / copyright names, sometimes GPS coordinates), XMP, IPTC
 * and comments, and the site publishes the original JPEGs (lightbox links). Run this once after adding photos from a camera and
 * before committing. JPEG: all APPn / COM segments go except JFIF, the ICC profile and Adobe's colour marker; a photo stored
 * rotated keeps a tiny EXIF block with only the Orientation tag. Everything after the end-of-image marker goes too. PNG: text,
 * EXIF and time chunks go. WebP is only reported (the build's own WebP files are metadata-free).
 *
 * Options
 *   --write      change the files (default: report only)
 *   --verbose    list every affected file
 *   --derived    also look inside assets/images/derived (skipped by default; those files come out of cwebp / ffmpeg clean)
 */
const fs = require('fs');
const path = require('path');
const { inspectFile, stripJpeg, stripPng, walk } = require('./lib/imgmeta');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { const m = /\/\*\*([\s\S]*?)\*\//.exec(fs.readFileSync(__filename, 'utf8')); console.log(m[1].replace(/^ \* ?/gm, '').trim()); process.exit(0); }
const write = args.includes('--write'), verbose = args.includes('--verbose'), derived = args.includes('--derived');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) targets.push(path.resolve(__dirname, '..', 'Public_html', 'assets', 'images'));

const files = [];
for (const t of targets) {
	let st = null;
	try { st = fs.statSync(t); } catch (e) { console.error(`not found: ${t}`); process.exit(2); }
	if (st.isDirectory()) files.push(...walk(path.resolve(t), derived ? [] : ['derived'])); else files.push(path.resolve(t));
}

const tally = { files: 0, dirty: 0, gps: 0, email: 0, serial: 0, fixed: 0, failed: 0, saved: 0, webp: 0 };
const names = new Set(), emails = new Set(), gpsFiles = [];
for (const f of files) {
	let r = null;
	try { r = inspectFile(f); } catch (e) { console.error(`cannot read ${f}: ${e.message}`); tally.failed++; continue; }
	if (!r) continue;
	tally.files++;
	if (!r.dirty) continue;
	tally.dirty++;
	if (r.gps) { tally.gps++; gpsFiles.push(f); }
	if (r.emails.length) tally.email++;
	if (r.serial) tally.serial++;
	r.names.forEach((n) => names.add(n)); r.emails.forEach((n) => emails.add(n));
	const what = [r.exif && 'exif', r.gps && 'GPS', r.xmp && 'xmp', r.iptc && 'iptc', r.comment && 'comment', r.emails.length && 'email'].filter(Boolean).join(', ');
	if (verbose) console.log(`${write ? 'strip ' : 'dirty '}${path.relative(process.cwd(), f)}  (${what})`);
	if (!write) continue;
	if (r.type === 'webp') { tally.webp++; continue; }
	const buf = fs.readFileSync(f);
	const out = r.type === 'png' ? stripPng(buf) : stripJpeg(buf);
	if (!out) { console.error(`cannot strip ${f} (unusual structure); left alone`); tally.failed++; continue; }
	// never write something that still reads as dirty, that cannot be parsed, or that lost the rotation tag
	const tmp = f.replace(/(\.[^./]+)$/, '.strip-tmp$1');   // keeps the extension so it can be inspected
	fs.writeFileSync(tmp, out, { mode: fs.statSync(f).mode });
	const back = inspectFile(tmp);
	if (!back || !back.ok || back.dirty || (r.type === 'jpeg' && back.orientation !== r.orientation)) { fs.unlinkSync(tmp); console.error(`strip of ${f} did not verify; left alone`); tally.failed++; continue; }
	fs.renameSync(tmp, f);
	tally.fixed++; tally.saved += buf.length - out.length;
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`${tally.files} photo file(s) checked in ${targets.map((t) => path.relative(process.cwd(), t) || '.').join(', ')}`);
console.log(`  with metadata: ${tally.dirty}   (GPS coordinates: ${tally.gps}, e-mail address: ${tally.email}, camera / owner serial: ${tally.serial})`);
if (names.size) console.log(`  names found in artist / copyright fields: ${[...names].slice(0, 8).join('; ')}${names.size > 8 ? ' ...' : ''}`);
if (emails.size) console.log(`  e-mail addresses found: ${emails.size} (${[...emails].slice(0, 3).join(', ')}${emails.size > 3 ? ' ...' : ''})`);
if (gpsFiles.length && !verbose) console.log(`  files with GPS: ${gpsFiles.map((f) => path.relative(process.cwd(), f)).slice(0, 10).join(', ')}${gpsFiles.length > 10 ? ' ...' : ''}`);
if (write) {
	console.log(`  stripped: ${tally.fixed} file(s), ${mb(tally.saved)} smaller${tally.webp ? `, ${tally.webp} WebP file(s) reported only` : ''}${tally.failed ? `, ${tally.failed} FAILED` : ''}`);
	process.exit(tally.failed ? 1 : 0);
}
if (tally.dirty) { console.log('  run again with --write to strip them (lossless; originals keep their colours and orientation).'); process.exit(1); }
console.log('  clean.');
