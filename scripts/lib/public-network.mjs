import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function normalizedHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isPublicIpAddress(address) {
  const normalized = normalizedHostname(address).split('%', 1)[0];
  const family = isIP(normalized);
  if (family === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }
  if (family === 6) {
    // Reject IPv4-compatible/mapped, NAT64, discard-only and 6to4 ranges.
    // They can tunnel otherwise private IPv4 destinations through a syntactically
    // public IPv6 literal and are unnecessary for fetching ordinary product sites.
    if (normalized.startsWith('::')) return false;
    if (normalized.startsWith('64:ff9b:')) return false;
    if (normalized.startsWith('100:')) return false;
    if (normalized.startsWith('2002:')) return false;
    if (/^(?:fc|fd)/.test(normalized)) return false;
    if (/^fe[89ab]/.test(normalized)) return false;
    if (normalized.startsWith('ff')) return false;
    if (normalized.startsWith('2001:db8:') || normalized === '2001:db8::') return false;
    return true;
  }
  return false;
}

async function resolveAllAddresses(hostname) {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function resolvePublicHttpsUrl(candidate, resolver = resolveAllAddresses) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('URL must be a valid public HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('URL must be a public HTTPS URL without credentials');
  }

  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) {
    throw new Error('URL host must resolve only to public addresses');
  }

  let rows;
  if (isIP(hostname)) {
    rows = [{ address: hostname, family: isIP(hostname) }];
  } else {
    let addresses;
    try {
      addresses = await resolver(hostname);
    } catch (error) {
      const message = `URL host could not be resolved publicly: ${error?.code ?? error?.message ?? 'DNS error'}`;
      throw Object.assign(new Error(message, { cause: error }), {
        code: typeof error?.code === 'string' ? error.code : undefined,
      });
    }
    rows = Array.isArray(addresses) ? addresses : [addresses];
  }

  if (rows.length === 0 || rows.some((row) => !row?.address || !isPublicIpAddress(row.address))) {
    throw new Error('URL host must resolve only to public addresses');
  }
  return { url, addresses: rows.map(({ address, family }) => ({ address, family: Number(family) })) };
}

export async function assertPublicHttpsUrl(candidate, resolver = resolveAllAddresses) {
  return (await resolvePublicHttpsUrl(candidate, resolver)).url;
}

export function createPinnedLookup(addresses) {
  const approved = addresses.map(({ address, family }) => ({ address, family: Number(family) }));
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const requestedFamily = typeof options === 'number' ? options : Number(options?.family ?? 0);
    const matching = requestedFamily ? approved.filter((row) => row.family === requestedFamily) : approved;
    if (matching.length === 0) {
      callback(Object.assign(new Error('No approved address matches the requested family'), { code: 'ENOTFOUND' }));
      return;
    }
    if (typeof options === 'object' && options?.all) callback(null, matching);
    else callback(null, matching[0].address, matching[0].family);
  };
}

function requestOnce(url, options, requester, onRequest) {
  return new Promise((resolve, reject) => {
    const request = requester(url, options, resolve);
    onRequest(request);
    request.once('error', reject);
    request.setTimeout?.(options.timeout, () => request.destroy(new Error('request timed out')));
    request.end?.();
  });
}

async function withDeadline(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response, maxBytes) {
  const declared = Number(response.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy?.();
    throw new Error(`response exceeds ${Math.round(maxBytes / 1024)} KiB limit`);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > maxBytes) {
      response.destroy?.();
      throw new Error(`response exceeds ${Math.round(maxBytes / 1024)} KiB limit`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function defaultNormalizeUrl(candidate, baseUrl) {
  try {
    const url = new URL(candidate, baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** @type {(url: URL) => boolean} */
const allowAnyPublicUrl = () => true;

export async function requestPublicHttps(candidate, {
  method = 'GET',
  headers = {},
  maxBytes = 2 * 1024 * 1024,
  maxRedirects = 5,
  readBody: shouldReadBody = true,
  requester = httpsRequest,
  resolver = resolveAllAddresses,
  timeoutMs = 45_000,
  normalizeUrl = defaultNormalizeUrl,
  isUrlAllowed = allowAnyPublicUrl,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const deadlineError = () => new Error('request deadline exceeded');
  let currentUrl = normalizeUrl(candidate, candidate);
  if (!currentUrl) throw new Error('URL must be a permitted public HTTPS URL');
  let activeRequest = null;
  let activeResponse = null;
  let deadlineExpired = false;
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true;
    const error = deadlineError();
    activeResponse?.destroy?.(error);
    activeRequest?.destroy?.(error);
  }, timeoutMs);
  try {
    if (!isUrlAllowed(new URL(currentUrl))) throw new Error('URL is outside the approved official hosts');
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const remaining = deadline - Date.now();
      if (deadlineExpired || remaining <= 0) throw deadlineError();
      const resolved = await withDeadline(
        resolvePublicHttpsUrl(currentUrl, resolver),
        remaining,
        'DNS resolution deadline exceeded',
      );
      const response = await requestOnce(resolved.url, {
        method,
        headers,
        agent: false,
        lookup: createPinnedLookup(resolved.addresses),
        timeout: remaining,
      }, requester, (request) => { activeRequest = request; });
      activeResponse = response;
      if (deadlineExpired) throw deadlineError();
      const status = Number(response.statusCode ?? 0);

      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers?.location;
        response.destroy?.();
        activeResponse = null;
        const nextUrl = normalizeUrl(Array.isArray(location) ? location[0] : location, currentUrl);
        if (!nextUrl) throw new Error('redirected to a non-HTTPS or prohibited source');
        if (!isUrlAllowed(new URL(nextUrl))) throw new Error('redirected outside the approved official hosts');
        currentUrl = nextUrl;
        continue;
      }

      if (!shouldReadBody) {
        response.destroy?.();
        activeResponse = null;
        return { status, headers: response.headers ?? {}, url: currentUrl, body: null };
      }
      const body = await readBody(response, maxBytes);
      activeResponse = null;
      return { status, headers: response.headers ?? {}, url: currentUrl, body };
    }
    throw new Error(`redirect limit exceeded (${maxRedirects})`);
  } catch (error) {
    if (deadlineExpired && !/deadline/i.test(error?.message ?? '')) throw deadlineError();
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
