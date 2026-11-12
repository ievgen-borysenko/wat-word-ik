import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLinks, linkTargets } from './check-links.mjs';

const SCRIPT = resolve(import.meta.dirname, 'check-links.mjs');

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** @param {Record<string, string>} files */
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'check-links-'));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const base = {
  LICENSE: 'MIT',
  'docs/methodology.md': '# How\n\nBack to the [README](../README.md#run).\n',
  'docs/sources.md': '# Sources\n',
  'src/main.tsx': '',
};

/** @param {string} dir */
const broken = (dir) => checkLinks(dir).violations.map((v) => `${v.file}:${v.line} ${v.target}`);

describe('check-links', () => {
  it('passes when every relative link resolves', () => {
    const dir = tree({
      ...base,
      'README.md': [
        '# Title',
        'See [methodology](docs/methodology.md), [sources](./docs/sources.md "Sources") and [the code](src/).',
        '![logo](<docs/sources.md>) [licence][lic] and [home](https://example.com/x.md) [mail](mailto:a@b.c)',
        'Jump to [run](#run). <a href="LICENSE">licence</a>',
        '',
        '[lic]: LICENSE',
      ].join('\n'),
    });
    const r = checkLinks(dir);
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(7);
    expect(r.files).toEqual(['README.md', 'docs/methodology.md', 'docs/sources.md']);
  });

  it('reports every broken link with its line', () => {
    const dir = tree({
      ...base,
      'README.md': '# Title\n\n[gone](docs/gone.md)\n\n[also gone](docs/methodology.md/../nope.md#x)\n',
      'docs/sources.md': '# Sources\n\n[img](img/chart.png)\n',
    });
    expect(broken(dir)).toEqual([
      'README.md:3 docs/gone.md',
      'README.md:5 docs/methodology.md/../nope.md#x',
      'docs/sources.md:3 img/chart.png',
    ]);
  });

  it('rejects a link that leaves the repository', () => {
    const dir = tree({ ...base, 'README.md': '[up](../../etc/hosts)\n' });
    expect(checkLinks(dir).violations.map((v) => v.message)).toEqual(['points outside the repository']);
  });

  it('checks reference definitions and HTML attributes', () => {
    const dir = tree({ ...base, 'README.md': '[x][a]\n\n[a]: missing.md\n<img src="missing.png">\n' });
    expect(broken(dir)).toEqual(['README.md:3 missing.md', 'README.md:4 missing.png']);
  });

  it('ignores links inside code blocks and code spans', () => {
    const text = ['```md', '[x](missing.md)', '```', '~~~', '[y](missing.md)', '~~~', 'Use `[z](missing.md)` here.', '[ok](LICENSE)'].join(
      '\n',
    );
    expect(linkTargets(text)).toEqual([{ target: 'LICENSE', line: 8 }]);
  });

  it('decodes percent-encoded paths', () => {
    const dir = tree({ ...base, 'docs/two words.md': '#', 'README.md': '[a](docs/two%20words.md)\n' });
    expect(broken(dir)).toEqual([]);
  });

  describe('command line', () => {
    /** @param {string} dir */
    const run = (dir) => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

    it('exits 0 when links resolve', () => {
      expect(run(tree({ ...base, 'README.md': '[l](LICENSE)\n' })).status).toBe(0);
    });

    it('exits 1 and lists broken links', () => {
      const r = run(tree({ ...base, 'README.md': '[l](NOPE.md)\n' }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('README.md:1: NOPE.md does not resolve');
    });

    it('exits 2 when the folder is missing', () => {
      expect(run(join(tmpdir(), 'check-links-does-not-exist-')).status).toBe(2);
    });
  });
});
