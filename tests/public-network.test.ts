import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  assertPublicHttpsUrl,
  createPinnedLookup,
  isPublicIpAddress,
  requestPublicHttps,
} from '../scripts/lib/public-network.mjs';

describe('brand sync public-network boundary', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.10',
    '::1',
    '::2',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::7f00:1',
    '100::1',
    '2002:7f00:1::',
    'fc00::1',
    'fe80::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it('rejects localhost names and DNS answers containing a private address', async () => {
    await expect(assertPublicHttpsUrl('https://localhost/icon.png')).rejects.toThrow(/public/i);
    await expect(assertPublicHttpsUrl('https://product.example/icon.png', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ])).rejects.toThrow(/public/i);
  });

  it('accepts HTTPS hosts only when every resolved address is public', async () => {
    await expect(assertPublicHttpsUrl('https://cdn.product.example/icon.png', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])).resolves.toMatchObject({ protocol: 'https:', hostname: 'cdn.product.example' });
  });

  it('pins the actual socket lookup to prevalidated addresses', async () => {
    const pinnedLookup = createPinnedLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      pinnedLookup('cdn.product.example', { family: 4 }, (error: Error | null, address: string, family: number) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });
    expect(resolved).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('blocks a redirect to a private host before issuing the redirected request', async () => {
    const calls: string[] = [];
    const requester = (url: URL, _options: object, callback: (response: Readable & { statusCode: number; headers: object }) => void) => {
      calls.push(url.href);
      const request = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: (error?: Error) => void; end: () => void };
      request.setTimeout = () => {};
      request.destroy = (error) => { if (error) request.emit('error', error); };
      request.end = () => {};
      queueMicrotask(() => {
        const response = Readable.from([]) as Readable & { statusCode: number; headers: object };
        response.statusCode = 302;
        response.headers = { location: 'https://127.0.0.1/private' };
        callback(response);
      });
      return request;
    };

    await expect(requestPublicHttps('https://product.example/', {
      readBody: false,
      requester: requester as unknown as typeof import('node:https').request,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    })).rejects.toThrow(/public/i);
    expect(calls).toEqual(['https://product.example/']);
  });

  it('enforces an absolute deadline while a response trickles bytes', async () => {
    const requester = (_url: URL, _options: object, callback: (response: Readable & { statusCode: number; headers: object }) => void) => {
      const request = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: (error?: Error) => void; end: () => void };
      request.setTimeout = () => {};
      request.destroy = (error) => { if (error) request.emit('error', error); };
      request.end = () => {};
      queueMicrotask(() => {
        const response = new Readable({ read() {} }) as Readable & { statusCode: number; headers: object };
        response.statusCode = 200;
        response.headers = {};
        const interval = setInterval(() => response.push(Buffer.from('x')), 5);
        response.once('close', () => clearInterval(interval));
        callback(response);
      });
      return request;
    };

    await expect(requestPublicHttps('https://product.example/', {
      requester: requester as unknown as typeof import('node:https').request,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      timeoutMs: 30,
    })).rejects.toThrow(/deadline/i);
  });

  it('rejects a public redirect outside the approved official hosts', async () => {
    const calls: string[] = [];
    const requester = (url: URL, _options: object, callback: (response: Readable & { statusCode: number; headers: object }) => void) => {
      calls.push(url.href);
      const request = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: (error?: Error) => void; end: () => void };
      request.setTimeout = () => {};
      request.destroy = (error) => { if (error) request.emit('error', error); };
      request.end = () => {};
      queueMicrotask(() => {
        const response = Readable.from([]) as Readable & { statusCode: number; headers: object };
        response.statusCode = 302;
        response.headers = { location: 'https://unrelated.example/logo.png' };
        callback(response);
      });
      return request;
    };

    await expect(requestPublicHttps('https://product.example/', {
      readBody: false,
      requester: requester as unknown as typeof import('node:https').request,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      isUrlAllowed: (url: URL) => url.hostname === 'product.example',
    })).rejects.toThrow(/approved official host/i);
    expect(calls).toEqual(['https://product.example/']);
  });
});