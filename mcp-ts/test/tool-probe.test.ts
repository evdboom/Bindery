import { describe, expect, it } from 'vitest';
import { probeTool } from '../src/tool-probe';

/**
 * These are smoke tests that run against the host machine's actual tool
 * installations. They are intentionally tolerant — on CI runners that lack a
 * given tool we expect `available: false` with a null path.
 */
describe('probeTool', () => {
  it('returns a consistent shape for git', () => {
    const r = probeTool('git');
    expect(typeof r.available).toBe('boolean');
    if (r.available) {
      expect(r.path).toBeTruthy();
      expect(r.source === 'path' || r.source === 'default').toBe(true);
    } else {
      expect(r.path).toBeNull();
      expect(r.source).toBeNull();
    }
  });

  it('returns a consistent shape for pandoc', () => {
    const r = probeTool('pandoc');
    expect(typeof r.available).toBe('boolean');
    if (!r.available) {
      expect(r.path).toBeNull();
      expect(r.version).toBeNull();
    }
  });

  it('returns a consistent shape for libreoffice', () => {
    const r = probeTool('libreoffice');
    expect(typeof r.available).toBe('boolean');
    if (!r.available) {
      expect(r.path).toBeNull();
      expect(r.version).toBeNull();
    }
  });
});
