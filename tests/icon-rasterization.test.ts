import { describe, expect, it } from 'vitest';
import { encodeIco } from 'icojs';
import sharp from 'sharp';
import { rasterizeIcon, rasterizeIconWithTimeout } from '../scripts/lib/icon-rasterization.mjs';

describe('official icon rasterization', () => {
  it('rejects even benign SVG input instead of relying on incomplete XML sanitization', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#000"/></svg>');

    await expect(rasterizeIcon(svg)).rejects.toThrow(/SVG input is not accepted/);
  });

  it('rejects namespace-prefixed SVG input even when a server lies about its content type', async () => {
    const svg = Buffer.from('<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="32" height="32"><svg:rect width="32" height="32"/></svg:svg>');

    await expect(rasterizeIcon(svg)).rejects.toThrow(/SVG input is not accepted/);
  });

  it('rejects external SVG references even when hidden after a large prefix', async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <!--${'x'.repeat(300 * 1024)}-->
      <image href="file:///etc/passwd" width="32" height="32" />
    </svg>`);

    await expect(rasterizeIcon(svg)).rejects.toThrow(/SVG input is not accepted/);
  });

  it('decodes a multi-size ICO and emits a safe 96px PNG', async () => {
    const small = await sharp({
      create: { width: 16, height: 16, channels: 4, background: '#FF4F00' },
    }).png().toBuffer();
    const large = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#635BFF' },
    }).png().toBuffer();
    const ico = Buffer.from(await encodeIco([{ buffer: small }, { buffer: large }]));

    const result = await rasterizeIcon(ico);
    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(96);
    expect(metadata.height).toBe(96);
  });

  it('rejects ICO files with an excessive frame directory before decoding', async () => {
    const ico = Buffer.alloc(6 + (33 * 16));
    ico.writeUInt16LE(0, 0);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(33, 4);

    await expect(rasterizeIcon(ico)).rejects.toThrow(/frame limit/);
  });

  it('rejects oversized embedded PNG dimensions before ICO decoding', async () => {
    const directoryBytes = 6 + 16;
    const frameBytes = 24;
    const ico = Buffer.alloc(directoryBytes + frameBytes);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(1, 4);
    ico.writeUInt8(0, 6);
    ico.writeUInt8(0, 7);
    ico.writeUInt32LE(frameBytes, 14);
    ico.writeUInt32LE(directoryBytes, 18);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(ico, directoryBytes);
    ico.writeUInt32BE(13, directoryBytes + 8);
    ico.write('IHDR', directoryBytes + 12, 'ascii');
    ico.writeUInt32BE(4096, directoryBytes + 16);
    ico.writeUInt32BE(4096, directoryBytes + 20);

    await expect(rasterizeIcon(ico)).rejects.toThrow(/dimension limit/);
  });

  it('terminates a decoder worker when the absolute rasterization budget expires', async () => {
    const workerUrl = new URL('./fixtures/hanging-icon-worker.mjs', import.meta.url);
    const started = Date.now();
    await expect(rasterizeIconWithTimeout(Buffer.from('input'), 30, { workerUrl }))
      .rejects.toThrow(/rasterization deadline/i);
    expect(Date.now() - started).toBeLessThan(250);
  });
});
