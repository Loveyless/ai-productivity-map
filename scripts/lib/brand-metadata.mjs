import { Parser } from 'htmlparser2';

const DISALLOWED_ICON_HOSTS = [
  'clearbit.com',
  'iconify.design',
  'simpleicons.org',
  'wikipedia.org',
  'wikimedia.org',
];
export const MAX_ICON_CANDIDATES = 12;
const MAX_RAW_ICONS_PER_CLASS = 24;
const MAX_THEME_CANDIDATES = 8;

function isDisallowedMetadataUrl(url) {
  const host = url.hostname.toLowerCase();
  if (DISALLOWED_ICON_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return true;
  }
  if (host === 'avatars.githubusercontent.com') return true;
  return (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.startsWith('/s2/favicons');
}

function approvedHostSet(baseUrl, approvedHosts) {
  if (approvedHosts !== undefined) {
    return new Set([...approvedHosts].map((host) => String(host).toLowerCase()));
  }
  try {
    return new Set([new URL(baseUrl).hostname.toLowerCase()]);
  } catch {
    return new Set();
  }
}

export function resolveMetadataUrl(candidate, baseUrl, approvedHosts) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  try {
    const url = new URL(candidate.trim(), baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || isDisallowedMetadataUrl(url) ||
      !approvedHostSet(baseUrl, approvedHosts).has(url.hostname.toLowerCase())) {
      return null;
    }
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function officialOriginFaviconUrl(productUrl) {
  try {
    const url = new URL(productUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return new URL('/favicon.ico', url.origin).href;
  } catch {
    return null;
  }
}

export function normalizeThemeColor(candidate) {
  if (typeof candidate !== 'string') return null;
  const value = candidate.trim();
  if (/^#[\dA-Fa-f]{3}$/.test(value)) {
    return `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join('')}`.toUpperCase();
  }
  return /^#[\dA-Fa-f]{6}$/.test(value) ? value.toUpperCase() : null;
}

function relTokens(attributes) {
  return (attributes.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function deduplicateIconCandidates(candidates) {
  const urls = new Set();
  return candidates.filter((candidate) => {
    if (urls.has(candidate.url)) return false;
    urls.add(candidate.url);
    return true;
  });
}

function iconSizeScore(sizes) {
  if (typeof sizes !== 'string') return 0;
  if (sizes.toLowerCase().split(/\s+/).includes('any')) return Number.MAX_SAFE_INTEGER;
  return sizes.split(/\s+/).reduce((largest, size) => {
    const match = /^(\d+)x(\d+)$/i.exec(size);
    return match ? Math.max(largest, Number(match[1]) * Number(match[2])) : largest;
  }, 0);
}

function byLargestDeclaredSize(first, second) {
  return iconSizeScore(second.sizes) - iconSizeScore(first.sizes);
}

export function parseHtmlMetadata(html, pageUrl, approvedHosts) {
  const rawAppleIcons = [];
  const rawIcons = [];
  const rawThemeColors = [];
  let rawBaseUrl = null;
  let rawManifestUrl = null;

  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === 'base' && rawBaseUrl === null && attributes.href) {
        rawBaseUrl = attributes.href;
        return;
      }
      if (name === 'meta' && (attributes.name ?? '').toLowerCase() === 'theme-color') {
        if (rawThemeColors.length < MAX_THEME_CANDIDATES) {
          rawThemeColors.push({ color: attributes.content, media: attributes.media ?? '' });
        }
        return;
      }
      if (name !== 'link' || !attributes.href) return;

      const rels = relTokens(attributes);
      if (rawManifestUrl === null && rels.includes('manifest')) rawManifestUrl = attributes.href;
      if (rels.some((rel) => rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed')) {
        if (rawAppleIcons.length < MAX_RAW_ICONS_PER_CLASS) {
          rawAppleIcons.push({ href: attributes.href, sizes: attributes.sizes });
        }
      } else if (rels.includes('icon') && rawIcons.length < MAX_RAW_ICONS_PER_CLASS) {
        rawIcons.push({ href: attributes.href, sizes: attributes.sizes });
      }
    },
  }, {
    decodeEntities: true,
    lowerCaseAttributeNames: true,
    lowerCaseTags: true,
    recognizeSelfClosing: true,
  });

  parser.end(typeof html === 'string' ? html : '');

  const documentBaseUrl = resolveMetadataUrl(rawBaseUrl, pageUrl, approvedHosts) ?? pageUrl;
  const themeCandidates = [
    ...rawThemeColors.filter(({ media }) => !media),
    ...rawThemeColors.filter(({ media }) => /prefers-color-scheme\s*:\s*light/i.test(media)),
    ...rawThemeColors.filter(({ media }) => media && !/prefers-color-scheme\s*:\s*light/i.test(media)),
  ];
  const themeColor = themeCandidates
    .map(({ color }) => normalizeThemeColor(color))
    .find((color) => color !== null) ?? null;

  const appleIcons = rawAppleIcons.sort(byLargestDeclaredSize).flatMap(({ href }) => {
    const resolved = resolveMetadataUrl(href, documentBaseUrl, approvedHosts);
    return resolved ? [{ kind: 'apple-touch-icon', url: resolved }] : [];
  });
  const icons = rawIcons.sort(byLargestDeclaredSize).flatMap(({ href }) => {
    const resolved = resolveMetadataUrl(href, documentBaseUrl, approvedHosts);
    return resolved ? [{ kind: 'icon', url: resolved }] : [];
  });

  return {
    themeColor,
    themeColorSourceUrl: themeColor ? pageUrl : null,
    manifestUrl: resolveMetadataUrl(rawManifestUrl, documentBaseUrl, approvedHosts),
    iconCandidates: deduplicateIconCandidates([...appleIcons, ...icons]).slice(0, MAX_ICON_CANDIDATES),
  };
}

export function parseWebManifest(source, manifestUrl, approvedHosts) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    return { themeColor: null, themeColorSourceUrl: null, iconCandidates: [] };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { themeColor: null, themeColorSourceUrl: null, iconCandidates: [] };
  }

  const themeColor = normalizeThemeColor(manifest.theme_color);
  const icons = Array.isArray(manifest.icons) ? manifest.icons.slice(0, 64) : [];
  const iconCandidates = icons.sort(byLargestDeclaredSize).slice(0, MAX_ICON_CANDIDATES).flatMap((icon) => {
    if (!icon || typeof icon !== 'object' || Array.isArray(icon)) return [];
    const url = resolveMetadataUrl(icon.src, manifestUrl, approvedHosts);
    return url ? [{ kind: 'manifest', url }] : [];
  });

  return {
    themeColor,
    themeColorSourceUrl: themeColor ? manifestUrl : null,
    iconCandidates: deduplicateIconCandidates(iconCandidates).slice(0, MAX_ICON_CANDIDATES),
  };
}
