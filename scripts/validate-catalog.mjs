#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateBrandAssets } from './lib/brand-validation.mjs';
import { requestPublicHttps } from './lib/public-network.mjs';

const catalogPath = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url));
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const checkLinks = process.argv.includes('--check-links');
const requiredCategoryIds = new Set([
  'chat-search',
  'writing-docs',
  'coding-development',
  'image-design',
  'video',
  'audio-music',
  'presentations-office',
  'research-knowledge',
  'automation-agents',
  'model-apis',
  'local-open-source',
]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const themeColorPattern = /^#[\dA-Fa-f]{6}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const toolIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isHttpsUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateCatalog(catalog) {
  const errors = [];

  if (!isObject(catalog)) return ['catalog root must be an object'];
  if (!datePattern.test(catalog.reviewedAt ?? '')) {
    errors.push('reviewedAt must use YYYY-MM-DD');
  }
  if (!Array.isArray(catalog.categories)) errors.push('categories must be an array');
  if (!Array.isArray(catalog.tools)) errors.push('tools must be an array');
  if (errors.length > 0) return errors;

  const categoryIds = new Set();
  catalog.categories.forEach((category, index) => {
    if (!isObject(category)) {
      errors.push(`category[${index}] must be an object`);
      return;
    }
    for (const field of ['id', 'label', 'description']) {
      if (!isNonEmptyString(category[field])) {
        errors.push(`category[${index}].${field} must be a non-empty string`);
      }
    }
    if (isNonEmptyString(category.id)) {
      if (categoryIds.has(category.id)) errors.push(`duplicate category id: ${category.id}`);
      categoryIds.add(category.id);
    }
  });

  for (const requiredId of requiredCategoryIds) {
    if (!categoryIds.has(requiredId)) errors.push(`missing required category: ${requiredId}`);
  }
  for (const categoryId of categoryIds) {
    if (!requiredCategoryIds.has(categoryId)) errors.push(`unknown category id: ${categoryId}`);
  }


  const ids = new Set();
  const urls = new Set();
  const coveredCategories = new Set();

  catalog.tools.forEach((tool, index) => {
    if (!isObject(tool)) {
      errors.push(`tool[${index}] must be an object`);
      return;
    }
    for (const field of ['id', 'name', 'summary', 'bestFor', 'category', 'url', 'access']) {
      if (!isNonEmptyString(tool[field])) {
        errors.push(`tool[${index}].${field} must be a non-empty string`);
      }
    }
    if (isNonEmptyString(tool.id) && (tool.id.length > 64 || !toolIdPattern.test(tool.id))) {
      errors.push(`tool[${index}].id must be a lowercase slug of at most 64 characters`);
    }
    if (!isStringList(tool.tags)) errors.push(`tool[${index}].tags must be a non-empty string array`);
    if (!isStringList(tool.platforms)) errors.push(`tool[${index}].platforms must be a non-empty string array`);
    if (typeof tool.openSource !== 'boolean') errors.push(`tool[${index}].openSource must be boolean`);
    if (typeof tool.local !== 'boolean') errors.push(`tool[${index}].local must be boolean`);
    if (!datePattern.test(tool.reviewedAt ?? '')) errors.push(`tool[${index}].reviewedAt must use YYYY-MM-DD`);

    if (isNonEmptyString(tool.category)) {
      if (!categoryIds.has(tool.category)) errors.push(`tool[${index}] references unknown category: ${tool.category}`);
      coveredCategories.add(tool.category);
    }
    if (isNonEmptyString(tool.id)) {
      if (ids.has(tool.id)) errors.push(`duplicate tool id: ${tool.id}`);
      ids.add(tool.id);
    }
    if (isNonEmptyString(tool.url)) {
      try {
        const parsed = new URL(tool.url);
        if (parsed.protocol !== 'https:') errors.push(`tool[${index}].url must use HTTPS: ${tool.url}`);
        if (parsed.username || parsed.password) errors.push(`tool[${index}].url must not contain credentials`);
      } catch {
        errors.push(`tool[${index}].url is invalid: ${tool.url}`);
      }
      if (urls.has(tool.url)) errors.push(`duplicate tool URL: ${tool.url}`);
      urls.add(tool.url);
    }

    const safeId = isNonEmptyString(tool.id) && tool.id.length <= 64 && toolIdPattern.test(tool.id);
    const iconPathPattern = safeId ? new RegExp(`^/icons/${tool.id}(?:-[a-f0-9]{12})?\\.png$`) : null;
    const hasIcon = isNonEmptyString(tool.brandIconPath) && iconPathPattern?.test(tool.brandIconPath) === true;
    const hasThemeColor = isNonEmptyString(tool.brandThemeColor) && themeColorPattern.test(tool.brandThemeColor);

    if (tool.brandIconPath !== undefined && tool.brandIconPath !== null && !hasIcon) {
      errors.push(`tool[${index}].brandIconPath must be an ID-bound local PNG path or null`);
    }
    if (tool.brandIconSourceUrl !== undefined && tool.brandIconSourceUrl !== null && !isHttpsUrl(tool.brandIconSourceUrl)) {
      errors.push(`tool[${index}].brandIconSourceUrl must be an HTTPS URL or null`);
    }
    if (tool.brandIconSha256 !== undefined && tool.brandIconSha256 !== null &&
      (!isNonEmptyString(tool.brandIconSha256) || !sha256Pattern.test(tool.brandIconSha256))) {
      errors.push(`tool[${index}].brandIconSha256 must be lowercase SHA-256 or null`);
    }
    if (tool.brandIconReviewedAt !== undefined && tool.brandIconReviewedAt !== null &&
      (!isNonEmptyString(tool.brandIconReviewedAt) || !datePattern.test(tool.brandIconReviewedAt))) {
      errors.push(`tool[${index}].brandIconReviewedAt must use YYYY-MM-DD or be null`);
    }
    if (tool.brandThemeColor !== undefined && tool.brandThemeColor !== null && !hasThemeColor) {
      errors.push(`tool[${index}].brandThemeColor must be six-digit CSS hex or null`);
    }
    if (tool.brandThemeColorSourceUrl !== undefined && tool.brandThemeColorSourceUrl !== null &&
      !isHttpsUrl(tool.brandThemeColorSourceUrl)) {
      errors.push(`tool[${index}].brandThemeColorSourceUrl must be an HTTPS URL or null`);
    }
    if (tool.brandThemeColorReviewedAt !== undefined && tool.brandThemeColorReviewedAt !== null &&
      (!isNonEmptyString(tool.brandThemeColorReviewedAt) || !datePattern.test(tool.brandThemeColorReviewedAt))) {
      errors.push(`tool[${index}].brandThemeColorReviewedAt must use YYYY-MM-DD or be null`);
    }
    if (hasIcon && !isHttpsUrl(tool.brandIconSourceUrl)) {
      errors.push(`tool[${index}].brandIconSourceUrl is required with brandIconPath`);
    }
    if (hasIcon && !sha256Pattern.test(tool.brandIconSha256 ?? '')) {
      errors.push(`tool[${index}].brandIconSha256 is required with brandIconPath`);
    }
    if (hasIcon && !datePattern.test(tool.brandIconReviewedAt ?? '')) {
      errors.push(`tool[${index}].brandIconReviewedAt is required with brandIconPath`);
    }
    if ((isHttpsUrl(tool.brandIconSourceUrl) || isNonEmptyString(tool.brandIconSha256) ||
      isNonEmptyString(tool.brandIconReviewedAt)) && !hasIcon) {
      errors.push(`tool[${index}].brandIconPath is required with icon evidence`);
    }
    if (hasThemeColor && !isHttpsUrl(tool.brandThemeColorSourceUrl)) {
      errors.push(`tool[${index}].brandThemeColorSourceUrl is required with brandThemeColor`);
    }
    if (hasThemeColor && !datePattern.test(tool.brandThemeColorReviewedAt ?? '')) {
      errors.push(`tool[${index}].brandThemeColorReviewedAt is required with brandThemeColor`);
    }
    if ((isHttpsUrl(tool.brandThemeColorSourceUrl) || isNonEmptyString(tool.brandThemeColorReviewedAt)) &&
      !hasThemeColor) {
      errors.push(`tool[${index}].brandThemeColor is required with theme-color evidence`);
    }
  });

  for (const categoryId of categoryIds) {
    if (!coveredCategories.has(categoryId)) errors.push(`category has no tools: ${categoryId}`);
  }

  return errors;
}

async function fetchStatus(url, method) {
  const response = await requestPublicHttps(url, {
    method,
    readBody: false,
    timeoutMs: 12_000,
    headers: {
      'user-agent': method === 'GET'
        ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
        : 'AI-Productivity-Map-Link-Checker/1.0 (+https://github.com/Loveyless/ai-productivity-map)',
    },
  });
  return response.status;
}

async function inspectLink(tool) {
  try {
    let status = await fetchStatus(tool.url, 'HEAD');
    if (status >= 400) status = await fetchStatus(tool.url, 'GET');

    if (status >= 200 && status < 400) {
      return { level: 'ok', tool, detail: `HTTP ${status}` };
    }
    if ([401, 403, 408, 425, 429].includes(status) || status >= 500) {
      return { level: 'warn', tool, detail: `HTTP ${status}; reachable status is inconclusive` };
    }
    if (status === 404 || status === 410) {
      return { level: 'fail', tool, detail: `HTTP ${status}; official link appears unavailable` };
    }
    return { level: 'fail', tool, detail: `HTTP ${status}` };
  } catch (error) {
    const code = error?.cause?.code;
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
      return { level: 'fail', tool, detail: code };
    }
    return { level: 'warn', tool, detail: `${error?.name ?? 'NetworkError'}; check manually` };
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const source = await readFile(catalogPath, 'utf8');
let catalog;
try {
  catalog = JSON.parse(source);
} catch (error) {
  console.error(`Catalog JSON is invalid: ${error.message}`);
  process.exitCode = 1;
  process.exit();
}

const errors = validateCatalog(catalog);
if (Array.isArray(catalog.tools)) {
  errors.push(...await validateBrandAssets(catalog.tools, publicDirectory));
}
if (errors.length > 0) {
  console.error(`Catalog validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
  process.exit();
}

const localIconCount = catalog.tools.filter((tool) => typeof tool.brandIconPath === 'string').length;
console.log(`Catalog OK: ${catalog.tools.length} tools across ${catalog.categories.length} categories; ${localIconCount} local brand icon(s) verified offline.`);

if (!checkLinks) {
  console.log('Link checks skipped. Pass --check-links to enable network checks.');
  process.exit();
}

console.log(`Checking ${catalog.tools.length} official links (concurrency: 4)...`);
const results = await mapWithConcurrency(catalog.tools, 4, inspectLink);
for (const result of results) {
  console.log(`[${result.level.toUpperCase()}] ${result.tool.name}: ${result.detail} - ${result.tool.url}`);
}

const failures = results.filter((result) => result.level === 'fail');
const warnings = results.filter((result) => result.level === 'warn');
console.log(`Link check complete: ${results.length - failures.length - warnings.length} ok, ${warnings.length} warning(s), ${failures.length} failure(s).`);
if (failures.length > 0) process.exitCode = 1;
