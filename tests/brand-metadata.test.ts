import { describe, expect, it } from 'vitest';
import {
  normalizeThemeColor,
  officialOriginFaviconUrl,
  parseHtmlMetadata,
  parseWebManifest,
  resolveMetadataUrl,
} from '../scripts/lib/brand-metadata.mjs';

describe('brand metadata URL handling', () => {
  it('keeps the fallback favicon on the catalog product origin, not a redirected login origin', () => {
    expect(officialOriginFaviconUrl('https://notebooklm.google.com/app'))
      .toBe('https://notebooklm.google.com/favicon.ico');
    expect(officialOriginFaviconUrl('https://accounts.google.com/signin'))
      .toBe('https://accounts.google.com/favicon.ico');
  });

  it('resolves relative, root-relative, and protocol-relative metadata URLs', () => {
    expect(resolveMetadataUrl('../icon.png', 'https://product.example/app/page/'))
      .toBe('https://product.example/app/icon.png');
    expect(resolveMetadataUrl('/icon.png', 'https://product.example/app/'))
      .toBe('https://product.example/icon.png');
    expect(resolveMetadataUrl('//cdn.product.example/icon.png', 'https://product.example/', new Set(['product.example', 'cdn.product.example'])))
      .toBe('https://cdn.product.example/icon.png');
  });

  it('rejects insecure, executable, credentialed, and prohibited catalog URLs', () => {
    expect(resolveMetadataUrl('http://product.example/icon.png', 'https://product.example/')).toBeNull();
    expect(resolveMetadataUrl('javascript:alert(1)', 'https://product.example/')).toBeNull();
    expect(resolveMetadataUrl('https://user:secret@product.example/icon.png', 'https://product.example/')).toBeNull();
    expect(resolveMetadataUrl('https://www.google.com/s2/favicons?domain=product.example', 'https://product.example/')).toBeNull();
    expect(resolveMetadataUrl('https://cdn.simpleicons.org/product', 'https://product.example/')).toBeNull();
  });

  it('rejects public cross-origin metadata unless the host is explicitly approved', () => {
    expect(resolveMetadataUrl('https://unrelated.example/logo.png', 'https://product.example/')).toBeNull();
    expect(resolveMetadataUrl(
      'https://cdn.official.example/logo.png',
      'https://product.example/',
      new Set(['product.example', 'cdn.official.example']),
    )).toBe('https://cdn.official.example/logo.png');
  });
});

describe('official HTML metadata parsing', () => {
  it('handles attribute order and single, double, and unquoted attributes', () => {
    const metadata = parseHtmlMetadata(`
      <!doctype html>
      <html><head>
        <meta content='#abc' data-extra=yes name=theme-color>
        <link href=../manifest.webmanifest rel="manifest">
        <link sizes='32x32' href="/favicon-32.png" rel=icon>
        <link href=//cdn.product.example/apple.png rel='apple-touch-icon' sizes=180x180>
      </head></html>
    `, 'https://product.example/app/page/', new Set(['product.example', 'cdn.product.example']));

    expect(metadata.themeColor).toBe('#AABBCC');
    expect(metadata.themeColorSourceUrl).toBe('https://product.example/app/page/');
    expect(metadata.manifestUrl).toBe('https://product.example/app/manifest.webmanifest');
    expect(metadata.iconCandidates).toEqual([
      { kind: 'apple-touch-icon', url: 'https://cdn.product.example/apple.png' },
      { kind: 'icon', url: 'https://product.example/favicon-32.png' },
    ]);
  });

  it('uses the document base URL and de-duplicates icon candidates by precedence', () => {
    const metadata = parseHtmlMetadata(`
      <base href="https://assets.product.example/ui/">
      <link rel="ICON shortcut" href="mark.svg">
      <link href="mark.svg" rel="apple-touch-icon">
      <link rel="apple-touch-icon-precomposed" href="touch.png">
    `, 'https://product.example/', new Set(['product.example', 'assets.product.example']));

    expect(metadata.iconCandidates).toEqual([
      { kind: 'apple-touch-icon', url: 'https://assets.product.example/ui/mark.svg' },
      { kind: 'apple-touch-icon', url: 'https://assets.product.example/ui/touch.png' },
    ]);
  });

  it('ignores an unapproved cross-origin base URL and rejects explicit unrelated icons', () => {
    const metadata = parseHtmlMetadata(`
      <base href="https://unrelated.example/assets/">
      <link rel="icon" href="logo.png">
      <link rel="apple-touch-icon" href="https://evil.example/touch.png">
    `, 'https://product.example/app/', new Set(['product.example']));

    expect(metadata.iconCandidates).toEqual([
      { kind: 'icon', url: 'https://product.example/app/logo.png' },
    ]);
  });

  it('prefers scalable and larger icons within the same metadata class', () => {
    const metadata = parseHtmlMetadata(`
      <link rel="icon" href="small.png" sizes="16x16">
      <link rel="icon" href="large.png" sizes="192x192">
      <link rel="icon" href="scalable.svg" sizes="any">
      <link rel="apple-touch-icon" href="touch-small.png" sizes="120x120">
      <link rel="apple-touch-icon" href="touch-large.png" sizes="180x180">
    `, 'https://product.example/');

    expect(metadata.iconCandidates).toEqual([
      { kind: 'apple-touch-icon', url: 'https://product.example/touch-large.png' },
      { kind: 'apple-touch-icon', url: 'https://product.example/touch-small.png' },
      { kind: 'icon', url: 'https://product.example/scalable.svg' },
      { kind: 'icon', url: 'https://product.example/large.png' },
      { kind: 'icon', url: 'https://product.example/small.png' },
    ]);
  });

  it('caps hostile pages to a bounded number of icon candidates', () => {
    const html = Array.from({ length: 200 }, (_, index) =>
      `<link rel="icon" href="icon-${index}.png" sizes="${index + 1}x${index + 1}">`,
    ).join('');
    const metadata = parseHtmlMetadata(html, 'https://product.example/');
    expect(metadata.iconCandidates.length).toBeLessThanOrEqual(12);
  });
});

describe('manifest and color parsing', () => {
  it('normalizes opaque CSS hex and rejects inferred or non-hex colors', () => {
    expect(normalizeThemeColor('#09f')).toBe('#0099FF');
    expect(normalizeThemeColor('#10a37f')).toBe('#10A37F');
    expect(normalizeThemeColor('#11223344')).toBeNull();
    expect(normalizeThemeColor('rgb(1, 2, 3)')).toBeNull();
    expect(normalizeThemeColor('blue')).toBeNull();
  });

  it('resolves manifest icons and records the manifest as theme-color evidence', () => {
    const metadata = parseWebManifest(JSON.stringify({
      theme_color: '#123456',
      icons: [
        { src: 'icons/app-192.png', sizes: '192x192', type: 'image/png' },
        { src: '//cdn.product.example/app.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    }), 'https://product.example/app.webmanifest', new Set(['product.example', 'cdn.product.example']));

    expect(metadata.themeColor).toBe('#123456');
    expect(metadata.themeColorSourceUrl).toBe('https://product.example/app.webmanifest');
    expect(metadata.iconCandidates).toEqual([
      { kind: 'manifest', url: 'https://cdn.product.example/app.svg' },
      { kind: 'manifest', url: 'https://product.example/icons/app-192.png' },
    ]);
  });

  it('ignores malformed manifest icon entries without losing valid metadata', () => {
    const metadata = parseWebManifest(JSON.stringify({
      theme_color: '#abcdef',
      icons: [null, 'bad', 7, { src: 'valid.png', sizes: '192x192' }],
    }), 'https://product.example/app.webmanifest');

    expect(metadata).toEqual({
      themeColor: '#ABCDEF',
      themeColorSourceUrl: 'https://product.example/app.webmanifest',
      iconCandidates: [{ kind: 'manifest', url: 'https://product.example/valid.png' }],
    });
  });

  it('returns empty metadata for malformed manifests', () => {
    expect(parseWebManifest('{nope', 'https://product.example/app.webmanifest')).toEqual({
      themeColor: null,
      themeColorSourceUrl: null,
      iconCandidates: [],
    });
  });

  it('caps hostile manifests to a bounded number of icon candidates', () => {
    const metadata = parseWebManifest(JSON.stringify({
      icons: Array.from({ length: 200 }, (_, index) => ({
        src: `manifest-${index}.png`, sizes: `${index + 1}x${index + 1}`,
      })),
    }), 'https://product.example/app.webmanifest');
    expect(metadata.iconCandidates.length).toBeLessThanOrEqual(12);
  });
});
