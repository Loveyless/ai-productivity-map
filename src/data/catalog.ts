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
  /** Stable local PNG path generated from official product metadata. */
  brandIconPath?: string | null;
  /** Exact official icon URL used to generate brandIconPath. */
  brandIconSourceUrl?: string | null;
  /** SHA-256 of the exact local PNG bytes. */
  brandIconSha256?: string | null;
  /** Date on which the icon bytes and source were reviewed. */
  brandIconReviewedAt?: string | null;
  /** Official opaque theme color, normalized to six-digit CSS hex. */
  brandThemeColor?: string | null;
  /** Official page or manifest URL that declared brandThemeColor. */
  brandThemeColorSourceUrl?: string | null;
  /** Date on which the theme-color evidence was reviewed. */
  brandThemeColorReviewedAt?: string | null;
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

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const themeColorPattern = /^#[\dA-Fa-f]{6}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const toolIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

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
    if (isNonEmptyString(candidate.id) &&
      (candidate.id.length > 64 || !toolIdPattern.test(candidate.id))) {
      errors.push(`tool[${index}].id must be a lowercase slug of at most 64 characters`);
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
    if (!isNonEmptyString(candidate.reviewedAt) || !datePattern.test(candidate.reviewedAt)) {
      errors.push(`tool[${index}].reviewedAt must use YYYY-MM-DD`);
    }
    if (!isNonEmptyString(candidate.category) || !categoryIds.has(candidate.category)) {
      errors.push(`tool[${index}].category must reference a declared category`);
    }

    if (!isNonEmptyString(candidate.url) || !candidate.url.startsWith('https://')) {
      errors.push(`tool[${index}].url must be an official HTTPS URL`);
    }

    const iconPath = candidate.brandIconPath;
    const iconSource = candidate.brandIconSourceUrl;
    const iconSha256 = candidate.brandIconSha256;
    const iconReviewedAt = candidate.brandIconReviewedAt;
    const themeColor = candidate.brandThemeColor;
    const themeColorSource = candidate.brandThemeColorSourceUrl;
    const themeColorReviewedAt = candidate.brandThemeColorReviewedAt;
    const safeId = isNonEmptyString(candidate.id) && candidate.id.length <= 64 && toolIdPattern.test(candidate.id);
    const iconPathPattern = safeId
      ? new RegExp(`^/icons/${candidate.id}(?:-[a-f0-9]{12})?\\.png$`)
      : null;
    const hasIcon = isNonEmptyString(iconPath) && iconPathPattern?.test(iconPath) === true;
    const hasThemeColor = isNonEmptyString(themeColor) && themeColorPattern.test(themeColor);

    if (iconPath !== undefined && iconPath !== null && !hasIcon) {
      errors.push(`tool[${index}].brandIconPath must be an ID-bound local PNG path or null`);
    }
    if (iconSource !== undefined && iconSource !== null && !isHttpsUrl(iconSource)) {
      errors.push(`tool[${index}].brandIconSourceUrl must be an HTTPS URL or null`);
    }
    if (iconSha256 !== undefined && iconSha256 !== null &&
      (!isNonEmptyString(iconSha256) || !sha256Pattern.test(iconSha256))) {
      errors.push(`tool[${index}].brandIconSha256 must be lowercase SHA-256 or null`);
    }
    if (iconReviewedAt !== undefined && iconReviewedAt !== null &&
      (!isNonEmptyString(iconReviewedAt) || !datePattern.test(iconReviewedAt))) {
      errors.push(`tool[${index}].brandIconReviewedAt must use YYYY-MM-DD or be null`);
    }
    if (themeColor !== undefined && themeColor !== null &&
      (!isNonEmptyString(themeColor) || !themeColorPattern.test(themeColor))) {
      errors.push(`tool[${index}].brandThemeColor must be six-digit CSS hex or null`);
    }
    if (themeColorSource !== undefined && themeColorSource !== null && !isHttpsUrl(themeColorSource)) {
      errors.push(`tool[${index}].brandThemeColorSourceUrl must be an HTTPS URL or null`);
    }
    if (themeColorReviewedAt !== undefined && themeColorReviewedAt !== null &&
      (!isNonEmptyString(themeColorReviewedAt) || !datePattern.test(themeColorReviewedAt))) {
      errors.push(`tool[${index}].brandThemeColorReviewedAt must use YYYY-MM-DD or be null`);
    }

    if (hasIcon && !isHttpsUrl(iconSource)) {
      errors.push(`tool[${index}].brandIconSourceUrl is required with brandIconPath`);
    }
    if (hasIcon && (!isNonEmptyString(iconSha256) || !sha256Pattern.test(iconSha256))) {
      errors.push(`tool[${index}].brandIconSha256 is required with brandIconPath`);
    }
    if (hasIcon && (!isNonEmptyString(iconReviewedAt) || !datePattern.test(iconReviewedAt))) {
      errors.push(`tool[${index}].brandIconReviewedAt is required with brandIconPath`);
    }
    if ((isHttpsUrl(iconSource) || isNonEmptyString(iconSha256) || isNonEmptyString(iconReviewedAt)) && !hasIcon) {
      errors.push(`tool[${index}].brandIconPath is required with icon evidence`);
    }
    if (hasThemeColor && !isHttpsUrl(themeColorSource)) {
      errors.push(`tool[${index}].brandThemeColorSourceUrl is required with brandThemeColor`);
    }
    if (hasThemeColor && (!isNonEmptyString(themeColorReviewedAt) || !datePattern.test(themeColorReviewedAt))) {
      errors.push(`tool[${index}].brandThemeColorReviewedAt is required with brandThemeColor`);
    }
    if ((isHttpsUrl(themeColorSource) || isNonEmptyString(themeColorReviewedAt)) && !hasThemeColor) {
      errors.push(`tool[${index}].brandThemeColor is required with theme-color evidence`);
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
