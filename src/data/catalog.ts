import catalogSource from './catalog.json';

export type CategoryId =
  | 'chat-search'
  | 'writing-docs'
  | 'coding-development'
  | 'image-design'
  | 'video'
  | 'audio-music'
  | 'presentations-office'
  | 'research-knowledge'
  | 'automation-agents'
  | 'model-apis'
  | 'local-open-source';

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
}

export interface Tool {
  id: string;
  name: string;
  summary: string;
  bestFor: string;
  category: CategoryId;
  tags: string[];
  url: string;
  access: string;
  platforms: string[];
  openSource: boolean;
  local: boolean;
  reviewedAt: string;
}

interface CatalogSource {
  reviewedAt: string;
  categories: Category[];
  tools: Tool[];
}

const catalog = catalogSource as CatalogSource;

export const reviewedAt = catalog.reviewedAt;
export const categories = catalog.categories;
export const tools = catalog.tools;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

export function validateCatalog(
  records: readonly unknown[],
  declaredCategories: readonly unknown[],
): string[] {
  const errors: string[] = [];
  const categoryIds = new Set<string>();

  declaredCategories.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`category[${index}] must be an object`);
      return;
    }

    for (const field of ['id', 'label', 'description']) {
      if (!isNonEmptyString(candidate[field])) {
        errors.push(`category[${index}].${field} must be a non-empty string`);
      }
    }

    if (isNonEmptyString(candidate.id)) {
      if (categoryIds.has(candidate.id)) {
        errors.push(`category id "${candidate.id}" must be unique`);
      }
      categoryIds.add(candidate.id);
    }
  });

  const toolIds = new Set<string>();
  const urls = new Set<string>();

  records.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`tool[${index}] must be an object`);
      return;
    }

    for (const field of ['id', 'name', 'summary', 'bestFor', 'access']) {
      if (!isNonEmptyString(candidate[field])) {
        errors.push(`tool[${index}].${field} must be a non-empty string`);
      }
    }

    if (!isStringList(candidate.tags)) {
      errors.push(`tool[${index}].tags must be a non-empty string array`);
    }
    if (!isStringList(candidate.platforms)) {
      errors.push(`tool[${index}].platforms must be a non-empty string array`);
    }
    if (typeof candidate.openSource !== 'boolean') {
      errors.push(`tool[${index}].openSource must be boolean`);
    }
    if (typeof candidate.local !== 'boolean') {
      errors.push(`tool[${index}].local must be boolean`);
    }
    if (!isNonEmptyString(candidate.reviewedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.reviewedAt)) {
      errors.push(`tool[${index}].reviewedAt must use YYYY-MM-DD`);
    }
    if (!isNonEmptyString(candidate.category) || !categoryIds.has(candidate.category)) {
      errors.push(`tool[${index}].category must reference a declared category`);
    }

    if (!isNonEmptyString(candidate.url) || !candidate.url.startsWith('https://')) {
      errors.push(`tool[${index}].url must be an official HTTPS URL`);
    }

    if (isNonEmptyString(candidate.id)) {
      if (toolIds.has(candidate.id)) {
        errors.push(`tool id "${candidate.id}" must be unique`);
      }
      toolIds.add(candidate.id);
    }
    if (isNonEmptyString(candidate.url)) {
      if (urls.has(candidate.url)) {
        errors.push(`tool URL "${candidate.url}" must be unique`);
      }
      urls.add(candidate.url);
    }
  });

  return errors;
}
