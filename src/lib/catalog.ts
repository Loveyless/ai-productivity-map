import type { CategoryId, Tool } from '../data/catalog';

export interface FilterState {
  query: string;
  category: CategoryId | 'all' | string;
}

export function normalizeSearch(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, ' ');
}

function searchText(tool: Tool): string {
  return normalizeSearch([
    tool.name,
    tool.summary,
    tool.bestFor,
    ...tool.tags,
    ...tool.platforms,
  ].join(' '));
}

function matchesCategory(tool: Tool, category: FilterState['category']): boolean {
  return category === 'all' || tool.category === category;
}

function matchesTokens(tool: Tool, tokens: readonly string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const haystack = searchText(tool);
  return tokens.every((token) => haystack.includes(token));
}

export function filterTools(
  catalog: readonly Tool[],
  state: FilterState,
): Tool[] {
  const query = normalizeSearch(state.query);
  const tokens = query ? query.split(' ') : [];
  const knownCategories = new Set(catalog.map((tool) => tool.category));

  if (state.category !== 'all' && !knownCategories.has(state.category as CategoryId)) {
    return [];
  }

  return catalog.filter((tool) =>
    matchesCategory(tool, state.category) && matchesTokens(tool, tokens));
}
