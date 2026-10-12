import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDirectory = path.join(projectRoot, 'public/icons');
const masterIcon = await readFile(path.join(iconsDirectory, 'icon.svg'));
const favicon = await readFile(path.join(iconsDirectory, 'favicon.svg'));

await mkdir(iconsDirectory, { recursive: true });

const icons = [
  { source: masterIcon, size: 180, name: 'apple-touch-icon.png' },
  { source: masterIcon, size: 192, name: 'icon-192.png' },
  { source: masterIcon, size: 512, name: 'icon-512.png' },
  { source: favicon, size: 32, name: 'favicon-32.png' },
  { source: favicon, size: 16, name: 'favicon-16.png' },
];

for (const icon of icons) {
  await sharp(icon.source)
    .resize(icon.size, icon.size)
    .png()
    .toFile(path.join(iconsDirectory, icon.name));
  console.log(`Generated public/icons/${icon.name}`);
}
