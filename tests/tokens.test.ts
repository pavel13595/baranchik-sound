import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
const venue = JSON.parse(
  readFileSync(new URL('../public/venue.json', import.meta.url), 'utf8'),
) as {
  venueName: string;
  tagline?: string;
};

function tokenColor(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!match) throw new Error(`Missing color token: ${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('brand design tokens', () => {
  it('keeps the required text and brand colors centralized', () => {
    expect(tokens).toMatch(/--brand:\s*#691817/i);
    expect(tokens).toMatch(/--text:\s*#000000/i);
  });

  it('uses the requested venue name and optional Georgian restaurant tagline', () => {
    expect(venue.venueName).toBe('Той самий Баранчик');
    expect(venue.tagline).toBe('Ресторан грузинського застілля 🇺🇦 🇬🇪');
  });

  it('keeps specified text and functional button pairs at WCAG AA contrast', () => {
    const pairs: Array<[string, string]> = [
      ['text', 'page-fallback'],
      ['text-muted', 'surface-solid'],
      ['on-brand', 'brand'],
      ['on-brand', 'brand-dark'],
      ['on-brand', 'signal-red'],
      ['text', 'signal-yellow'],
      ['text', 'signal-neutral'],
      ['color-alert-quiet', 'color-alert-quiet-bg'],
      ['color-alert-yellow', 'color-alert-yellow-bg'],
      ['color-alert-red', 'color-alert-red-bg'],
      ['color-alert-unknown', 'color-alert-unknown-bg'],
      ['color-alert-stale', 'color-alert-stale-bg'],
    ];

    pairs.forEach(([foreground, background]) => {
      expect(
        contrast(tokenColor(foreground), tokenColor(background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });
});
