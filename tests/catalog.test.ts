import { describe, expect, it } from 'vitest';
import { categories, tools, validateCatalog } from '../src/data/catalog';

describe('catalog validation', () => {
  it('contains a modest, high-signal starter set across every category', () => {
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
});
