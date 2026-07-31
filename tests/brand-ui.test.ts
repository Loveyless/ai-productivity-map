import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { categories } from '../src/data/catalog';

const pagePath = new URL('../src/pages/index.astro', import.meta.url);
const stylesPath = new URL('../src/styles/global.css', import.meta.url);

describe('tool card brand presentation', () => {
  it('does not map categories to card colors', async () => {
    const [page, styles] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(stylesPath, 'utf8'),
    ]);

    expect(page).not.toContain('data-tone');
    expect(styles).not.toContain('--tone');
    for (const category of categories) {
      expect(styles).not.toContain(`[data-tone="${category.id}"]`);
    }
  });

  it('uses verified per-tool colors and base-aware local icons with a fixed fallback', async () => {
    const page = await readFile(pagePath, 'utf8');

    expect(page).toContain('tool.brandThemeColor');
    expect(page).toContain('--brand-color');
    expect(page).toContain('tool.brandIconPath');
    expect(page).toMatch(/BASE_URL|\bbase\b/);
    expect(page).toContain('class="tool-icon"');
    expect(page).toContain('loading="lazy"');
    expect(page).toContain('decoding="async"');
    expect(page).toContain('alt=""');
    expect(page).toContain('class="tool-initials"');
  });

  it('keeps cards compact without dropping the desktop grid or official-link touch target', async () => {
    const styles = await readFile(stylesPath, 'utf8');
    const summaryRule = styles.match(/\.tool-summary\s*\{([^}]*)\}/)?.[1] ?? '';
    const bestForRule = styles.match(/\.best-for\s*\{([^}]*)\}/)?.[1] ?? '';
    const officialLinkRule = styles.match(/\.tool-footer a\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(summaryRule).not.toContain('min-height');
    expect(bestForRule).not.toContain('min-height');
    expect(officialLinkRule).toContain('min-height: 2.75rem');
  });

  it('uses valid search and status semantics and an accessible placeholder color', async () => {
    const [page, styles] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(stylesPath, 'utf8'),
    ]);
    expect(page).toContain('role="search"');
    expect(page).not.toMatch(/<form[^>]*class="search-box"/);
    expect(page).toMatch(/class="status-flags"[^>]*role="group"/);
    expect(styles).toContain('color: #64736e');
  });
});
