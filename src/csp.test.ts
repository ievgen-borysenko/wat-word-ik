import { resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/*
 * Builds the site in memory with the real vite.config.ts and checks what would ship:
 * the Content-Security-Policy in index.html, and that no raw docs are emitted.
 */

const root = resolve(import.meta.dirname, '..');

interface OutputFile {
  readonly fileName: string;
  readonly type: string;
  readonly source?: string | Uint8Array;
}

async function buildFiles(): Promise<OutputFile[]> {
  const result = await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((o) => ('output' in o ? (o.output as OutputFile[]) : []));
}

function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values);
  }
  return map;
}

describe('built site', async () => {
  const files = await buildFiles();
  const html = files.find((f) => f.fileName === 'index.html');
  const source = typeof html?.source === 'string' ? html.source : '';
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(source);
  // Attribute value as the browser reads it (Vite escapes the quotes).
  const policy = (meta?.[1] ?? '').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  const csp = directives(policy);

  it('has a Content-Security-Policy meta tag before any script', () => {
    expect(meta, 'CSP meta tag').not.toBeNull();
    expect(source.indexOf('Content-Security-Policy')).toBeLessThan(source.indexOf('<script'));
  });

  it('allows no unsafe sources and no network access', () => {
    expect(policy).not.toMatch(/unsafe-|\*|https?:|data:[^;]*script/);
    expect(csp.get('default-src')).toEqual(["'none'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('style-src')).toEqual(["'self'"]);
    expect(csp.get('img-src')).toEqual(['data:']);
    expect(csp.get('form-action')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
  });

  it('lets the page load only its own script and stylesheet, even from its own origin', () => {
    for (const [name, sources] of csp) {
      if (name !== 'script-src' && name !== 'style-src') expect(sources, name).not.toContain("'self'");
    }
    // Not listed, so they fall back to default-src 'none'.
    for (const name of ['connect-src', 'media-src', 'font-src', 'frame-src', 'object-src', 'worker-src', 'manifest-src']) {
      expect(csp.has(name), name).toBe(false);
    }
  });

  it('ships no inline scripts or styles', () => {
    expect(source).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(source).not.toMatch(/<style[\s>]/);
    expect(source).not.toMatch(/\sstyle="/);
  });

  it('emits no raw docs: the page explains itself in its "How it works" dialog', () => {
    expect(files.filter((f) => f.fileName.startsWith('docs/') || f.fileName.endsWith('.md'))).toEqual([]);
  });
});
