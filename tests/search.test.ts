import { describe, expect, it } from 'vitest';
import { categories, tools } from '../src/data/catalog';
import { filterTools, normalizeSearch, type FilterState } from '../src/lib/catalog';

describe('search normalization', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeSearch('  ChatGPT  ')).toBe('chatgpt');
    expect(normalizeSearch('图像   设计')).toBe('图像 设计');
  });

  it('handles empty and non-string input safely', () => {
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch('   ')).toBe('');
    expect(normalizeSearch(null)).toBe('');
    expect(normalizeSearch(undefined)).toBe('');
  });
});

describe('catalog filtering', () => {
  const all: FilterState = { query: '', category: 'all' };

  it('returns all tools for the all/reset state', () => {
    expect(filterTools(tools, all)).toEqual(tools);
    expect(filterTools(tools, { query: '   ', category: 'all' })).toEqual(tools);
  });

  it('matches names, summaries, best-use text, and tags case-insensitively', () => {
    expect(filterTools(tools, { query: 'CHATGPT', category: 'all' }).map((tool) => tool.id)).toContain('chatgpt');
    expect(filterTools(tools, { query: '工作流', category: 'all' }).length).toBeGreaterThan(0);
    expect(filterTools(tools, { query: 'automation', category: 'all' }).length).toBeGreaterThan(0);
  });

  it('combines text search and category filters', () => {
    const coding = filterTools(tools, { query: '代码', category: 'coding-development' });
    expect(coding.length).toBeGreaterThan(0);
    expect(coding.every((tool) => tool.category === 'coding-development')).toBe(true);

    const imageCode = filterTools(tools, { query: '代码', category: 'image-design' });
    expect(imageCode.map((tool) => tool.id)).toContain('google-stitch');
    expect(imageCode.every((tool) => tool.category === 'image-design')).toBe(true);
    expect(imageCode.every((tool) => JSON.stringify(tool).includes('代码'))).toBe(true);
  });

  it('returns an empty result for an unknown category instead of broadening the query', () => {
    expect(filterTools(tools, { query: '', category: 'not-a-category' })).toEqual([]);
  });

  it('accepts every declared category as a valid filter', () => {
    for (const category of categories) {
      expect(filterTools(tools, { query: '', category: category.id }).length).toBeGreaterThan(0);
    }
  });
});
