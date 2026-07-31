import { parentPort, workerData } from 'node:worker_threads';
import { rasterizeIcon } from './icon-rasterization.mjs';

try {
  const bytes = await rasterizeIcon(Buffer.from(workerData));
  parentPort?.postMessage({ ok: true, bytes });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error?.message ?? 'image rasterization failed' });
}
