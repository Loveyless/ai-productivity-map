import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireSingleWriterLock,
  assertCatalogUnchanged,
  contentAddressedIconPath,
  sha256Hex,
  writeImmutableFile,
} from '../scripts/lib/brand-publication.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('brand publication commit protocol', () => {
  it('derives an immutable ID-bound icon path and SHA-256 from the exact PNG bytes', () => {
    const bytes = Buffer.from('verified png bytes');
    const digest = sha256Hex(bytes);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(contentAddressedIconPath('chatgpt', bytes)).toBe(`/icons/chatgpt-${digest.slice(0, 12)}.png`);
    expect(() => contentAddressedIconPath('../../outside', bytes)).toThrow(/slug/);
  });

  it('rejects stale catalog baselines instead of overwriting concurrent edits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-map-publication-'));
    temporaryDirectories.push(directory);
    const catalogPath = join(directory, 'catalog.json');
    await writeFile(catalogPath, '{"version":1}\n');
    await expect(assertCatalogUnchanged(catalogPath, '{"version":1}\n')).resolves.toBeUndefined();
    await writeFile(catalogPath, '{"version":2}\n');
    await expect(assertCatalogUnchanged(catalogPath, '{"version":1}\n')).rejects.toThrow(/concurrent/);
  });

  it('allows only one cooperative publisher until the lock is released', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-map-publication-'));
    temporaryDirectories.push(directory);
    const lockPath = join(directory, '.brand-sync.lock');
    const release = await acquireSingleWriterLock(lockPath);
    await expect(acquireSingleWriterLock(lockPath)).rejects.toThrow(/already running/);
    await release();
    const releaseAgain = await acquireSingleWriterLock(lockPath);
    await releaseAgain();
  });

  it('publishes immutable files without replacing different existing bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-map-publication-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'icon.png');
    await writeImmutableFile(target, Buffer.from('first'));
    await writeImmutableFile(target, Buffer.from('first'));
    await expect(writeImmutableFile(target, Buffer.from('different'))).rejects.toThrow(/immutable/);
    await expect(readFile(target, 'utf8')).resolves.toBe('first');
  });

  it('rejects an existing destination symlink without reading or following it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-map-publication-'));
    temporaryDirectories.push(directory);
    const outside = join(directory, 'outside.txt');
    const target = join(directory, 'icon.png');
    await writeFile(outside, 'same');
    await symlink(outside, target);

    await expect(writeImmutableFile(target, Buffer.from('same'))).rejects.toThrow(/symbolic link/);
    await expect(readFile(outside, 'utf8')).resolves.toBe('same');
  });

  it('rejects a symlinked publication directory before creating an outside file', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ai-map-publication-'));
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'ai-map-publication-outside-'));
    temporaryDirectories.push(parent, outsideDirectory);
    const linkedDirectory = join(parent, 'icons');
    const target = join(linkedDirectory, 'escaped.png');
    await symlink(outsideDirectory, linkedDirectory);

    await expect(writeImmutableFile(target, Buffer.from('bytes'))).rejects.toThrow(/symbolic link/);
    await expect(access(join(outsideDirectory, 'escaped.png'))).rejects.toThrow();
  });
});
