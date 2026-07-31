import { Worker } from 'node:worker_threads';
import { decodeIco, isIco } from 'icojs';
import sharp from 'sharp';

const OUTPUT_ICON_SIZE = 96;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_ICO_FRAMES = 32;
const MAX_ICO_FRAME_DIMENSION = 256;
const MAX_ICO_FRAME_BYTES = 512 * 1024;

function looksLikeSvg(buffer) {
  const source = buffer.toString('utf8');
  return /<\?xml\b|<!doctype\b|<(?:[A-Za-z_][\w.-]*:)?svg(?:\s|>)/i.test(source);
}

async function decodeLargestIcoFrame(buffer) {
  if (buffer.length < 6) throw new Error('ICO header is incomplete');
  const frameCount = buffer.readUInt16LE(4);
  if (frameCount < 1 || frameCount > MAX_ICO_FRAMES) {
    throw new Error(`ICO frame limit exceeded (${MAX_ICO_FRAMES})`);
  }
  const directoryBytes = 6 + (frameCount * 16);
  if (buffer.length < directoryBytes) throw new Error('ICO directory is incomplete');
  for (let index = 0; index < frameCount; index += 1) {
    const entry = 6 + (index * 16);
    const byteLength = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (byteLength < 1 || byteLength > MAX_ICO_FRAME_BYTES ||
      offset < directoryBytes || offset + byteLength > buffer.length) {
      throw new Error('ICO frame points outside the input buffer or exceeds the encoded-size limit');
    }
    const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
    if (byteLength >= 24 && buffer.subarray(offset, offset + 8).equals(pngSignature) &&
      buffer.subarray(offset + 12, offset + 16).toString('ascii') === 'IHDR') {
      const width = buffer.readUInt32BE(offset + 16);
      const height = buffer.readUInt32BE(offset + 20);
      if (width < 1 || height < 1 || width > MAX_ICO_FRAME_DIMENSION || height > MAX_ICO_FRAME_DIMENSION) {
        throw new Error(`ICO embedded PNG dimension limit exceeded (${MAX_ICO_FRAME_DIMENSION}px)`);
      }
    } else if (byteLength >= 12) {
      const dibHeaderBytes = buffer.readUInt32LE(offset);
      if (dibHeaderBytes === 12) {
        const width = buffer.readUInt16LE(offset + 4);
        const doubledHeight = buffer.readUInt16LE(offset + 6);
        if (width > MAX_ICO_FRAME_DIMENSION || doubledHeight > MAX_ICO_FRAME_DIMENSION * 2) {
          throw new Error(`ICO bitmap dimension limit exceeded (${MAX_ICO_FRAME_DIMENSION}px)`);
        }
      } else if (dibHeaderBytes >= 40 && byteLength >= 12) {
        const width = Math.abs(buffer.readInt32LE(offset + 4));
        const doubledHeight = Math.abs(buffer.readInt32LE(offset + 8));
        if (width > MAX_ICO_FRAME_DIMENSION || doubledHeight > MAX_ICO_FRAME_DIMENSION * 2) {
          throw new Error(`ICO bitmap dimension limit exceeded (${MAX_ICO_FRAME_DIMENSION}px)`);
        }
      }
    }
  }

  let frames;
  try {
    frames = await decodeIco(buffer, 'image/png');
  } catch {
    throw new Error('ICO could not be decoded');
  }
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('ICO contains no decodable frames');
  }
  const frame = [...frames].sort((left, right) =>
    (right.width * right.height) - (left.width * left.height),
  )[0];
  return Buffer.from(frame.buffer);
}

export async function rasterizeIcon(input) {
  let buffer = Buffer.from(input);
  if (looksLikeSvg(buffer)) {
    throw new Error('SVG input is not accepted by automated brand sync');
  }
  if (isIco(buffer)) {
    buffer = await decodeLargestIcoFrame(buffer);
  }

  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: false,
      density: 192,
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new Error('image could not be decoded');
  }
  if (!metadata.format || !metadata.width || !metadata.height) {
    throw new Error('image metadata is incomplete');
  }

  try {
    const resized = await sharp(buffer, {
      animated: false,
      density: 192,
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .resize(OUTPUT_ICON_SIZE, OUTPUT_ICON_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, effort: 10, palette: true, colours: 256 })
      .toBuffer();

    const outputMetadata = await sharp(resized).metadata();
    if (outputMetadata.format !== 'png' || outputMetadata.width !== OUTPUT_ICON_SIZE ||
      outputMetadata.height !== OUTPUT_ICON_SIZE) {
      throw new Error('rasterized output has unexpected format or dimensions');
    }
    return resized;
  } catch (error) {
    throw new Error(`image rasterization failed: ${error.message}`);
  }
}

export function rasterizeIconWithTimeout(input, timeoutMs, {
  workerUrl = new URL('./icon-rasterization-worker.mjs', import.meta.url),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('rasterization deadline exceeded'));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: Buffer.from(input) });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new Error('rasterization deadline exceeded'));
      });
    }, timeoutMs);

    worker.once('message', (message) => {
      finish(() => {
        if (message?.ok) resolve(Buffer.from(message.bytes));
        else reject(new Error(message?.error ?? 'image rasterization failed'));
      });
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`rasterization worker exited before producing output (${code})`)));
    });
  });
}
