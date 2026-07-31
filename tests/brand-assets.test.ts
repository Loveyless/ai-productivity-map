import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { validateBrandAssets } from '../scripts/lib/brand-validation.mjs';

const temporaryDirectories: string[] = [];

async function createPublicDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'ai-productivity-map-brand-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'icons'));
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('brand asset validation', () => {
  it('requires every production catalog icon to use an ID-bound content-addressed path', async () => {
    const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
    for (const tool of catalog.tools.filter((candidate: { brandIconPath?: string | null }) => candidate.brandIconPath)) {
      expect(tool.brandIconPath).toMatch(new RegExp(`^/icons/${tool.id}-[a-f0-9]{12}\\.png$`));
    }
  });

  it('accepts a small decodable PNG at an ID-bound stable path', async () => {
    const publicDirectory = await createPublicDirectory();
    const iconPath = join(publicDirectory, 'icons', 'example.png');
    await sharp({ create: { width: 96, height: 96, channels: 4, background: '#635BFF' } })
      .png().toFile(iconPath);
    const digest = createHash('sha256').update(await readFile(iconPath)).digest('hex');

    const errors = await validateBrandAssets([{
      id: 'example',
      brandIconPath: '/icons/example.png',
      brandIconSha256: digest,
    }], publicDirectory);
    expect(errors).toEqual([]);
  });

  it('rejects a PNG whose bytes do not match the catalog SHA-256', async () => {
    const publicDirectory = await createPublicDirectory();
    const iconPath = join(publicDirectory, 'icons', 'example.png');
    await sharp({ create: { width: 96, height: 96, channels: 4, background: '#635BFF' } })
      .png().toFile(iconPath);
    const errors = await validateBrandAssets([{
      id: 'example',
      brandIconPath: '/icons/example.png',
      brandIconSha256: '0'.repeat(64),
    }], publicDirectory);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('SHA-256')]));
  });

  it('rejects a content-addressed filename whose suffix disagrees with the full SHA-256', async () => {
    const publicDirectory = await createPublicDirectory();
    const iconPath = join(publicDirectory, 'icons', 'example-000000000000.png');
    await sharp({ create: { width: 96, height: 96, channels: 4, background: '#635BFF' } })
      .png().toFile(iconPath);
    const digest = createHash('sha256').update(await readFile(iconPath)).digest('hex');

    const errors = await validateBrandAssets([{
      id: 'example',
      brandIconPath: '/icons/example-000000000000.png',
      brandIconSha256: digest,
    }], publicDirectory);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('filename hash prefix')]));
  });

  it('rejects valid PNGs that are not exactly 96 by 96 pixels', async () => {
    const publicDirectory = await createPublicDirectory();
    const iconPath = join(publicDirectory, 'icons', 'tiny.png');
    await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000000' } }).png().toFile(iconPath);
    const digest = createHash('sha256').update(await readFile(iconPath)).digest('hex');

    const errors = await validateBrandAssets([{
      id: 'tiny',
      brandIconPath: '/icons/tiny.png',
      brandIconSha256: digest,
    }], publicDirectory);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('exactly 96x96')]));
  });

  it('rejects truncated PNGs even when metadata and SHA-256 evidence are present', async () => {
    const publicDirectory = await createPublicDirectory();
    const iconPath = join(publicDirectory, 'icons', 'truncated.png');
    const complete = await sharp({ create: { width: 96, height: 96, channels: 4, background: '#123456' } }).png().toBuffer();
    const truncated = complete.subarray(0, Math.max(64, Math.floor(complete.length / 2)));
    await writeFile(iconPath, truncated);
    const digest = createHash('sha256').update(truncated).digest('hex');

    const errors = await validateBrandAssets([{
      id: 'truncated',
      brandIconPath: '/icons/truncated.png',
      brandIconSha256: digest,
    }], publicDirectory);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('fully decode')]));
  });

  it('reports missing, oversized, and undecodable icon files', async () => {
    const publicDirectory = await createPublicDirectory();
    await writeFile(join(publicDirectory, 'icons', 'oversized.png'), Buffer.alloc(130 * 1024));
    await writeFile(join(publicDirectory, 'icons', 'broken.png'), 'not a png');

    const errors = await validateBrandAssets([
      { id: 'missing', brandIconPath: '/icons/missing.png' },
      { id: 'oversized', brandIconPath: '/icons/oversized.png' },
      { id: 'broken', brandIconPath: '/icons/broken.png' },
    ], publicDirectory);

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('missing'),
      expect.stringContaining('128 KiB'),
      expect.stringContaining('decode'),
    ]));
  });

  it('rejects symlinks even when they point to a valid PNG', async () => {
    const publicDirectory = await createPublicDirectory();
    const outside = join(publicDirectory, '..', `outside-${Date.now()}.png`);
    await sharp({ create: { width: 32, height: 32, channels: 4, background: '#000000' } })
      .png().toFile(outside);
    await symlink(outside, join(publicDirectory, 'icons', 'linked.png'));

    const errors = await validateBrandAssets([{
      id: 'linked',
      brandIconPath: '/icons/linked.png',
    }], publicDirectory);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('symbolic link')]));
    const { rm } = await import('node:fs/promises');
    await rm(outside, { force: true });
  });
});
