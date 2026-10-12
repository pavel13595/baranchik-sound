import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const tokenLikeHex = /\b[0-9a-f]{40,}\b/i;

async function findTokenLikeJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const match = await findTokenLikeJavaScript(entryPath);
      if (match) {
        return match;
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const contents = await readFile(entryPath, 'utf8');
      if (tokenLikeHex.test(contents)) {
        return path.relative(distRoot, entryPath);
      }
    }
  }
  return null;
}

const matchedFile = await findTokenLikeJavaScript(distRoot);
if (matchedFile) {
  console.error(
    `Build artifact security check failed: token-like hexadecimal string found in ${matchedFile}.`,
  );
  process.exitCode = 1;
}
