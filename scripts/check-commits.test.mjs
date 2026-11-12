import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCommits, listCommits } from './check-commits.mjs';

const SCRIPT = resolve(import.meta.dirname, 'check-commits.mjs');
const OWNER = '10108630+ievgen-borysenko@users.noreply.github.com';
const CO_AUTHOR = '310343018+xevbor@users.noreply.github.com';
const DEPENDABOT = '49699333+dependabot[bot]@users.noreply.github.com';
const ZERO = '0'.repeat(40);

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throw-away repository inside its own temp directory. Git runs with a clean
 * environment: no global or system config (so no hooks, templates or signing
 * from the machine), HOME inside the temp directory, and no GIT_* variables
 * inherited from the caller, so the real repository is never touched.
 */
function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'check-commits-'));
  made.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '');
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: root,
    LANG: 'C',
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  /** @param {string[]} args @param {Record<string, string>} [extra] */
  const git = (args, extra = {}) =>
    execFileSync('git', args, { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet', '--initial-branch=main']);
  /**
   * @param {string} message
   * @param {string} [author]
   * @param {string} [committer]
   */
  const commit = (message, author = OWNER, committer = OWNER) => {
    git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', message], {
      GIT_AUTHOR_NAME: 'A',
      GIT_AUTHOR_EMAIL: author,
      GIT_COMMITTER_NAME: 'C',
      GIT_COMMITTER_EMAIL: committer,
    });
    return git(['rev-parse', 'HEAD']);
  };
  return { repo, env, git, commit };
}

/**
 * @param {ReturnType<typeof tempRepo>} r
 * @param {string} base
 * @param {string} head
 */
const rules = (r, base, head) =>
  checkCommits(listCommits(base, head, { cwd: r.repo, env: r.env })).map((v) => `${v.sha.slice(0, 7)} ${v.rule}`);

describe('check-commits', () => {
  it('passes a range with allowed authors and committers', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.commit(`one\n\nCo-Authored-By: xevbor <${CO_AUTHOR}>`);
    r.commit('bump', DEPENDABOT, 'noreply@github.com');
    r.commit('signed\n\nSigned-off-by: dependabot[bot] <support@github.com>', DEPENDABOT, 'noreply@github.com');
    const commits = listCommits(base, 'HEAD', { cwd: r.repo, env: r.env });
    expect(commits.map((c) => c.subject)).toEqual(['one', 'bump', 'signed']);
    expect(checkCommits(commits)).toEqual([]);
  });

  it('compares addresses without regard to case', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.commit('upper', OWNER.toUpperCase());
    expect(rules(r, base, 'HEAD')).toEqual([]);
  });

  it('rejects a personal author address', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit('oops', 'someone@example.com', OWNER);
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} author`]);
  });

  it('rejects a personal committer address even when the author is fine', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit('oops', OWNER, 'someone@example.com');
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} committer`]);
  });

  it('rejects a personal address in a trailer, but not in prose', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit('trailer\n\nCo-Authored-By: Someone <someone@example.com>');
    r.commit('prose\n\nThe old address someone@example.com is gone.');
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} trailer`]);
  });

  it('checks only the range, not the commits before base', () => {
    const r = tempRepo();
    r.commit('old', 'someone@example.com');
    const base = r.commit('base');
    r.commit('new');
    expect(rules(r, base, 'HEAD')).toEqual([]);
  });

  it('checks the whole history when base is all zeros', () => {
    const r = tempRepo();
    const old = r.commit('old', 'someone@example.com');
    r.commit('new');
    expect(rules(r, ZERO, 'HEAD')).toEqual([`${old.slice(0, 7)} author`]);
  });

  it('checks commits that arrive through a merge', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.git(['checkout', '--quiet', '-b', 'side']);
    const bad = r.commit('side', 'someone@example.com');
    r.git(['checkout', '--quiet', 'main']);
    r.commit('main');
    r.git(['-c', 'commit.gpgsign=false', 'merge', '--quiet', '--no-ff', '--no-edit', 'side'], {
      GIT_AUTHOR_NAME: 'A',
      GIT_AUTHOR_EMAIL: OWNER,
      GIT_COMMITTER_NAME: 'C',
      GIT_COMMITTER_EMAIL: OWNER,
    });
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} author`]);
  });

  it('refuses a base that is not in the history', () => {
    const r = tempRepo();
    r.commit('base');
    expect(() => listCommits('1234567890abcdef1234567890abcdef12345678', 'HEAD', { cwd: r.repo, env: r.env })).toThrow(
      /not a commit/,
    );
  });

  describe('command line', () => {
    /**
     * @param {ReturnType<typeof tempRepo>} r
     * @param {string[]} args
     */
    const run = (r, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: r.repo, env: r.env, encoding: 'utf8' });

    it('exits 0 on a clean range', () => {
      const r = tempRepo();
      const base = r.commit('base');
      r.commit('next');
      const res = run(r, [base, 'HEAD']);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('1 commit(s)');
    });

    it('exits 1 and names the commit', () => {
      const r = tempRepo();
      const base = r.commit('base');
      r.commit('leak', 'someone@example.com');
      const res = run(r, [base, 'HEAD']);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('"leak": author e-mail <someone@example.com>');
    });

    it('exits 2 without arguments or with an unknown revision', () => {
      const r = tempRepo();
      r.commit('base');
      expect(run(r, []).status).toBe(2);
      expect(run(r, ['no-such-ref', 'HEAD']).status).toBe(2);
    });
  });
});
