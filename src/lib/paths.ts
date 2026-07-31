export function withBasePath(base: string, assetPath: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedAssetPath = assetPath.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedAssetPath}`;
}
