import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allowedAddress, CO_AUTHOR, checkCommits, DEPENDABOT_CO_AUTHOR, listCommits, parseTrailers } from './check-commits.mjs';

/*
 * Every address and every footer line is put together at run time: the
 * repository's tree check refuses e-mail addresses in tracked files, this one
 * included, and the footer fixtures should not read as footers themselves.
 */
const AT = '@';
const noreply = (/** @type {string} */ id, /** @type {string} */ login) => `${id}+${login}${AT}users.noreply.github.com`;
const SCRIPT = resolve(import.meta.dirname, 'check-commits.mjs');
const DEV = noreply('12345', 'some-dev');
const HELPER = noreply('67890', 'helper');
const DEPENDABOT = noreply('49699333', 'dependabot[bot]');
const OTHER_BOT = noreply('1111', 'some-app[bot]');
const GITHUB = `noreply${AT}github.com`;
const SUPPORT = `support${AT}github.com`;
const PERSONAL = `someone${AT}example.com`;
const CO = `xevbor <${noreply('310343018', 'xevbor')}>`;
const ROBOT = String.fromCodePoint(0x1f916);
const words = (/** @type {string[]} */ ...w) => w.join(' ');
const ZERO = '0'.repeat(40);

/** A Dependabot commit message as it writes them: release links, a YAML block, a sign-off. */
const DEPENDABOT_MESSAGE = [
  'Bump the npm-minor-and-patch group with 2 updates',
  '',
  'Bumps the npm-minor-and-patch group with 2 updates: [vite](https://github.com/vitejs/vite/tree/HEAD/packages/vite) and [vitest](https://github.com/vitest-dev/vitest/tree/HEAD/packages/vitest).',
  '',
  'Updates `vite` from 8.3.5 to 8.4.0',
  '- [Release notes](https://github.com/vitejs/vite/releases)',
  '- [Changelog](https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md)',
  '- [Commits](https://github.com/vitejs/vite/commits/v8.4.0/packages/vite)',
  '',
  'Updates `vitest` from 5.0.5 to 5.1.0',
  '- [Release notes](https://github.com/vitest-dev/vitest/releases)',
  '- [Commits](https://github.com/vitest-dev/vitest/commits/v5.1.0/packages/vitest)',
  '',
  '---',
  'updated-dependencies:',
  '- dependency-name: vite',
  '  dependency-version: 8.4.0',
  '  dependency-type: direct:development',
  '  update-type: version-update:semver-minor',
  '  dependency-group: npm-minor-and-patch',
  '- dependency-name: vitest',
  '  dependency-version: 5.1.0',
  '  dependency-type: direct:development',
  '  update-type: version-update:semver-minor',
  '  dependency-group: npm-minor-and-patch',
  '...',
  '',
  `Signed-off-by: dependabot[bot] <${SUPPORT}>`,
].join('\n');

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
  const commit = (message, author = DEV, committer = DEV) => {
    git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-m', message], {
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
const rules = (r, base, head) => {
  const opts = { cwd: r.repo, env: r.env };
  return checkCommits(listCommits(base, head, opts), opts).map((v) => `${v.sha.slice(0, 7)} ${v.rule}`);
};

describe('check-commits', () => {
  it.each([
    [DEV, true],
    [noreply('1', 'a'), true],
    [DEPENDABOT, true],
    [GITHUB, true],
    [DEV.toUpperCase(), true],
    [`some-dev${AT}users.noreply.github.com`, false],
    [`${DEV}.evil.example`, false],
    [noreply('12345', '-bad'), false],
    [noreply('12', 'a b'), false],
    [OTHER_BOT, false],
    [noreply('49699334', 'dependabot[bot]'), false],
    [SUPPORT, false],
    [PERSONAL, false],
  ])('address %s allowed: %s', (address, ok) => {
    expect(allowedAddress(address)).toBe(ok);
  });

  it('builds the accepted co-author values from their parts', () => {
    expect(CO_AUTHOR).toBe(CO);
    expect(DEPENDABOT_CO_AUTHOR).toBe(`dependabot[bot] <${DEPENDABOT}>`);
  });

  it('passes noreply authors and committers, the co-author trailer (also twice) and a web merge', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.commit(`one\n\nCo-Authored-By: ${CO}`);
    r.commit(`squashed\n\nco-authored-by: ${CO}\nCo-Authored-By: ${CO}`);
    r.commit('no trailer at all');
    r.commit('merge from the web', DEV, GITHUB);
    const commits = listCommits(base, 'HEAD', { cwd: r.repo, env: r.env });
    expect(commits.map((c) => c.subject)).toEqual(['one', 'squashed', 'no trailer at all', 'merge from the web']);
    expect(checkCommits(commits, { cwd: r.repo, env: r.env })).toEqual([]);
  });

  it('passes a realistic Dependabot commit: the YAML block is not read as trailers', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.commit(DEPENDABOT_MESSAGE, DEPENDABOT, GITHUB);
    r.commit(DEPENDABOT_MESSAGE, DEPENDABOT, DEPENDABOT);
    expect(parseTrailers(DEPENDABOT_MESSAGE, { env: r.env })).toEqual([
      { key: 'Signed-off-by', value: `dependabot[bot] <${SUPPORT}>` },
    ]);
    expect(rules(r, base, 'HEAD')).toEqual([]);
  });

  it('does not read a YAML block as trailers when it ends the message', () => {
    const yamlLast = DEPENDABOT_MESSAGE.split('\n\nSigned-off-by')[0] ?? '';
    const r = tempRepo();
    expect(parseTrailers(yamlLast, { env: r.env })).toEqual([]);
  });

  it('rejects a personal author address', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit('oops', PERSONAL, DEV);
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} author`]);
  });

  it('rejects a personal committer address even when the author is fine', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit('oops', DEV, PERSONAL);
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} committer`]);
  });

  it('rejects any bot but Dependabot as author, committer or in the message', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const author = r.commit('by a bot', OTHER_BOT, DEV);
    const committer = r.commit('committed by a bot', DEV, OTHER_BOT);
    const message = r.commit(`mentions a bot\n\nReported by ${OTHER_BOT}.`);
    expect(rules(r, base, 'HEAD')).toEqual([
      `${author.slice(0, 7)} author`,
      `${committer.slice(0, 7)} committer`,
      `${message.slice(0, 7)} message`,
    ]);
    const res = spawnSync(process.execPath, [SCRIPT, base, 'HEAD'], { cwd: r.repo, env: r.env, encoding: 'utf8' });
    expect(res.stderr).toContain('is a bot address, and only Dependabot is accepted');
  });

  it('rejects an address anywhere in the message: body or subject', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const body = r.commit(`body\n\nThe old address ${PERSONAL} is gone.`);
    const subject = r.commit(`Write to ${PERSONAL}`);
    expect(rules(r, base, 'HEAD')).toEqual([`${body.slice(0, 7)} message`, `${subject.slice(0, 7)} message`]);
  });

  it.each([
    ['another account', `Helper <${HELPER}>`, ['trailer']],
    ['the right name with another address', `xevbor <${HELPER}>`, ['trailer']],
    ['another name with the right address', `Someone <${noreply('310343018', 'xevbor')}>`, ['trailer']],
    ['no address', 'xevbor', ['trailer']],
    ['an empty value', '', ['trailer']],
    ['a personal address', `Someone <${PERSONAL}>`, ['trailer', 'message']],
    ["GitHub's support address", `dependabot[bot] <${SUPPORT}>`, ['trailer', 'message']],
  ])('rejects a Co-Authored-By trailer with %s', (_what, value, expected) => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit(`change\n\nCo-Authored-By: ${value}`.trimEnd());
    expect(rules(r, base, 'HEAD')).toEqual(expected.map((rule) => `${bad.slice(0, 7)} ${rule}`));
  });

  /**
   * GitHub's squash commit of a Dependabot pull request: the pull request number
   * in the subject, Dependabot's sign-off, then the given trailer line.
   * @param {string} line
   */
  const squashedDependabot = (line) => `${DEPENDABOT_MESSAGE.replace(/^[^\n]*/, (subject) => `${subject} (#16)`)}\n${line}`;

  it("passes GitHub's squash of a Dependabot pull request: Dependabot as co-author of its own commit", () => {
    const r = tempRepo();
    const base = r.commit('base');
    const message = squashedDependabot(`Co-authored-by: dependabot[bot] <${DEPENDABOT}>`);
    r.commit(message, DEPENDABOT, GITHUB);
    expect(parseTrailers(message, { env: r.env })).toEqual([
      { key: 'Signed-off-by', value: `dependabot[bot] <${SUPPORT}>` },
      { key: 'Co-authored-by', value: `dependabot[bot] <${DEPENDABOT}>` },
    ]);
    expect(rules(r, base, 'HEAD')).toEqual([]);
  });

  const EXACT = `Co-authored-by: dependabot[bot] <${DEPENDABOT}>`;
  it.each([
    ['another account id', `Co-authored-by: dependabot[bot] <${noreply('49699334', 'dependabot[bot]')}>`, DEPENDABOT, GITHUB, ['trailer', 'message']],
    ['another name with the right address', `Co-authored-by: Dependabot <${DEPENDABOT}>`, DEPENDABOT, GITHUB, ['trailer']],
    ['the name without "[bot]"', `Co-authored-by: dependabot <${DEPENDABOT}>`, DEPENDABOT, GITHUB, ['trailer']],
    ['the right name with a personal address', `Co-authored-by: dependabot[bot] <${HELPER}>`, DEPENDABOT, GITHUB, ['trailer']],
    ['the right name with another bot address', `Co-authored-by: dependabot[bot] <${OTHER_BOT}>`, DEPENDABOT, GITHUB, ['trailer', 'message']],
    ["the right name with GitHub's support address", `Co-authored-by: dependabot[bot] <${SUPPORT}>`, DEPENDABOT, GITHUB, ['trailer', 'message']],
    ['the address in another case', `Co-authored-by: dependabot[bot] <${DEPENDABOT.toUpperCase()}>`, DEPENDABOT, GITHUB, ['trailer']],
    ['the value as a sign-off', `Signed-off-by: dependabot[bot] <${DEPENDABOT}>`, DEPENDABOT, GITHUB, ['trailer']],
    ["the exact trailer on a developer's commit", EXACT, DEV, GITHUB, ['trailer']],
    ["the exact trailer on a developer's commit that Dependabot committed", EXACT, DEV, DEPENDABOT, ['trailer']],
    ["the exact trailer on a commit by Dependabot's address in another case", EXACT, DEPENDABOT.toUpperCase(), GITHUB, ['trailer']],
  ])('refuses a look-alike of the Dependabot co-author trailer: %s', (_what, line, author, committer, expected) => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit(squashedDependabot(line), author, committer);
    expect(rules(r, base, 'HEAD')).toEqual(expected.map((rule) => `${bad.slice(0, 7)} ${rule}`));
  });

  it('rejects a co-author line that git does not read as a trailer', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit(`change\n\nSome prose.\nCo-Authored-By: Helper <${HELPER}>\nMore prose.\n\nCo-Authored-By: ${CO}`);
    expect(parseTrailers(`x\n\nSome prose.\nCo-Authored-By: Helper <${HELPER}>\nMore prose.`, { env: r.env })).toEqual([]);
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} trailer`]);
  });

  it.each([
    ['a developer', `Dev <${DEV}>`, ['trailer']],
    ['the co-author account', CO, ['trailer']],
    ['no address', 'dependabot[bot]', ['trailer']],
    ["GitHub's support address under another name", `Someone <${SUPPORT}>`, ['trailer', 'message']],
  ])('accepts Signed-off-by only from Dependabot: refuses %s', (_what, value, expected) => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit(`change\n\nSigned-off-by: ${value}`);
    expect(rules(r, base, 'HEAD')).toEqual(expected.map((rule) => `${bad.slice(0, 7)} ${rule}`));
  });

  it('allows the support address only in the Dependabot sign-off', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const prose = r.commit(`prose\n\nAsk ${SUPPORT}.\n\nSigned-off-by: dependabot[bot] <${SUPPORT}>`);
    expect(rules(r, base, 'HEAD')).toEqual([`${prose.slice(0, 7)} message`]);
  });

  it.each(['Reviewed-by: Dev', `Acked-by: Dev <${DEV}>`, 'Change-Id: I0123456789abcdef', 'Note: see the issue'])(
    'rejects a foreign trailer key: %s',
    (trailer) => {
      const r = tempRepo();
      const base = r.commit('base');
      const bad = r.commit(`change\n\n${trailer}\nCo-Authored-By: ${CO}`);
      expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} trailer`]);
    },
  );

  it.each([
    ['robot and link', `${ROBOT} ${words('Generated', 'with')} [Some Tool](https://example.com/tool)`, ['footer']],
    ['"by" at the start', `${words('Generated', 'by')} a script`, ['footer']],
    ['lower case in emphasis', `_${words('generated', 'with')} some tool_`, ['footer']],
    ['written like a trailer', `${['Generated', 'by'].join('-')}: some tool`, ['footer']],
    ['a robot alone', `Done ${ROBOT}`, ['footer']],
  ])('rejects a generated-by footer line: %s', (_what, line, expected) => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit(`change\n\nBody.\n\n${line}\n\nCo-Authored-By: ${CO}`);
    expect(rules(r, base, 'HEAD')).toEqual(expected.map((rule) => `${bad.slice(0, 7)} ${rule}`));
  });

  it('rejects a generated-by trailer twice: as a foreign key and as a footer', () => {
    const r = tempRepo();
    const base = r.commit('base');
    const bad = r.commit(`change\n\n${['Generated', 'by'].join('-')}: some tool\nCo-Authored-By: ${CO}`);
    expect(rules(r, base, 'HEAD')).toEqual([`${bad.slice(0, 7)} trailer`, `${bad.slice(0, 7)} footer`]);
  });

  it('does not take ordinary prose for a footer', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.commit(`Regenerated the lockfile with npm\n\nThe hash is ${words('generated', 'by')} the store.`);
    expect(rules(r, base, 'HEAD')).toEqual([]);
  });

  it('checks only the range, not the commits before base', () => {
    const r = tempRepo();
    r.commit('old', PERSONAL, DEV);
    const base = r.commit('base');
    r.commit('new');
    expect(rules(r, base, 'HEAD')).toEqual([]);
  });

  it('checks the whole history when base is all zeros', () => {
    const r = tempRepo();
    const old = r.commit('old', PERSONAL, DEV);
    r.commit('new');
    expect(rules(r, ZERO, 'HEAD')).toEqual([`${old.slice(0, 7)} author`]);
  });

  it('checks commits that arrive through a merge', () => {
    const r = tempRepo();
    const base = r.commit('base');
    r.git(['checkout', '--quiet', '-b', 'side']);
    const bad = r.commit('side', PERSONAL, DEV);
    r.git(['checkout', '--quiet', 'main']);
    r.commit('main');
    r.git(['-c', 'commit.gpgsign=false', 'merge', '--quiet', '--no-ff', '--no-edit', 'side'], {
      GIT_AUTHOR_NAME: 'A',
      GIT_AUTHOR_EMAIL: DEV,
      GIT_COMMITTER_NAME: 'C',
      GIT_COMMITTER_EMAIL: DEV,
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

    it('exits 1 and names the commit and the problem', () => {
      const r = tempRepo();
      const base = r.commit('base');
      r.commit('leak', PERSONAL, DEV);
      r.commit('tool\n\nReviewed-by: Dev');
      r.commit(`helped\n\nCo-Authored-By: Helper <${HELPER}>`);
      r.commit(`footer\n\n${words('Generated', 'by')} a script`);
      const res = run(r, [base, 'HEAD']);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(`"leak": author e-mail <${PERSONAL}> is not a GitHub noreply address`);
      expect(res.stderr).toContain('"tool": trailer "Reviewed-by" is not allowed');
      expect(res.stderr).toContain(`"helped": trailer "Co-Authored-By: Helper <${HELPER}>" is not accepted: co-author trailers are not accepted`);
      expect(res.stderr).toContain('"footer": line 3 looks like a generated-by footer');
      expect(res.stderr).toContain('docs/contributing.md, section "Commits"');
    });

    it('exits 2 without arguments or with an unknown revision', () => {
      const r = tempRepo();
      r.commit('base');
      expect(run(r, []).status).toBe(2);
      expect(run(r, ['no-such-ref', 'HEAD']).status).toBe(2);
    });
  });
});
