import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const distRoot = path.join(projectRoot, 'dist');
const htmlPath = path.join(distRoot, 'index.html');
const venuePath = path.join(distRoot, 'venue.json');

function hashInlineScripts(html) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const hashes = [];
  let match = scriptPattern.exec(html);

  while (match) {
    if (!/(?:^|\s)src\s*=/i.test(match[1])) {
      const digest = createHash('sha256').update(match[2], 'utf8').digest('base64');
      hashes.push(`'sha256-${digest}'`);
    }
    match = scriptPattern.exec(html);
  }

  if (hashes.length === 0) {
    throw new Error(
      'No inline scripts found in dist/index.html; refusing to emit an incomplete CSP',
    );
  }
  return hashes;
}

function getProxyOrigin(proxyUrl) {
  if (typeof proxyUrl !== 'string' || proxyUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(proxyUrl, 'https://same-origin.invalid');
    if (parsed.origin === 'https://same-origin.invalid') {
      return null;
    }
    return parsed.origin;
  } catch {
    throw new Error('venue.json proxyUrl is invalid; CSP was not generated');
  }
}

let html = await readFile(htmlPath, 'utf8');
const venue = JSON.parse(await readFile(venuePath, 'utf8'));
const scriptHashes = hashInlineScripts(html);
const connectOrigins = new Set(["'self'", 'https://api.alerts.in.ua']);
const proxyOrigin = getProxyOrigin(venue.proxyUrl);
if (proxyOrigin) {
  connectOrigins.add(proxyOrigin);
}

const metaDirectives = [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.join(' ')}`,
  `connect-src ${Array.from(connectOrigins).join(' ')}`,
  "media-src 'self' blob: data:",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
];
const metaPolicy = metaDirectives.join('; ');
const headerPolicy = [...metaDirectives, "frame-ancestors 'none'"].join('; ');

html = html.replace(/\s*<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${metaPolicy}">`;
if (!html.includes('</head>')) {
  throw new Error('dist/index.html has no closing head tag; CSP was not generated');
}
html = html.replace('</head>', `    ${cspMeta}\n  </head>`);
await writeFile(htmlPath, html);

const headerPath = path.join(distRoot, '_headers');
const existingHeaders = await readFile(headerPath, 'utf8').catch(() => '');
const cacheRules = existingHeaders
  .replace(/^\s*Content-Security-Policy:.*(?:\r?\n)?/gim, '')
  .trim();
const headerFile = `/*\n  Content-Security-Policy: ${headerPolicy}\n\n${cacheRules}\n`;
await writeFile(headerPath, headerFile);
