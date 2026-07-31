import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  dateInTimeZone,
  iconSourceForVerifiedBytes,
  manualIconLocalEvidenceWarning,
  manualIconSourceNeedsFetch,
  parseSyncArguments,
  selectToolsForSync,
  shouldFailBrandCheck,
  shouldFetchBrandIcon,
} from '../scripts/lib/brand-sync.mjs';

const tools = [
  { id: 'missing', brandIconPath: null },
  { id: 'present', brandIconPath: '/icons/present.png' },
  { id: 'lost', brandIconPath: '/icons/lost.png' },
  { id: 'manual-missing', brandIconPath: null, brandIconMode: 'manual' },
  { id: 'manual-lost', brandIconPath: '/icons/manual-lost.png', brandIconMode: 'manual' },
];
type ToolStub = (typeof tools)[number];

describe('brand sync CLI selection', () => {
  it('records evidence dates in the declared Asia/Shanghai maintenance timezone', () => {
    expect(dateInTimeZone(new Date('2026-08-01T17:30:00Z'), 'Asia/Shanghai')).toBe('2026-08-02');
  });

  it('fails strict check mode on either proposed changes or inconclusive warnings', () => {
    expect(shouldFailBrandCheck({ check: true }, { changed: 0, inconclusive: 1 })).toBe(true);
    expect(shouldFailBrandCheck({ check: true }, { changed: 1, inconclusive: 0 })).toBe(true);
    expect(shouldFailBrandCheck({ check: true }, { changed: 0, inconclusive: 0 })).toBe(false);
    expect(shouldFailBrandCheck({ check: false }, { changed: 1, inconclusive: 1 })).toBe(false);
  });

  it('keeps product and component-specific review dates separate from brand-only refreshes', async () => {
    const source = await readFile(new URL('../scripts/sync-brand-assets.mjs', import.meta.url), 'utf8');
    expect(source).not.toContain("['tools', toolIndex, 'reviewedAt']");
    expect(source).not.toContain("['reviewedAt']");
    expect(source).not.toContain('brandReviewedAt');
    expect(source).toContain('brandIconReviewedAt');
    expect(source).toContain('brandThemeColorReviewedAt');
  });

  it('uses the pinned public requester and an immutable CAS publication protocol', async () => {
    const source = await readFile(new URL('../scripts/sync-brand-assets.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toContain('requestPublicHttps');
    expect(source).toContain('contentAddressedIconPath');
    expect(source).toContain('writeImmutableFile');
    expect(source).toContain('assertCatalogUnchanged');
  });

  it('processes missing automatic icons and reports invalid manual icons', () => {
    const options = parseSyncArguments([]);
    const selected = selectToolsForSync(tools, options, (tool: ToolStub) => tool.id === 'present');
    expect(selected.map((tool: ToolStub) => tool.id)).toEqual(['missing', 'lost', 'manual-lost']);
  });

  it('never auto-refreshes manual icons, but reports invalid local evidence and verifies distinct sources', () => {
    expect(shouldFetchBrandIcon({ brandIconMode: 'manual', brandIconPath: null }, { refresh: true, localValid: false })).toBe(false);
    expect(shouldFetchBrandIcon({ brandIconPath: '/icons/auto.png' }, { refresh: true, localValid: true })).toBe(true);
    expect(shouldFetchBrandIcon({ brandIconPath: null }, { refresh: false, localValid: false })).toBe(true);

    expect(manualIconLocalEvidenceWarning({ brandIconMode: 'manual', brandIconPath: '/icons/manual.png' }, false))
      .toMatch(/missing or invalid/);
    expect(manualIconLocalEvidenceWarning({ brandIconMode: 'manual', brandIconPath: null }, false)).toBeNull();
    expect(manualIconLocalEvidenceWarning({ brandIconPath: '/icons/auto.png' }, false)).toBeNull();

    const page = 'https://product.example/tool';
    expect(manualIconSourceNeedsFetch({ brandIconMode: 'manual', brandIconPath: '/icons/manual.png', brandIconSourceUrl: page }, page)).toBe(false);
    expect(manualIconSourceNeedsFetch({ brandIconMode: 'manual', brandIconPath: '/icons/manual.png', brandIconSourceUrl: 'https://cdn.product.example/icon.png' }, page)).toBe(true);
    expect(manualIconSourceNeedsFetch({ brandIconMode: 'manual', brandIconPath: null, brandIconSourceUrl: null }, page)).toBe(false);

    const current = { brandIconSha256: 'a'.repeat(64), brandIconSourceUrl: 'https://product.example/stable.png' };
    expect(iconSourceForVerifiedBytes(current, true, 'https://product.example/deploy-2.png'))
      .toBe('https://product.example/stable.png');
    expect(iconSourceForVerifiedBytes(current, false, 'https://product.example/new.png'))
      .toBe('https://product.example/new.png');
  });

  it('supports all, refresh, repeated ID, dry-run, and check modes', () => {
    expect(parseSyncArguments(['--all', '--dry-run'])).toMatchObject({ all: true, dryRun: true, refresh: false });
    expect(parseSyncArguments(['--refresh'])).toMatchObject({ all: true, dryRun: false, refresh: true });
    expect(parseSyncArguments(['--id', 'present', '--id=missing'])).toMatchObject({ ids: ['present', 'missing'] });
    expect(parseSyncArguments(['--check'])).toMatchObject({ all: true, dryRun: true, refresh: true, check: true });
  });

  it('republishes pending icon bytes even when catalog metadata is unchanged', async () => {
    const source = await readFile(new URL('../scripts/sync-brand-assets.mjs', import.meta.url), 'utf8');
    expect(source).toMatch(/pendingIcons\.length\s*>\s*0|changedToolIds\.size\s*>\s*0\s*\|\|\s*pendingIcons/);
  });

  it('keeps catalog order for explicit selections and rejects invalid arguments', () => {
    const options = parseSyncArguments(['--id=present,missing']);
    expect(selectToolsForSync(tools, options, () => true).map((tool: ToolStub) => tool.id)).toEqual(['missing', 'present']);
    expect(() => parseSyncArguments(['--all', '--id', 'missing'])).toThrow(/cannot be combined/);
    expect(() => parseSyncArguments(['--unknown'])).toThrow(/unknown option/);
    expect(() => selectToolsForSync(tools, parseSyncArguments(['--id', 'unknown']), () => true)).toThrow(/unknown tool ID/);
  });
});
