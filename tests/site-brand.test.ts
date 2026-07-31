import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const publicUrl = new URL('../public/', import.meta.url);
const layoutUrl = new URL('../src/layouts/Layout.astro', import.meta.url);
const pageUrl = new URL('../src/pages/index.astro', import.meta.url);

describe('site brand assets', () => {
  it.each([
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
  ] as const)('ships a decodable %s at the expected dimensions', async (filename, size) => {
    const bytes = await readFile(new URL(filename, publicUrl));
    const metadata = await sharp(bytes).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(size);
    expect(metadata.height).toBe(size);
  });

  it('uses the same local vector identity for the SVG favicon and header mark', async () => {
    const [svg, layout, page] = await Promise.all([
      readFile(new URL('favicon.svg', publicUrl), 'utf8'),
      readFile(layoutUrl, 'utf8'),
      readFile(pageUrl, 'utf8'),
    ]);

    expect(svg).toContain('<svg');
    expect(svg).toMatch(/<rect[^>]+fill="#(?:1[0-9A-Fa-f]{5}|2[0-9A-Fa-f]{5})"/);
    expect((svg.match(/<circle\b/g) ?? [])).toHaveLength(4);
    expect(layout).toContain("withBasePath(base, 'favicon.svg')");
    expect(layout).toContain("withBasePath(base, 'favicon-32.png')");
    expect(layout).toContain("withBasePath(base, 'apple-touch-icon.png')");
    expect(page).toContain("withBasePath(base, 'favicon.svg')");
    expect(page).toMatch(/<img[\s\S]+class="brand-mark"[\s\S]+width="40"[\s\S]+height="40"[\s\S]+alt=""/);
  });
});
