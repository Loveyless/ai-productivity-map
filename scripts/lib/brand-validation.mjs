import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';

export const MAX_LOCAL_ICON_BYTES = 128 * 1024;
const REQUIRED_LOCAL_ICON_SIZE = 96;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOOL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function validateBrandAssets(tools, publicDirectory) {
  const errors = [];
  const publicRoot = resolve(publicDirectory);
  const realPublicRoot = await realpath(publicRoot);

  for (const [index, tool] of tools.entries()) {
    if (typeof tool?.brandIconPath !== 'string') continue;

    const safeId = typeof tool.id === 'string' && tool.id.length <= 64 && TOOL_ID_PATTERN.test(tool.id);
    const expectedPattern = safeId ? new RegExp(`^/icons/${tool.id}(?:-[a-f0-9]{12})?\\.png$`) : null;
    if (!expectedPattern?.test(tool.brandIconPath)) {
      errors.push(`tool[${index}] ${tool.id}: brandIconPath must be an ID-bound local PNG path`);
      continue;
    }

    const assetPath = resolve(publicRoot, `.${tool.brandIconPath}`);
    if (!assetPath.startsWith(`${publicRoot}${sep}`)) {
      errors.push(`tool[${index}] ${tool.id}: brandIconPath escapes public/`);
      continue;
    }

    let assetStat;
    try {
      assetStat = await lstat(assetPath);
    } catch {
      errors.push(`tool[${index}] ${tool.id}: local brand icon is missing at ${tool.brandIconPath}`);
      continue;
    }

    if (assetStat.isSymbolicLink()) {
      errors.push(`tool[${index}] ${tool.id}: brand icon must not be a symbolic link`);
      continue;
    }
    if (!assetStat.isFile()) {
      errors.push(`tool[${index}] ${tool.id}: brand icon must be a regular file`);
      continue;
    }

    try {
      const realAssetPath = await realpath(assetPath);
      if (!realAssetPath.startsWith(`${realPublicRoot}${sep}`)) {
        errors.push(`tool[${index}] ${tool.id}: brand icon resolves outside public/`);
        continue;
      }
    } catch {
      errors.push(`tool[${index}] ${tool.id}: brand icon real path cannot be verified`);
      continue;
    }

    let bytes;
    let assetHandle;
    try {
      assetHandle = await open(assetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const openedStat = await assetHandle.stat();
      if (!openedStat.isFile()) throw new Error('not a regular file');
      if (openedStat.size > MAX_LOCAL_ICON_BYTES) {
        errors.push(`tool[${index}] ${tool.id}: brand icon exceeds 128 KiB`);
        continue;
      }
      bytes = await assetHandle.readFile();
    } catch {
      errors.push(`tool[${index}] ${tool.id}: brand icon bytes cannot be read`);
      continue;
    } finally {
      await assetHandle?.close().catch(() => {});
    }
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (!SHA256_PATTERN.test(tool.brandIconSha256 ?? '') || tool.brandIconSha256 !== actualSha256) {
      errors.push(`tool[${index}] ${tool.id}: brand icon SHA-256 does not match local bytes`);
    }
    const filenameHash = tool.brandIconPath.match(/-([a-f0-9]{12})\.png$/)?.[1];
    if (filenameHash && !actualSha256.startsWith(filenameHash)) {
      errors.push(`tool[${index}] ${tool.id}: content-addressed filename hash prefix does not match local bytes`);
    }

    try {
      const image = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: REQUIRED_LOCAL_ICON_SIZE ** 2,
      });
      const metadata = await image.metadata();
      if (metadata.format !== 'png') {
        errors.push(`tool[${index}] ${tool.id}: brand icon must decode as PNG`);
      }
      if (metadata.width !== REQUIRED_LOCAL_ICON_SIZE || metadata.height !== REQUIRED_LOCAL_ICON_SIZE) {
        errors.push(`tool[${index}] ${tool.id}: brand icon must be exactly 96x96px`);
      }
      await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: REQUIRED_LOCAL_ICON_SIZE ** 2,
      }).raw().toBuffer();
    } catch {
      errors.push(`tool[${index}] ${tool.id}: brand icon failed to fully decode as a safe PNG`);
    }
  }

  return errors;
}
