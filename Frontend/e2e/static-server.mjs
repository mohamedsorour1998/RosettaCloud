// @ts-nocheck
/**
 * Zero-dependency static file server for the Playwright e2e harness.
 *
 * Serves the Angular production build from
 *   dist/rosetta-cloud-frontend/browser
 * (see angular.json `outputPath`) on 127.0.0.1:$PORT (default 4200) with a
 * single-page-app fallback: any navigation to a path that is not a real file
 * returns index.html (HTTP 200) so the Angular router can resolve the route
 * client-side. Requests for missing *assets* (paths with an extension that a
 * browser fetches non-navigationally) return 404 so a broken script/image
 * never gets index.html served in its place (which would break ES module
 * parsing with "Unexpected token '<'").
 *
 * Uses only the Node standard library (node:http + node:fs) — no npm install
 * required, which keeps the harness reliably GREEN in CI.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRNAME = fileURLToPath(new URL('.', import.meta.url));
// e2e/ -> ../dist/rosetta-cloud-frontend/browser  (resolved relative to THIS
// file so it works regardless of the process cwd Playwright launches us with).
const DIST_DIR = resolve(DIRNAME, '..', 'dist', 'rosetta-cloud-frontend', 'browser');
const INDEX_HTML = join(DIST_DIR, 'index.html');

const PORT = Number(process.env.PORT) || 4200;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function statFile(filePath) {
  try {
    const s = await stat(filePath);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

function sendFile(res, method, filePath, fileStat, status = 200) {
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': String(fileStat.size),
    'Cache-Control': 'no-cache',
  };
  if (method === 'HEAD') {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, headers);
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    // Strip query string / fragment, decode, normalize, block path traversal.
    let pathname = (req.url || '/').split('?')[0].split('#')[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      /* keep raw pathname if it is not valid percent-encoding */
    }
    let relPath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    if (relPath === '/' || relPath === '' || relPath === '.') {
      relPath = 'index.html';
    }

    let filePath = join(DIST_DIR, relPath);
    // Never escape the dist directory.
    if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) {
      filePath = INDEX_HTML;
    }

    const fileStat = await statFile(filePath);
    if (fileStat) {
      sendFile(res, method, filePath, fileStat);
      return;
    }

    // SPA fallback decision.
    const accept = String(req.headers['accept'] || '');
    const wantsHtml = accept.includes('text/html');
    const hasExtension = extname(relPath) !== '';

    if (wantsHtml || !hasExtension) {
      const indexStat = await statFile(INDEX_HTML);
      if (!indexStat) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(
          `index.html not found at ${INDEX_HTML}. ` +
            'Run `npx ng build --configuration=production` before the e2e suite.'
        );
        return;
      }
      sendFile(res, method, INDEX_HTML, indexStat, 200);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
    // eslint-disable-next-line no-console
    console.error('[static-server] error handling request:', err);
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[static-server] serving ${DIST_DIR} at http://${HOST}:${PORT}`);
});
