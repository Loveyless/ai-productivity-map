import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const TOOL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSafeToolId(toolId) {
  if (typeof toolId !== 'string' || toolId.length > 64 || !TOOL_ID_PATTERN.test(toolId)) {
    throw new Error('tool ID must be a safe lowercase slug of at most 64 characters');
  }
  return toolId;
}

export function sha256Hex(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function contentAddressedIconPath(toolId, contents) {
  assertSafeToolId(toolId);
  return `/icons/${toolId}-${sha256Hex(contents).slice(0, 12)}.png`;
}

export async function assertCatalogUnchanged(path, baseline) {
  const current = await readFile(path, 'utf8');
  if (current !== baseline) {
    throw new Error('catalog changed concurrently; refusing to overwrite newer edits');
  }
}

async function assertSafePublicationDirectory(path) {
  const directory = resolve(path);
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) throw new Error('publication directory must not be a symbolic link');
  if (!stat.isDirectory()) throw new Error('publication directory must be a regular directory');
  if (await realpath(directory) !== directory) {
    throw new Error('publication directory ancestors must not contain symbolic links');
  }
  return directory;
}

export async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function readLockRecord(path) {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const raw = await handle.readFile('utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const pid = Number(data.pid);
      return {
        pid: Number.isInteger(pid) ? pid : null,
        startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function acquireSingleWriterLock(path, {
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  const directory = await assertSafePublicationDirectory(dirname(path));
  const target = resolve(path);
  if (dirname(target) !== directory) throw new Error('lock file must be a direct child of its directory');

  const createLock = async () => {
    const handle = await open(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      await handle.sync();
      await syncDirectory(directory);
    } catch (error) {
      await handle.close().catch(() => {});
      await unlink(target).catch(() => {});
      throw error;
    }
    let released = false;
    let closed = false;
    let unlinked = false;
    return async () => {
      if (released) return;
      if (!closed) {
        await handle.close();
        closed = true;
      }
      if (!unlinked) {
        await unlink(target);
        unlinked = true;
      }
      await syncDirectory(directory);
      released = true;
    };
  };

  try {
    return await createLock();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const existing = await readLockRecord(target);
  if (existing?.pid && await isProcessAlive(existing.pid)) {
    throw new Error('brand publication is already running');
  }

  // Reclaim only when the recorded owner is gone. Use rename-away so a live
  // owner that just released/reacquired cannot be raced into a shared lock.
  const stale = join(
    directory,
    `.${basename(target)}.stale.${process.pid}.${randomBytes(6).toString('hex')}`,
  );
  try {
    await rename(target, stale);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createLock();
    }
    throw new Error('brand publication is already running');
  }
  await unlink(stale).catch(() => {});
  await syncDirectory(directory);
  return createLock();
}

export async function writeImmutableFile(path, contents) {
  const directory = await assertSafePublicationDirectory(dirname(path));
  const target = resolve(path);
  if (dirname(target) !== directory) {
    throw new Error('immutable file must be a direct child of the publication directory');
  }
  const temporary = join(directory, `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o644,
    );
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, target);
      await syncDirectory(directory);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existingStat = await lstat(target);
      if (existingStat.isSymbolicLink()) throw new Error('immutable destination must not be a symbolic link');
      if (!existingStat.isFile()) throw new Error('immutable destination must be a regular file');
      const existingHandle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const existing = await existingHandle.readFile().finally(() => existingHandle.close());
      if (!existing.equals(Buffer.from(contents))) {
        throw new Error(`immutable file already exists with different bytes: ${target}`);
      }
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
