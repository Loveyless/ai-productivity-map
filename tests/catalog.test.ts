import { describe, expect, it } from 'vitest';
import { categories, tools, validateCatalog } from '../src/data/catalog';

describe('catalog validation', () => {
  it('contains a high-signal curated set across every category', () => {
    expect(tools.length).toBeGreaterThanOrEqual(20);
    expect(new Set(tools.map((tool) => tool.category)).size).toBe(categories.length);
    expect(validateCatalog(tools, categories)).toEqual([]);
  });

  it('keeps category IDs integral and tool IDs and official URLs unique', () => {
    expect(new Set(categories.map((category) => category.id)).size).toBe(categories.length);
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    expect(new Set(tools.map((tool) => tool.url)).size).toBe(tools.length);
    expect(tools.every((tool) => tool.url.startsWith('https://'))).toBe(true);
  });

  it('pins Copilot cards to product-specific official evidence rather than generic company favicons', () => {
    const github = tools.find((tool) => tool.id === 'github-copilot');
    const microsoft = tools.find((tool) => tool.id === 'microsoft-365-copilot');
    expect(github?.brandIconSourceUrl).toBe('https://github.com/features/copilot');
    expect(microsoft?.brandIconSourceUrl).toBe('https://copilot.microsoft.com/favicon.ico');
  });

  it('reports malformed records and unknown categories', () => {
    const errors = validateCatalog(
      [{ ...tools[0], id: '', url: 'http://example.com', category: 'missing-category' }],
      categories,
    );
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('id'),
      expect.stringContaining('HTTPS'),
      expect.stringContaining('category'),
    ]));
  });

  it('rejects tool IDs that are not safe lowercase slugs', () => {
    for (const id of ['../../outside', '../chatgpt', 'ChatGPT', '-chatgpt', 'chatgpt_', 'a'.repeat(65)]) {
      const errors = validateCatalog([{ ...tools[0], id }], categories);
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('lowercase slug')]));
    }
  });

  it('accepts omitted, null, and fully evidenced optional brand fields', () => {
    const withoutBrandFields = { ...tools[0] } as Record<string, unknown>;
    for (const field of [
      'brandIconPath', 'brandIconMode', 'brandIconSourceUrl', 'brandIconSha256', 'brandIconReviewedAt',
      'brandThemeColor', 'brandThemeColorSourceUrl', 'brandThemeColorReviewedAt',
    ]) delete withoutBrandFields[field];
    const withNullBrandFields = {
      ...tools[0],
      brandIconPath: null,
      brandIconSourceUrl: null,
      brandIconSha256: null,
      brandIconReviewedAt: null,
      brandThemeColor: null,
      brandThemeColorSourceUrl: null,
      brandThemeColorReviewedAt: null,
    };
    const withVerifiedBrandFields = {
      ...tools[0],
      brandIconPath: `/icons/${tools[0].id}.png`,
      brandIconMode: 'manual',
      brandIconSourceUrl: 'https://chatgpt.com/favicon.ico',
      brandIconSha256: 'a'.repeat(64),
      brandIconReviewedAt: '2026-07-31',
      brandThemeColor: '#10A37F',
      brandThemeColorSourceUrl: 'https://chatgpt.com/',
      brandThemeColorReviewedAt: '2026-07-31',
    };

    expect(validateCatalog([withoutBrandFields], categories)).toEqual([]);
    expect(validateCatalog([withNullBrandFields], categories)).toEqual([]);
    expect(validateCatalog([withVerifiedBrandFields], categories)).toEqual([]);
  });

  it('rejects remote, traversing, and mismatched local icon paths', () => {
    for (const brandIconPath of [
      'https://chatgpt.com/favicon.png',
      '/icons/../favicon.png',
      '/icons/another-tool.png',
      '/assets/chatgpt.png',
    ]) {
      const errors = validateCatalog([{
        ...tools[0],
        brandIconPath,
        brandIconSourceUrl: 'https://chatgpt.com/favicon.png',
        brandIconSha256: 'a'.repeat(64),
        brandIconReviewedAt: '2026-07-31',
      }], categories);
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('brandIconPath')]));
    }
  });

  it('rejects invalid colors, evidence URLs, dates, and incomplete evidence', () => {
    const errors = validateCatalog([{
      ...tools[0],
      brandIconPath: `/icons/${tools[0].id}.png`,
      brandIconMode: 'automatic',
      brandIconSourceUrl: 'http://third-party.example/icon.png',
      brandIconSha256: 'not-a-digest',
      brandIconReviewedAt: '31-07-2026',
      brandThemeColor: 'rgb(16, 163, 127)',
      brandThemeColorSourceUrl: 'javascript:alert(1)',
      brandThemeColorReviewedAt: '31-07-2026',
    }], categories);

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('brandIconMode'),
      expect.stringContaining('brandIconSourceUrl'),
      expect.stringContaining('brandIconSha256'),
      expect.stringContaining('brandIconReviewedAt'),
      expect.stringContaining('brandThemeColor'),
      expect.stringContaining('brandThemeColorSourceUrl'),
      expect.stringContaining('brandThemeColorReviewedAt'),
    ]));

    const incomplete = validateCatalog([{
      ...tools[0],
      brandThemeColor: '#10A37F',
      brandThemeColorSourceUrl: null,
      brandThemeColorReviewedAt: null,
    }], categories);
    expect(incomplete).toEqual(expect.arrayContaining([
      expect.stringContaining('brandThemeColorSourceUrl'),
      expect.stringContaining('brandThemeColorReviewedAt'),
    ]));
  });
});
