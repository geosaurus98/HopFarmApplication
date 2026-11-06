// Local server for development and end-to-end tests:
//   static files from app/  +  POST /api handled by the real Apps Script code (in memory).
// Usage: node tests/support/dev-server.js [port]   then open http://localhost:<port>
//        Sign in with server address "/api", e.g. username lee / code 333333.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createSeededGas } = require('./gas-mock');

const APP_DIR = path.join(__dirname, '..', '..', 'app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function startServer(port = 0) {
  const g = createSeededGas();
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (server.apiDown) { res.writeHead(503); res.end('down'); return; }
        const out = g.gs.doPost({ postData: { contents: body } }).getContent();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out);
      });
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(APP_DIR, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, g, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { startServer };

if (require.main === module) {
  startServer(Number(process.argv[2]) || 8080).then(({ url }) => console.log(`Hop Farm dev server: ${url}  (server address: /api)`));
}
