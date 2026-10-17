// Jalankan: node server.js  → buka http://localhost:3000
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const PORT = process.env.PORT || 3000;
const SITES = {
  otaku: 'https://otakudesu.blog',
  nao: 'https://s13.nontonanimeid.boats',
  myd: 'https://myd21.com'
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DROP = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-embedder-policy'];
// Skrip iklan yang dibuang dari halaman (daftar sebagian)
const ADS = /<script[^>]+src=["'][^"']*(googlesyndication|doubleclick|adsterra|popads|popcash|propellerads|exoclick|juicyads|highperformanceformat|profitablecpm|effectivegatecpm|onclickads|clickadu|hilltopads)[^"']*["'][^>]*>\s*<\/script>/gi;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rewrite(text, key, origin, isHtml) {
  const P = '/p/' + key, host = origin.replace(/^https?:/, '');
  text = text.replace(/(href|src|action|data-src|poster)=(["'])\/(?!\/)/gi, '$1=$2' + P + '/')
             .replace(/url\((["']?)\/(?!\/)/g, 'url($1' + P + '/');
  text = text.replace(new RegExp(esc(origin.replace(/^https:/, 'http:')), 'g'), P)
             .replace(new RegExp(esc(origin), 'g'), P)
             .replace(new RegExp('(["\'(=])' + esc(host), 'g'), '$1' + P);
  if (isHtml) {
    const inj = '<script>(function(){var P="' + P + '";function f(u){return typeof u==="string"&&u[0]==="/"&&u[1]!=="/"&&u.indexOf("/p/")!==0?P+u:u}' +
      'var of=window.fetch;if(of)window.fetch=function(u,o){return of(typeof u==="string"?f(u):u,o)};' +
      'var ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=f(u);return ox.apply(this,arguments)};' +
      'window.open=function(){return null};})();</script>';
    text = text.replace(ADS, '');
    text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, m => m + inj) : inj + text;
  }
  return text;
}

function decode(buf, enc) {
  if (enc === 'gzip') return zlib.gunzipSync(buf);
  if (enc === 'deflate') return zlib.inflateSync(buf);
  if (enc === 'br') return zlib.brotliDecompressSync(buf);
  return buf;
}

function proxy(req, res, key, rest) {
  const origin = SITES[key];
  if (!origin) { res.writeHead(404); return res.end('Situs tidak ditemukan'); }
  const target = new URL(rest || '/', origin);
  const headers = { 'user-agent': UA, accept: req.headers.accept || '*/*', 'accept-language': 'id,en;q=0.8', referer: origin + '/', host: target.host };
  if (req.headers.cookie) headers.cookie = req.headers.cookie;
  if (req.headers.range) headers.range = req.headers.range;
  const up = https.request(target, { method: req.method, headers }, r => {
    const h = {};
    for (const [k, v] of Object.entries(r.headers)) if (!DROP.includes(k)) h[k] = v;
    if (h.location) {
      const l = String(h.location);
      h.location = l.startsWith(origin) ? '/p/' + key + l.slice(origin.length) : l.startsWith('/') ? '/p/' + key + l : l;
    }
    if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).map(c => c.replace(/;\s*domain=[^;]*/i, '').replace(/;\s*secure/i, '').replace(/;\s*samesite=[^;]*/i, ''));
    const type = String(r.headers['content-type'] || '');
    const isHtml = type.includes('text/html'), isCss = type.includes('text/css');
    if (!isHtml && !isCss) { res.writeHead(r.statusCode, h); return r.pipe(res); }
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => {
      try {
        let body = decode(Buffer.concat(chunks), r.headers['content-encoding']).toString('utf8');
        body = rewrite(body, key, origin, isHtml);
        delete h['content-encoding']; delete h['content-length'];
        res.writeHead(r.statusCode, h); res.end(body);
      } catch (e) { res.writeHead(502); res.end('Gagal memproses halaman'); }
    });
  });
  up.setTimeout(20000, () => up.destroy());
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Situs tidak bisa dihubungi'); });
  req.pipe(up);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/p/_ping') { res.writeHead(200); return res.end('ok'); }
  const m = u.pathname.match(/^\/p\/([a-z]+)(\/.*)?$/);
  if (m) return proxy(req, res, m[1], (m[2] || '/') + u.search);
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { res.writeHead(500); return res.end('index.html tidak ada'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(d);
  });
}).listen(PORT, () => console.log('Buka http://localhost:' + PORT));
