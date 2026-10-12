import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const violations = [
  { label: 'optional chaining', pattern: /\?\./ },
  { label: 'Array.flat/flatMap', pattern: /\.flat(?:Map)?\s*\(/ },
  { label: 'String.replaceAll', pattern: /\.replaceAll\s*\(/ },
  { label: 'String.matchAll', pattern: /\.matchAll\s*\(/ },
  { label: 'Object.fromEntries', pattern: /Object\.fromEntries\s*\(/ },
  { label: 'globalThis without an explicit polyfill', pattern: /\bglobalThis\b/ },
  {
    label: 'Service Worker, Push, or Notifications API',
    pattern: /\b(?:serviceWorker|ServiceWorker\w*|PushManager|PushSubscription|Notification)\b/i,
  },
  { label: 'CSS gap property', pattern: /(?:^|[;{])\s*gap\s*:/i, extensions: ['.css'] },
  {
    label: 'CSS clamp/min/max function',
    pattern: /\b(?:clamp|min|max)\s*\(/i,
    extensions: ['.css'],
  },
  {
    label: 'CSS aspect-ratio or inset property',
    pattern: /\b(?:aspect-ratio|inset)\s*:/i,
    extensions: ['.css'],
  },
  { label: 'CSS :is() or :where()', pattern: /:(?:is|where)\s*\(/i, extensions: ['.css'] },
  { label: 'CSS 100vh', pattern: /(?:^|[^\w.-])100vh\b/i, extensions: ['.css'] },
];

async function findBuiltFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findBuiltFiles(entryPath)));
    } else if (entry.isFile() && ['.js', '.css'].includes(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function findInlineStyles(contents) {
  const stylePattern = /\.textContent\s*=\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/g;
  const styles = [];
  let match = stylePattern.exec(contents);

  while (match) {
    styles.push({
      contents: match[2],
      firstLine: contents.slice(0, match.index).split('\n').length,
    });
    match = stylePattern.exec(contents);
  }

  return styles;
}

const files = await findBuiltFiles(distRoot);
const failures = [];

for (const filePath of files) {
  const contents = await readFile(filePath, 'utf8');
  const extension = path.extname(filePath);
  const isLegacyPolyfill = path.basename(filePath).startsWith('polyfills-legacy-');
  const lines = contents.split('\n');

  lines.forEach((line, index) => {
    for (const violation of violations) {
      if (violation.extensions) {
        continue;
      }
      if (violation.label === 'globalThis without an explicit polyfill' && isLegacyPolyfill) {
        continue;
      }
      if (violation.pattern.test(line)) {
        failures.push(`${path.relative(distRoot, filePath)}:${index + 1}: ${violation.label}`);
      }
    }
  });

  if (extension === '.js') {
    const sourceFile = ts.createSourceFile(
      filePath,
      contents,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const checkNullish = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          node.operatorToken.getStart(sourceFile),
        );
        failures.push(
          `${path.relative(distRoot, filePath)}:${position.line + 1}: nullish coalescing`,
        );
      }
      ts.forEachChild(node, checkNullish);
    };
    checkNullish(sourceFile);
  }

  const cssGroups =
    extension === '.css'
      ? [{ contents, firstLine: 1 }]
      : extension === '.js'
        ? findInlineStyles(contents)
        : [];

  for (const cssGroup of cssGroups) {
    cssGroup.contents.split('\n').forEach((line, index) => {
      for (const violation of violations) {
        if (violation.extensions && violation.pattern.test(line)) {
          failures.push(
            `${path.relative(distRoot, filePath)}:${cssGroup.firstLine + index}: ${violation.label}`,
          );
        }
      }
    });
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
