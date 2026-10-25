#!/usr/bin/env node
'use strict';
/* Tiny static file server for previewing and testing Public_html. Zero dependencies.
 *
 *   node tests/serve.js [--root Public_html] [--port 8765]
 *
 * Unlike `python3 -m http.server` on a Mac, it is CASE-SENSITIVE like the Raspberry Pi: a request for
 * /assets/images/rainiernp/x.jpg answers 404 when the folder is really rainierNP. That is how a letter-case
 * mistake is caught before it reaches the live site. It also supports HTTP Range requests (video playback).
 * Programmatic use: const { start } = require('./serve'); const srv = await start({ root, port }); srv.close();
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
	'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.JPG': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
	'.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
};

/** resolve a URL path to a file, matching every path segment with EXACT letter case */
function resolveExact(root, urlPath) {
	let cur = root;
	const parts = decodeURIComponent(urlPath.split('?')[0]).split('/').filter(Boolean);
	for (const part of parts) {
		if (part === '..' || part.includes('\0')) return null;
		let names;
		try { names = fs.readdirSync(cur); } catch (e) { return null; }
		if (!names.includes(part.normalize('NFC')) && !names.includes(part)) {
			if (!names.map((n) => n.normalize('NFC')).includes(part.normalize('NFC'))) return null;
		}
		const real = names.find((n) => n === part || n.normalize('NFC') === part.normalize('NFC'));
		cur = path.join(cur, real);
	}
	return cur;
}

function start(opts = {}) {
	const root = path.resolve(opts.root || path.join(__dirname, '..', 'Public_html'));
	const stats = { requests: 0, notFound: [] };
	const server = http.createServer((req, res) => {
		stats.requests++;
		let file = resolveExact(root, req.url);
		if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
			if (!req.url.split('?')[0].endsWith('/')) { res.writeHead(301, { Location: req.url.split('?')[0] + '/' }); return res.end(); }
			file = path.join(file, 'index.html');
		}
		if (!file || !fs.existsSync(file)) {
			stats.notFound.push(req.url);
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			return res.end('404 ' + req.url);
		}
		const st = fs.statSync(file);
		const type = TYPES[path.extname(file)] || TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
		const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString() };
		const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
		if (range && (range[1] || range[2])) {
			let start = range[1] ? +range[1] : Math.max(0, st.size - +range[2]);
			let end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
			if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
			res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
			if (req.method === 'HEAD') return res.end();
			return fs.createReadStream(file, { start, end }).pipe(res);
		}
		res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
		if (req.method === 'HEAD') return res.end();
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve, reject) => {
		server.on('error', reject);
		server.listen(opts.port || 0, '127.0.0.1', () => {
			const port = server.address().port;
			resolve({ port, root, url: `http://127.0.0.1:${port}`, stats, close: () => new Promise((r) => server.close(r)) });
		});
	});
}

module.exports = { start, resolveExact };

if (require.main === module) {
	const args = process.argv.slice(2);
	const get = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
	start({ root: get('--root'), port: +get('--port', 8765) }).then((s) => console.log(`serving ${s.root} at ${s.url} (case-sensitive, like the Pi)`));
}
