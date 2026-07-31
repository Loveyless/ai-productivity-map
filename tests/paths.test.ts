import { describe, expect, it } from 'vitest';
import { withBasePath } from '../src/lib/paths';

describe('GitHub Pages asset paths', () => {
  it('joins base paths and local asset paths with exactly one slash', () => {
    expect(withBasePath('/ai-productivity-map', '/icons/tool.png')).toBe('/ai-productivity-map/icons/tool.png');
    expect(withBasePath('/ai-productivity-map/', 'icons/tool.png')).toBe('/ai-productivity-map/icons/tool.png');
    expect(withBasePath('/', '/icons/tool.png')).toBe('/icons/tool.png');
  });
});
