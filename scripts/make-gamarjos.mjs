import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(projectRoot, 'public');

async function listAudioFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listAudioFiles(entryPath)));
    } else if (
      entry.isFile() &&
      ['.mp3', '.m4a', '.wav'].includes(path.extname(entry.name).toLowerCase())
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

function encodePublicPath(filePath) {
  return path
    .relative(publicRoot, filePath)
    .split(path.sep)
    .map((segment) => encodeURI(segment))
    .join('/');
}

const directory = path.join(publicRoot, 'gamarjos');
const files = await listAudioFiles(directory);
files.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
const manifest = files.map((filePath) => ({
  src: encodePublicPath(filePath),
  title: path.basename(filePath, path.extname(filePath)),
}));

await writeFile(
  path.join(publicRoot, 'gamarjos.json'),
  `${JSON.stringify({ files: manifest }, null, 2)}\n`,
);
