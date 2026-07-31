#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits, modify } from 'jsonc-parser';
import {
  officialOriginFaviconUrl,
  parseHtmlMetadata,
  parseWebManifest,
  resolveMetadataUrl,
} from './lib/brand-metadata.mjs';
import {
  acquireSingleWriterLock,
  assertCatalogUnchanged,
  assertSafeToolId,
  contentAddressedIconPath,
  sha256Hex,
  syncDirectory,
  writeImmutableFile,
} from './lib/brand-publication.mjs';
import {
  dateInTimeZone,
  iconSourceForVerifiedBytes,
  manualIconLocalEvidenceWarning,
  manualIconSourceNeedsFetch,
  parseSyncArguments,
  selectToolsForSync,
  shouldFailBrandCheck,
  shouldFetchBrandIcon,
} from './lib/brand-sync.mjs';
import { rasterizeIconWithTimeout } from './lib/icon-rasterization.mjs';
import { requestPublicHttps } from './lib/public-network.mjs';

const catalogPath = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url));
const iconDirectory = fileURLToPath(new URL('../public/icons/', import.meta.url));
const USER_AGENT = 'AI-Productivity-Map-Brand-Sync/1.0 (+https://github.com/Loveyless/ai-productivity-map)';
const REQUEST_TIMEOUT_MS = 12_000;
const TOOL_DEADLINE_MS = 45_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_ICON_ATTEMPTS = 12;
const CONCURRENCY = 4;
const BRAND_FIELDS = [
  'brandIconPath',
  'brandIconSourceUrl',
  'brandIconSha256',
  'brandIconReviewedAt',
  'brandThemeColor',
  'brandThemeColorSourceUrl',
  'brandThemeColorReviewedAt',
];
const formattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' };

function usage() {
  console.log(`Usage: npm run sync:brands -- [options]

Options:
  --all             Inspect every catalog tool without replacing verified values
  --refresh         Inspect every tool and refresh verified values when sources succeed
  --id <id[,id]>    Inspect one or more tool IDs (repeatable)
  --dry-run         Fetch and compare without writing files or catalog data
  --check           Refresh all tools in dry-run mode; fail if verified content would change
  --help            Show this help`);
}

function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function mediaType(contentType) {
  return String(contentType ?? '').split(';', 1)[0].trim().toLowerCase();
}

function remainingTimeout(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`tool inspection exceeded ${TOOL_DEADLINE_MS / 1000}s deadline`);
  return Math.min(REQUEST_TIMEOUT_MS, remaining);
}

function approvedHostsForTool(tool) {
  const hosts = new Set();
  for (const candidate of [tool.url, tool.brandIconSourceUrl, tool.brandThemeColorSourceUrl]) {
    if (!candidate) continue;
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      hosts.add(host);
      if (host.startsWith('www.')) hosts.add(host.slice(4));
      else if (host.split('.').length === 2) hosts.add(`www.${host}`);
    } catch {
      // Catalog validation reports malformed evidence URLs before publication.
    }
  }
  return hosts;
}

async function fetchLimited(url, { accept, acceptsType, maxBytes, deadline, approvedHosts }) {
  let response;
  try {
    response = await requestPublicHttps(url, {
      headers: { accept, 'user-agent': USER_AGENT },
      maxBytes,
      maxRedirects: MAX_REDIRECTS,
      timeoutMs: remainingTimeout(deadline),
      normalizeUrl: (candidate, baseUrl) => resolveMetadataUrl(candidate, baseUrl, approvedHosts),
      isUrlAllowed: (candidate) => approvedHosts.has(candidate.hostname.toLowerCase()),
    });
  } catch (error) {
    const detail = error?.message ?? error?.name ?? 'network error';
    throw new Error(`${detail}${error?.cause?.code ? ` (${error.cause.code})` : ''}`);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  const type = mediaType(headerValue(response.headers, 'content-type'));
  if (!acceptsType(type)) throw new Error(`unexpected content type ${type || '(missing)'}`);
  return { body: response.body, type, url: response.url };
}

async function inspectManualIconSource(tool, page, deadline, approvedHosts, warnings) {
  if (tool.brandIconMode !== 'manual' || !tool.brandIconPath) return;
  if (!tool.brandIconSourceUrl) {
    warnings.push('manual icon source is missing');
    return;
  }
  if (!manualIconSourceNeedsFetch(tool, page.url)) return;

  try {
    const sourcePath = new URL(tool.brandIconSourceUrl).pathname.toLowerCase();
    const expectsImage = /\.(?:png|jpe?g|webp|avif|gif|ico)$/.test(sourcePath);
    const source = await fetchLimited(tool.brandIconSourceUrl, {
      accept: expectsImage
        ? 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/x-icon,image/vnd.microsoft.icon'
        : 'text/html,application/xhtml+xml;q=0.9',
      acceptsType: (type) => expectsImage
        ? /^image\/(?:png|jpe?g|webp|avif|gif|x-icon|vnd\.microsoft\.icon)$/.test(type)
        : type === 'text/html' || type === 'application/xhtml+xml',
      maxBytes: expectsImage ? MAX_IMAGE_BYTES : MAX_HTML_BYTES,
      deadline,
      approvedHosts,
    });
    if (expectsImage) {
      const rasterized = await rasterizeIconWithTimeout(source.body, remainingTimeout(deadline));
      if (sha256Hex(rasterized) !== tool.brandIconSha256) {
        warnings.push('manual icon source bytes do not match catalog SHA-256');
      }
    }
  } catch (error) {
    warnings.push(`manual icon source: ${error.message}`);
  }
}

async function inspectTool(tool, fetchIcon) {
  const deadline = Date.now() + TOOL_DEADLINE_MS;
  const approvedHosts = approvedHostsForTool(tool);
  const warnings = [];
  let page;
  try {
    page = await fetchLimited(tool.url, {
      accept: 'text/html,application/xhtml+xml;q=0.9',
      acceptsType: (type) => type === 'text/html' || type === 'application/xhtml+xml',
      maxBytes: MAX_HTML_BYTES,
      deadline,
      approvedHosts,
    });
  } catch (error) {
    return { tool, icon: null, themeColor: null, themeColorSourceUrl: null, warnings: [`official page: ${error.message}`] };
  }

  await inspectManualIconSource(tool, page, deadline, approvedHosts, warnings);
  const htmlMetadata = parseHtmlMetadata(page.body.toString('utf8'), page.url, approvedHosts);
  let manifestMetadata = { themeColor: null, themeColorSourceUrl: null, iconCandidates: [] };
  if (htmlMetadata.manifestUrl) {
    try {
      const manifest = await fetchLimited(htmlMetadata.manifestUrl, {
        accept: 'application/manifest+json,application/json,text/plain;q=0.8',
        acceptsType: (type) => ['application/manifest+json', 'application/json', 'text/json', 'text/plain'].includes(type),
        maxBytes: MAX_MANIFEST_BYTES,
        deadline,
        approvedHosts,
      });
      manifestMetadata = parseWebManifest(manifest.body.toString('utf8'), manifest.url, approvedHosts);
    } catch (error) {
      warnings.push(`manifest: ${error.message}`);
    }
  }

  const themeColor = htmlMetadata.themeColor ?? manifestMetadata.themeColor;
  const themeColorSourceUrl = htmlMetadata.themeColor
    ? htmlMetadata.themeColorSourceUrl
    : manifestMetadata.themeColorSourceUrl;
  let icon = null;

  if (fetchIcon) {
    const fallbackFavicon = officialOriginFaviconUrl(tool.url);
    const iconCandidates = [...htmlMetadata.iconCandidates, ...manifestMetadata.iconCandidates];
    if (fallbackFavicon) iconCandidates.push({ kind: 'origin-favicon', url: fallbackFavicon });

    const seen = new Set();
    const boundedCandidates = iconCandidates.filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    }).slice(0, MAX_ICON_ATTEMPTS);
    const iconFailures = [];
    for (const candidate of boundedCandidates) {
      try {
        const remoteIcon = await fetchLimited(candidate.url, {
          accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/x-icon,image/vnd.microsoft.icon',
          acceptsType: (type) => /^image\/(?:png|jpe?g|webp|avif|gif|x-icon|vnd\.microsoft\.icon)$/.test(type),
          maxBytes: MAX_IMAGE_BYTES,
          deadline,
          approvedHosts,
        });
        icon = {
          bytes: await rasterizeIconWithTimeout(remoteIcon.body, remainingTimeout(deadline)),
          sourceUrl: remoteIcon.url,
        };
        break;
      } catch (error) {
        iconFailures.push(`${candidate.kind} ${candidate.url.slice(0, 200)}: ${error.message}`);
      }
    }
    if (!icon && iconFailures.length > 0) {
      warnings.push(`icon unavailable (${iconFailures.slice(0, 3).join('; ')}${iconFailures.length > 3 ? '; …' : ''})`);
    }
    if (!icon && iconFailures.length === 0) warnings.push('icon unavailable (no official candidates)');
  }

  return { tool, icon, themeColor, themeColorSourceUrl, warnings };
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

function absoluteIconPath(toolId, localPath) {
  assertSafeToolId(toolId);
  const pattern = new RegExp(`^/icons/${toolId}(?:-[a-f0-9]{12})?\\.png$`);
  if (!pattern.test(localPath ?? '')) throw new Error(`${toolId}: unsafe brandIconPath`);
  const path = resolve(iconDirectory, basename(localPath));
  if (!path.startsWith(`${resolve(iconDirectory)}${sep}`)) throw new Error(`${toolId}: icon path escapes icon directory`);
  return path;
}

async function localIconMatchesEvidence(tool) {
  if (!tool.brandIconPath || !/^[a-f0-9]{64}$/.test(tool.brandIconSha256 ?? '')) return false;
  try {
    const path = absoluteIconPath(tool.id, tool.brandIconPath);
    const assetStat = await lstat(path);
    if (!assetStat.isFile() || assetStat.isSymbolicLink()) return false;
    return sha256Hex(await readFile(path)) === tool.brandIconSha256;
  } catch {
    return false;
  }
}

async function atomicWriteCatalog(path, contents, baseline) {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o644);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertCatalogUnchanged(path, baseline);
    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
    if (await readFile(path, 'utf8') !== contents) throw new Error('catalog readback did not match published content');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
}

function updateJsonSource(source, path, value) {
  return applyEdits(source, modify(source, path, value, { formattingOptions }));
}

let options;
try {
  options = parseSyncArguments(process.argv.slice(2));
} catch (error) {
  console.error(`Brand sync argument error: ${error.message}`);
  usage();
  process.exit(1);
}

if (options.help) {
  usage();
  process.exit();
}

const baselineCatalogSource = await readFile(catalogPath, 'utf8');
let updatedCatalogSource = baselineCatalogSource;
let catalog;
try {
  catalog = JSON.parse(baselineCatalogSource);
  if (!Array.isArray(catalog.tools)) throw new Error('tools must be an array');
  for (const tool of catalog.tools) {
    assertSafeToolId(tool.id);
    if (tool.brandIconPath) absoluteIconPath(tool.id, tool.brandIconPath);
  }
} catch (error) {
  console.error(`Catalog cannot be synchronized safely: ${error.message}`);
  process.exit(1);
}

const iconValidity = new Map();
await Promise.all(catalog.tools.map(async (tool) => {
  iconValidity.set(tool.id, await localIconMatchesEvidence(tool));
}));

let selectedTools;
try {
  selectedTools = selectToolsForSync(catalog.tools, options, (tool) => iconValidity.get(tool.id) === true);
} catch (error) {
  console.error(`Brand sync selection error: ${error.message}`);
  process.exit(1);
}

if (selectedTools.length === 0) {
  console.log('Brand sync: selected=0 changed=0 skipped=0 warnings=0. No missing or invalid local icons.');
  process.exit();
}

console.log(`Inspecting official metadata for ${selectedTools.length} tool(s), concurrency ${CONCURRENCY}${options.dryRun ? ' (dry-run)' : ''}...`);
const inspections = await mapWithConcurrency(selectedTools, CONCURRENCY, async (tool) => {
  const localValid = iconValidity.get(tool.id);
  const needsIcon = shouldFetchBrandIcon(tool, {
    refresh: options.refresh,
    localValid,
  });
  const inspection = await inspectTool(tool, needsIcon);
  const manualWarning = manualIconLocalEvidenceWarning(tool, localValid);
  if (manualWarning) inspection.warnings.push(manualWarning);
  return inspection;
});

const reviewedToday = dateInTimeZone();
const pendingIcons = [];
const changedToolIds = new Set();
const warnings = [];

for (const inspection of inspections) {
  const toolIndex = catalog.tools.findIndex((candidate) => candidate.id === inspection.tool.id);
  const tool = catalog.tools[toolIndex];
  const proposed = { ...tool };
  for (const field of BRAND_FIELDS) if (!(field in proposed)) proposed[field] = null;

  if (inspection.icon && (options.refresh || !tool.brandIconPath || iconValidity.get(tool.id) !== true)) {
    const digest = sha256Hex(inspection.icon.bytes);
    const currentBytesAreVerified = iconValidity.get(tool.id) === true;
    const sameVerifiedBytes = currentBytesAreVerified && tool.brandIconSha256 === digest;
    const localIconPath = sameVerifiedBytes
      ? tool.brandIconPath
      : contentAddressedIconPath(tool.id, inspection.icon.bytes);
    const iconSourceUrl = iconSourceForVerifiedBytes(tool, sameVerifiedBytes, inspection.icon.sourceUrl);
    if (!sameVerifiedBytes) {
      pendingIcons.push({ path: absoluteIconPath(tool.id, localIconPath), bytes: inspection.icon.bytes });
    }
    const iconEvidenceChanged = proposed.brandIconPath !== localIconPath ||
      proposed.brandIconSourceUrl !== iconSourceUrl || proposed.brandIconSha256 !== digest;
    proposed.brandIconPath = localIconPath;
    proposed.brandIconSourceUrl = iconSourceUrl;
    proposed.brandIconSha256 = digest;
    if (iconEvidenceChanged) proposed.brandIconReviewedAt = reviewedToday;
  }

  if (inspection.themeColor && (options.refresh || !tool.brandThemeColor)) {
    const themeEvidenceChanged = proposed.brandThemeColor !== inspection.themeColor ||
      proposed.brandThemeColorSourceUrl !== inspection.themeColorSourceUrl;
    proposed.brandThemeColor = inspection.themeColor;
    proposed.brandThemeColorSourceUrl = inspection.themeColorSourceUrl;
    if (themeEvidenceChanged) proposed.brandThemeColorReviewedAt = reviewedToday;
  }

  for (const field of BRAND_FIELDS) {
    if (tool[field] === proposed[field]) continue;
    updatedCatalogSource = updateJsonSource(updatedCatalogSource, ['tools', toolIndex, field], proposed[field]);
    tool[field] = proposed[field];
    changedToolIds.add(tool.id);
  }
  if (inspection.warnings.length > 0) warnings.push(`${tool.id}: ${inspection.warnings.join('; ')}`);
}

if (!options.dryRun && (changedToolIds.size > 0 || pendingIcons.length > 0)) {
  const releaseLock = await acquireSingleWriterLock(`${catalogPath}.brand-sync.lock`);
  try {
    await assertCatalogUnchanged(catalogPath, baselineCatalogSource);
    for (const icon of pendingIcons) await writeImmutableFile(icon.path, icon.bytes);
    if (changedToolIds.size > 0) {
      await atomicWriteCatalog(catalogPath, updatedCatalogSource, baselineCatalogSource);
    }
  } finally {
    await releaseLock();
  }
}

for (const warning of warnings) console.warn(`[WARN] ${warning}`);
const skipped = selectedTools.length - changedToolIds.size;
const inconclusive = warnings.length;
const verified = selectedTools.length - inconclusive;
const iconFallbacks = catalog.tools.filter((tool) => !tool.brandIconPath).length;
const colorFallbacks = catalog.tools.filter((tool) => !tool.brandThemeColor).length;
console.log(`Brand sync: selected=${selectedTools.length} verified=${verified} changed=${changedToolIds.size} skipped=${skipped} inconclusive=${inconclusive} icon-fallbacks=${iconFallbacks} color-fallbacks=${colorFallbacks}${options.dryRun ? ' dry-run=true' : ''}.`);

if (shouldFailBrandCheck(options, { changed: changedToolIds.size, inconclusive })) process.exitCode = 1;
