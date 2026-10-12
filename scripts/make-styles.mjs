import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const tokensPath = path.join(projectRoot, 'src/ui/tokens.css');
const stylesPath = path.join(projectRoot, 'src/ui/styles.css');
const outputPath = path.join(projectRoot, 'public/styles.css');

const tokens = await readFile(tokensPath, 'utf8');
const styles = (await readFile(stylesPath, 'utf8')).replace(
  /^\s*@import\s+['"]\.\/tokens\.css['"]\s*;\s*/,
  '',
);
const css = `${tokens.trim()}\n\n${styles.trim()}\n`.replace(
  /url\(\s*(['"]?)\/fonts\//g,
  'url($1./fonts/',
);

await writeFile(outputPath, css);
