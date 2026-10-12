import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Baranchik Sound branding', () => {
  it('uses the requested npm package identity', () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(
      readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'),
    );
    expect(packageJson.name).toBe('baranchik_sound');
    expect(packageJson.description).toBe('Музика та автоматичне оповіщення про тривогу');
    expect(packageJson.private).toBe(true);
    expect(packageJson.scripts['make-icons']).toBe('node scripts/make-icons.mjs');
    expect(packageLock.name).toBe('baranchik_sound');
    expect(packageLock.packages[''].devDependencies.sharp).toBe(packageJson.devDependencies.sharp);
  });

  it('declares the application name and iOS metadata in index.html', () => {
    const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    expect(html).toContain('<html lang="uk">');
    expect(html).toContain('<title>Baranchik Sound</title>');
    expect(html).toContain(
      '<meta name="description" content="Музика та автоматичне оповіщення про тривогу" />',
    );
    expect(html).toContain('<meta name="application-name" content="Baranchik Sound" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Baranchik Sound" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    );
    expect(html).toContain('<meta name="theme-color" content="#691817" />');
    expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest" />');
    expect(html).toContain('href="%BASE_URL%styles.css?v=baranchik-header-5"');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="./icons/favicon.svg" />');
    expect(html).toContain(
      '<link rel="icon" type="image/png" sizes="32x32" href="./icons/favicon-32.png" />',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="./icons/apple-touch-icon.png" />',
    );
  });

  it('declares app manifest metadata and both required icons', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(projectRoot, 'public/manifest.webmanifest'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      name: 'Baranchik Sound',
      short_name: 'Baranchik',
      description: 'Музика та автоматичне оповіщення про тривогу',
      start_url: '.',
      display: 'standalone',
      theme_color: '#691817',
      background_color: '#f6f1ee',
      lang: 'uk',
    });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
  });

  it('ships every generated icon PNG at its target dimensions', async () => {
    const icons = [
      ['apple-touch-icon.png', 180],
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['favicon-32.png', 32],
      ['favicon-16.png', 16],
    ];

    for (const [name, size] of icons) {
      const filePath = path.join(projectRoot, 'public/icons', name);
      expect(statSync(filePath).isFile()).toBe(true);
      const metadata = await sharp(filePath).metadata();
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    }
  });
});
