import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/*
 * Tests of .github/workflows/ci.yml: when the deploy job runs, what a run
 * started by hand (workflow_dispatch) checks, and how the secret scan reads
 * the history. The file is read as text (the project has no YAML parser, and
 * the audit job installs none); the helpers below know only the layout of
 * this file: two spaces per level, `- name:` first in every step, shell
 * scripts as `run: |` blocks.
 */
const WORKFLOW = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
const LINES = WORKFLOW.split('\n');
const ZEROS = '0'.repeat(40);

/** @param {string} line */
const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The first line that `isHeader` accepts and the lines below it, up to the next
 * non-blank line indented as far or less.
 * @param {string[]} lines
 * @param {(line: string) => boolean} isHeader
 * @param {string} what for the error message
 */
function block(lines, isHeader, what) {
  const start = lines.findIndex(isHeader);
  if (start === -1) throw new Error(`ci.yml: ${what} not found`);
  const indent = indentOf(lines[start] ?? '');
  const end = lines.findIndex((l, i) => i > start && l.trim() !== '' && indentOf(l) <= indent);
  return lines.slice(start, end === -1 ? lines.length : end);
}

/** @param {string} name */
const job = (name) => block(LINES, (l) => l === `  ${name}:`, `job ${name}`);

/**
 * @param {string[]} jobLines
 * @param {string} namePrefix
 */
const step = (jobLines, namePrefix) => block(jobLines, (l) => l.startsWith(`      - name: ${namePrefix}`), `step "${namePrefix}"`);

/**
 * The value of `key: value` among `lines`, the first match.
 * @param {string[]} lines
 * @param {string} key
 */
function value(lines, key) {
  const line = lines.find((l) => l.trimStart().startsWith(`${key}: `));
  if (line === undefined) throw new Error(`ci.yml: no "${key}:" in ${lines[0]?.trim()}`);
  return line.slice(line.indexOf(':') + 1).trim();
}

/** The expression inside `${{ }}`, or the text itself (an `if:` may leave the braces out). @param {string} text */
const unwrap = (text) => /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(text)?.[1] ?? text;

/**
 * The shell script of a step's `run: |` block, dedented.
 * @param {string[]} stepLines
 */
function runScript(stepLines) {
  const at = stepLines.findIndex((l) => /^\s+run: \|$/.test(l));
  if (at === -1) throw new Error(`ci.yml: step ${stepLines[0]?.trim()} has no "run: |" block`);
  const runIndent = indentOf(stepLines[at] ?? '');
  /** @type {string[]} */
  const body = [];
  for (const l of stepLines.slice(at + 1)) {
    if (l.trim() !== '' && indentOf(l) <= runIndent) break;
    body.push(l);
  }
  const cut = Math.min(...body.filter((l) => l.trim() !== '').map(indentOf));
  return body.map((l) => l.slice(cut)).join('\n');
}

/**
 * Every line under `jobs:` that `keyRe` matches, with its job, its step (by
 * name; null for a key of the job itself) and the text after the first colon.
 * @param {RegExp} keyRe
 */
function keyLines(keyRe) {
  /** @type {{ job: string, step: string | null, value: string }[]} */
  const found = [];
  let jobName = '';
  /** @type {string | null} */
  let stepName = null;
  for (const line of LINES.slice(LINES.indexOf('jobs:'))) {
    const j = /^ {2}([A-Za-z0-9_-]+):$/.exec(line);
    if (j) {
      jobName = j[1] ?? '';
      stepName = null;
      continue;
    }
    const s = /^ {6}- name: (.+)$/.exec(line);
    if (s) stepName = s[1] ?? null;
    if (keyRe.test(line)) {
      found.push({ job: jobName, step: indentOf(line) <= 4 ? null : stepName, value: line.slice(line.indexOf(':') + 1).trim() });
    }
  }
  return found;
}

/*
 * A small evaluator for the expressions used here, with GitHub's documented
 * rules ("Expressions" in the Actions reference): `==` compares strings without
 * regard to case; values of different types are compared as numbers (null is 0,
 * false 0, true 1, a string its JSON number or NaN, an object NaN); a missing
 * property is null; `&&` and `||` return one of their operands. Supported:
 * context paths, string literals, true, false, null, ==, !=, !, &&, || and
 * parentheses. Anything else (a function call such as always()) is an error.
 */

/** @typedef {null | boolean | number | string | { [key: string]: Value }} Value */
/** @typedef {{ kind: 'op' | 'str' | 'name', text: string }} Token */

/** @param {Value} v */
const typeName = (v) => (v === null ? 'null' : typeof v);

/** @param {Value} v */
function toNumber(v) {
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v === '') return 0;
    return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) ? Number(v) : NaN;
  }
  return NaN;
}

/** @param {Value} a @param {Value} b */
function equal(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeName(a) === typeName(b)) return a === b;
  return toNumber(a) === toNumber(b);
}

/** @param {Value} v */
const truthy = (v) => !(v === null || v === false || v === 0 || v === '' || (typeof v === 'number' && Number.isNaN(v)));

/** @param {string} expr */
function tokenize(expr) {
  /** @type {Token[]} */
  const tokens = [];
  const re = /\s*(?:(\|\||&&|==|!=|!|\(|\))|'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_.-]*))/y;
  let i = 0;
  while (expr.slice(i).trim() !== '') {
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m) throw new Error(`cannot read the expression at: ${expr.slice(i)}`);
    if (m[1] !== undefined) tokens.push({ kind: 'op', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'str', text: m[2].replaceAll("''", "'") });
    else tokens.push({ kind: 'name', text: m[3] ?? '' });
    i = re.lastIndex;
  }
  return tokens;
}

/**
 * @param {string} expr
 * @param {{ [key: string]: Value }} context
 * @returns {Value}
 */
function evaluate(expr, context) {
  const tokens = tokenize(expr);
  let pos = 0;
  /** @param {string} op */
  const isOp = (op) => tokens[pos]?.kind === 'op' && tokens[pos]?.text === op;

  /** @returns {Value} */
  function or() {
    let v = and();
    while (isOp('||')) {
      pos++;
      const r = and();
      v = truthy(v) ? v : r;
    }
    return v;
  }
  /** @returns {Value} */
  function and() {
    let v = eq();
    while (isOp('&&')) {
      pos++;
      const r = eq();
      v = truthy(v) ? r : v;
    }
    return v;
  }
  /** @returns {Value} */
  function eq() {
    let v = unary();
    while (isOp('==') || isOp('!=')) {
      const negate = tokens[pos++]?.text === '!=';
      const same = equal(v, unary());
      v = negate ? !same : same;
    }
    return v;
  }
  /** @returns {Value} */
  function unary() {
    if (!isOp('!')) return primary();
    pos++;
    return !truthy(unary());
  }
  /** @returns {Value} */
  function primary() {
    const t = tokens[pos++];
    if (t === undefined) throw new Error(`the expression ends too early: ${expr}`);
    if (t.kind === 'str') return t.text;
    if (t.kind === 'op' && t.text === '(') {
      const v = or();
      if (!isOp(')')) throw new Error(`missing ")" in: ${expr}`);
      pos++;
      return v;
    }
    if (t.kind === 'name') {
      if (t.text === 'true') return true;
      if (t.text === 'false') return false;
      if (t.text === 'null') return null;
      /** @type {Value | undefined} */
      let v = context;
      for (const key of t.text.split('.')) v = v !== null && typeof v === 'object' ? v[key] : undefined;
      return v ?? null;
    }
    throw new Error(`unexpected "${t.text}" in: ${expr}`);
  }

  const result = or();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos]?.text}" in: ${expr}`);
  return result;
}

/**
 * The context of a run, as far as the conditions here read it.
 * @param {string} event
 * @param {string} ref
 * @param {{ [key: string]: Value } | null} repository the event's repository object; null: the event has none
 */
const runContext = (event, ref, repository) => ({
  github: { event_name: event, ref, event: repository === null ? {} : { repository } },
});

const PUBLIC = { private: false, visibility: 'public' };
const PRIVATE = { private: true, visibility: 'private' };

/**
 * Runs a step's script as GitHub runs `shell: bash`, with only the given
 * environment (none of the test runner's own GITHUB_* variables), an `npm`
 * that prints its arguments instead of running, a `gitleaks` that prints each
 * of its arguments in brackets, a `node` that does the same and exits with
 * $NODE_EXIT (default 0), and a `gh` that prints its arguments to stderr,
 * then $GH_OUTPUT to stdout, and exits with $GH_EXIT (default 0).
 * @param {string} script
 * @param {Record<string, string>} env
 * @param {string} [cwd] the folder it runs in (default: this process's)
 */
function runStep(script, env, cwd) {
  const res = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd,
    env: { PATH: `${stubDir()}:${process.env.PATH ?? ''}`, ...env },
    encoding: 'utf8',
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}`.trim() };
}

/** @type {string | undefined} */
let stub;
function stubDir() {
  if (stub === undefined) {
    stub = mkdtempSync(join(tmpdir(), 'check-workflow-'));
    writeFileSync(join(stub, 'npm'), '#!/bin/sh\necho "npm $*"\n', { mode: 0o755 });
    writeFileSync(join(stub, 'gitleaks'), '#!/bin/sh\nprintf gitleaks\nprintf \' [%s]\' "$@"\necho\n', { mode: 0o755 });
    writeFileSync(join(stub, 'node'), '#!/bin/sh\nprintf node\nprintf \' [%s]\' "$@"\necho\nexit "${NODE_EXIT:-0}"\n', { mode: 0o755 });
    writeFileSync(join(stub, 'gh'), '#!/bin/sh\n{ printf gh; printf \' [%s]\' "$@"; echo; } >&2\nprintf \'%s\' "$GH_OUTPUT"\nexit "${GH_EXIT:-0}"\n', {
      mode: 0o755,
    });
  }
  return stub;
}
afterAll(() => {
  if (stub !== undefined) rmSync(stub, { recursive: true, force: true });
});

describe('the expression evaluator follows GitHub rules', () => {
  it.each([
    ["'Main' == 'main'", true],
    ['null == false', true],
    ["null == 'public'", false],
    ["'0' == false", true],
    ["!('a' == 'b') && 'x'", 'x'],
    ["false || 'y'", 'y'],
    ['github.event.repository.private == false', true],
  ])('%s gives %s', (expr, expected) => {
    expect(evaluate(expr, runContext('push', 'refs/heads/main', null))).toBe(expected);
  });

  it('refuses what it does not know', () => {
    expect(() => evaluate('always() && true', {})).toThrow(/unexpected/);
    expect(() => evaluate("a == 'b", {})).toThrow(/cannot read/);
  });
});

describe('the workflow starts on pull requests, pushes to main and by hand', () => {
  const on = block(LINES, (l) => l === 'on:', 'on:');

  it('has exactly these triggers', () => {
    const triggers = on.filter((l) => /^ {2}[a-z_]+:/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
    expect(triggers).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(value(block(on, (l) => l === '  push:', 'push'), 'branches')).toBe('[main]');
  });

  it('a run started by hand takes no inputs', () => {
    const dispatch = block(on, (l) => l === '  workflow_dispatch:', 'workflow_dispatch');
    expect(dispatch.slice(1).filter((l) => l.trim() !== '')).toEqual([]);
  });
});

describe('deploy job', () => {
  const deploy = job('deploy');
  const condition = unwrap(value(deploy, 'if'));
  /** @param {string} event @param {string} ref @param {{ [key: string]: Value } | null} repository */
  const deploys = (event, ref, repository) => truthy(evaluate(condition, runContext(event, ref, repository)));

  it('runs only after the audit, the end-to-end and the collector jobs pass', () => {
    expect(value(deploy, 'needs')).toBe('[audit, e2e, collector]');
    // Without a status function GitHub adds success(): every needed job passed.
    expect(condition).not.toMatch(/\b(?:always|success|failure|cancelled)\s*\(/);
  });

  it.each(['push', 'workflow_dispatch'])('%s: deploys from main of a public repository, and only then', (event) => {
    expect(deploys(event, 'refs/heads/main', PUBLIC)).toBe(true);
    expect(deploys(event, 'refs/heads/main', PRIVATE)).toBe(false);
    expect(deploys(event, 'refs/heads/feature', PUBLIC)).toBe(false);
    expect(deploys(event, 'refs/tags/main', PUBLIC)).toBe(false);
  });

  it('deploys for no other combination of event, ref and repository', () => {
    const events = ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target', 'schedule', 'release', 'workflow_run'];
    const refs = ['refs/heads/main', 'refs/heads/feature', 'refs/heads/main-old', 'refs/heads/x/main', 'refs/tags/main', 'refs/pull/1/merge'];
    /** @type {[string, { [key: string]: Value } | null][]} */
    const repositories = [
      ['public', PUBLIC],
      ['private', PRIVATE],
      ['internal', { private: true, visibility: 'internal' }],
      ['without a visibility field', { private: false }],
      ['no repository in the event', null],
    ];
    /** @type {string[]} */
    const wrong = [];
    for (const event of events) {
      for (const ref of refs) {
        for (const [name, repository] of repositories) {
          const expected = (event === 'push' || event === 'workflow_dispatch') && ref === 'refs/heads/main' && name === 'public';
          if (deploys(event, ref, repository) !== expected) wrong.push(`${event} ${ref} ${name}: expected ${expected}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('checks the ref exactly first, because the condition ignores case', () => {
    expect(deploys('workflow_dispatch', 'refs/heads/Main', PUBLIC)).toBe(true);
    const first = deploy.find((l) => l.startsWith('      - name: '));
    expect(first).toBe('      - name: Check that this run is for refs/heads/main exactly');
    const script = runScript(step(deploy, 'Check that this run is for refs/heads/main exactly'));
    expect(runStep(script, { GITHUB_REF: 'refs/heads/main' })).toEqual({ status: 0, out: '' });
    for (const ref of ['refs/heads/Main', 'refs/heads/MAIN', 'refs/heads/main2', 'refs/tags/main', '']) {
      const res = runStep(script, { GITHUB_REF: ref });
      expect(res.status, ref).toBe(1);
      expect(res.out, ref).toMatch(/^::error::/);
    }
  });

  it('only the deploy job may write, and nothing may start a run', () => {
    const grants = LINES.filter((l) => /^\s+[a-z-]+: write\b/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
    expect(grants.sort()).toEqual(['id-token', 'pages']);
    expect(deploy.filter((l) => /: write\b/.test(l)).length).toBe(2);
    expect(WORKFLOW).not.toMatch(/\bactions:\s*write\b/);
  });

  // A job without permissions of its own gets the top-level ones; without
  // those, it gets the repository's default token permissions, which can
  // include write access. The collector job states its own: contents: read.
  it('every other job may only read the repository contents', () => {
    const top = block(LINES, (l) => l === 'permissions:', 'top-level permissions');
    expect(top.filter((l) => l.trim() !== '')).toEqual(['permissions:', '  contents: read']);
    expect(keyLines(/^ {4}permissions\s*:/).map((k) => k.job)).toEqual(['collector', 'deploy']);
    const own = block(job('collector'), (l) => l === '    permissions:', 'collector permissions');
    expect(own.filter((l) => l.trim() !== '')).toEqual(['    permissions:', '      contents: read']);
  });

  it('is never cancelled while it runs', () => {
    const concurrency = block(deploy, (l) => l === '    concurrency:', 'deploy concurrency');
    expect(value(concurrency, 'cancel-in-progress')).toBe('false');
  });
});

describe('a failing check stops the deploy', () => {
  const deploy = job('deploy');
  const ARTIFACT_CHECK = 'Check that the Pages artifact is the one the audit job uploaded';

  // continue-on-error turns a failed step or job into a passing one, so a failed
  // check or test would no longer stop what comes after it. The build job counts
  // too: it runs the unit tests, these among them.
  it('nothing may fail without stopping the run, except the report-only audit of all dependencies', () => {
    expect(keyLines(/continue-on-error/)).toEqual([{ job: 'audit', step: 'npm audit - all dependencies (report only)', value: 'true' }]);
  });

  // A status function (always(), success(), failure(), cancelled()) in a
  // condition replaces the implicit success(): the step or job would run after
  // a failure. Any other condition can skip a check. So the workflow has exactly
  // two: the deploy job's own, and failure() on the step that keeps the
  // Playwright report, which runs only once the job has already failed.
  it('no condition lets a step or job run after a failure, or skips a check', () => {
    const condition = value(deploy, 'if');
    expect(condition).not.toMatch(/\b(?:always|success|failure|cancelled)\s*\(/);
    expect(keyLines(/^\s*(?:- )?if\s*:/)).toEqual([
      { job: 'e2e', step: 'Keep the Playwright report of a failed run', value: 'failure()' },
      { job: 'deploy', step: null, value: condition },
    ]);
  });

  // `|| true` and its like turn a failed command into a passing step.
  it('no script swallows a failure', () => {
    // The word must end where the shell ends it: at a blank, the end of the line, an operator or a redirection.
    const swallows = /\|\|\s*(?:true|:|exit\s+0)(?=\s|$|[;&|)}#\\<>])|\bset\s+\+[a-z]*e|\bset\s+\+o\s+errexit\b/;
    const caught = [
      'x || true',
      'x ||true',
      'x ||:',
      'x || :',
      'x || exit 0',
      'x || exit 0 # done',
      '{ x || true; }',
      'x || true && y',
      'x || true | tee log',
      'x ||true|tee log',
      'x || true &',
      'x || true \\',
      'x || true\\',
      'x || true>failed.log',
      'x || true<input',
      'x ||:>failed.log',
      'x || exit 0>failed.log',
      'set +e',
      'set +eo pipefail',
      'set +o errexit',
    ];
    for (const sample of caught) expect(sample, sample).toMatch(swallows);
    for (const sample of ['x || trueish', 'x || exit 1', 'x || exit 01', 'x || rc=$?', 'x || { echo failed; exit 1; }', 'set -e', 'set +x']) {
      expect(sample, sample).not.toMatch(swallows);
    }
    expect(LINES.filter((l) => swallows.test(l))).toEqual([]);
  });

  describe('the audit of the built site', () => {
    const script = runScript(step(job('audit'), 'Audit the built site'));
    const RUN = 'node [scripts/check-dist.mjs] [runner-temp/site] [package-lock.json]';
    /** @param {string} exit what check-dist exits with */
    const audit = (exit) => runStep(script, { RUNNER_TEMP: 'runner-temp', NODE_EXIT: exit }, stubDir());

    it('runs check-dist on the downloaded site with the lockfile of the checkout', () => {
      expect(audit('0')).toEqual({ status: 0, out: RUN });
    });

    it('fails when check-dist fails', () => {
      expect(audit('1')).toEqual({ status: 1, out: RUN });
    });
  });

  // The check compares the run's github-pages artifact with the id that the
  // audit job reported for its own upload. An id taken from any other job
  // would let that job choose what is deployed.
  it('compares with the id of the upload in the audit job', () => {
    const audit = job('audit');
    const outputs = block(audit, (l) => l === '    outputs:', 'audit outputs').filter((l) => l.trim() !== '');
    expect(outputs).toEqual(['    outputs:', '      pages-artifact-id: ${{ steps.pages-artifact.outputs.artifact_id }}']);
    const upload = step(audit, 'Upload the audited site as the Pages artifact');
    expect(value(upload, 'id')).toBe('pages-artifact');
    expect(value(upload, 'uses')).toMatch(/^actions\/upload-pages-artifact@[0-9a-f]{40} /);
    expect(LINES.filter((l) => /^\s+id:\s*pages-artifact\s*$/.test(l))).toHaveLength(1);
    expect(value(step(deploy, ARTIFACT_CHECK), 'EXPECTED_ID')).toBe('${{ needs.audit.outputs.pages-artifact-id }}');
  });

  // deploy-pages deploys the artifact its artifact_name input names, by default
  // github-pages: the name the check lists. Any other name would deploy an
  // artifact that the check never compared.
  it('deploys the artifact that the check compared: deploy-pages gets no inputs', () => {
    const lines = step(deploy, 'Deploy the artifact').filter((l) => l.trim() !== '');
    expect(lines.slice(1).map((l) => l.trim().replace(/:.*/, ''))).toEqual(['id', 'uses']);
    expect(value(lines, 'uses')).toMatch(/^actions\/deploy-pages@[0-9a-f]{40} /);
  });

  // The end-to-end tests must run on the files that are deployed. By name, the
  // download could get an artifact that another job of the run uploaded.
  it('the end-to-end job downloads the audited artifact by its id', () => {
    const e2e = job('e2e');
    expect(value(e2e, 'needs')).toBe('audit');
    const download = step(e2e, 'Download the audited site');
    expect(value(download, 'uses')).toMatch(/^actions\/download-artifact@[0-9a-f]{40} /);
    const inputs = block(download, (l) => l === '        with:', 'download inputs').slice(1);
    expect(inputs.filter((l) => l.trim() !== '').map((l) => l.trim())).toEqual([
      'artifact-ids: ${{ needs.audit.outputs.pages-artifact-id }}',
      'path: ${{ runner.temp }}/pages',
    ]);
  });

  it('runs its checks first and nothing between them and the deploy', () => {
    const names = deploy.filter((l) => l.startsWith('      - name: ')).map((l) => l.slice('      - name: '.length));
    expect(deploy.filter((l) => l.startsWith('      - ')).length).toBe(names.length);
    expect(names).toEqual([
      'Check that this run is for refs/heads/main exactly',
      ARTIFACT_CHECK,
      'Check the Pages settings',
      'Deploy the artifact that the audit job checked and e2e tested',
    ]);
  });

  // The github-pages environment is the one whose rules (only main may deploy)
  // are set in the repository settings; any other name would get an environment
  // without rules.
  it('deploys to the github-pages environment', () => {
    expect(LINES.filter((l) => /^\s*environment\s*:/.test(l))).toEqual(['    environment:']);
    expect(value(block(deploy, (l) => l === '    environment:', 'deploy environment'), 'name')).toBe('github-pages');
  });

  describe('the artifact check', () => {
    const script = runScript(step(deploy, ARTIFACT_CHECK));
    /** @param {string} expected @param {string} listed @param {string} [ghExit] */
    const check = (expected, listed, ghExit = '0') =>
      runStep(script, {
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '42',
        GH_TOKEN: 'token',
        EXPECTED_ID: expected,
        GH_OUTPUT: listed,
        GH_EXIT: ghExit,
      });

    it('asks for the github-pages artifacts of this run', () => {
      expect(check('101', '101').out).toContain(
        'gh [api] [repos/owner/repo/actions/runs/42/artifacts?name=github-pages&per_page=100] [--jq] [[.artifacts[] | select(.name == "github-pages") | .id | tostring] | join(" ")]',
      );
    });

    it('passes when the run holds exactly the artifact the audit job uploaded', () => {
      const res = check('101', '101');
      expect(res.status).toBe(0);
      expect(res.out).toContain('the audit job uploaded artifact 101; this run has: 101');
      expect(res.out).not.toContain('::error::');
    });

    it.each([
      ['no artifact in the run', '101', ''],
      ['two artifacts, one of them the audited one', '101', '101 202'],
      ['two artifacts, the audited one second', '101', '202 101'],
      ['a different artifact', '101', '202'],
      ['no id from the audit job, no artifact', '', ''],
      ['no id from the audit job, one artifact', '', '101'],
    ])('refuses: %s', (_case, expected, listed) => {
      const res = check(expected, listed);
      expect(res.status).toBe(1);
      expect(res.out).toContain('::error::the github-pages artifact is not the one the audit job uploaded; not deploying');
    });

    it('stops when the artifact list cannot be read', () => {
      const res = check('101', '101', '1');
      expect(res.status).toBe(1);
      expect(res.out).not.toContain('this run has');
    });
  });
});

describe('a run on main is never cancelled by a newer one', () => {
  const concurrency = block(LINES, (l) => l === 'concurrency:', 'concurrency:');
  const cancel = unwrap(value(concurrency, 'cancel-in-progress'));

  it.each([
    ['pull_request', 'refs/pull/1/merge', true],
    ['push', 'refs/heads/main', false],
    ['workflow_dispatch', 'refs/heads/main', false],
    ['workflow_dispatch', 'refs/heads/feature', false],
  ])('%s on %s: cancel-in-progress is %s', (event, ref, expected) => {
    expect(truthy(evaluate(cancel, runContext(event, ref, PUBLIC)))).toBe(expected);
  });

  it('push runs and runs started by hand on main share one group', () => {
    expect(value(concurrency, 'group')).toBe('ci-${{ github.ref }}');
  });
});

describe('history checks in the audit job', () => {
  const audit = job('audit');
  const steps = [
    { name: 'Repository holds only listed files', run: 'npm run check:tree -- --range' },
    { name: 'Commit addresses and trailers', run: 'npm run check:commits --' },
  ];

  it.each(steps)('$name: a pull request checks its own range', ({ name, run }) => {
    const script = runScript(step(audit, name));
    expect(runStep(script, { EVENT: 'pull_request', PR_BASE: 'base1', PR_HEAD: 'head1', RUN_SHA: 'run1' })).toEqual({
      status: 0,
      out: `${run} base1 head1`,
    });
  });

  it.each(steps)('$name: a push and a run started by hand check the whole history of the run commit', ({ name, run }) => {
    const lines = step(audit, name);
    expect(value(lines, 'RUN_SHA')).toBe('${{ github.sha }}');
    const script = runScript(lines);
    for (const event of ['push', 'workflow_dispatch']) {
      expect(runStep(script, { EVENT: event, PR_BASE: '', PR_HEAD: '', RUN_SHA: 'run1' }), event).toEqual({
        status: 0,
        out: `${run} ${ZEROS} run1`,
      });
    }
  });

  it.each(steps)('$name: any other event fails instead of guessing a range', ({ name }) => {
    const res = runStep(runScript(step(audit, name)), { EVENT: 'schedule', PR_BASE: '', PR_HEAD: '', RUN_SHA: 'run1' });
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/^::error::no (?:history|commit) range is defined for the event schedule$/);
  });
});

describe('secret scan of the history in the audit job', () => {
  // `git log -p`, which gitleaks runs, shows no diff for a merge commit unless
  // asked, so what a merge resolution added would never be scanned.
  it('reads every commit, merge commits as their changes against the first parent', () => {
    const res = runStep(runScript(step(job('audit'), 'Secret scan - full git history')), {});
    expect(res).toEqual({
      status: 0,
      out: [
        'gitleaks [git] [--no-banner] [--redact] [--ignore-gitleaks-allow] [--log-opts=--all --full-history --diff-merges=first-parent] [.]',
        'gitleaks [dir] [--no-banner] [--redact] [--ignore-gitleaks-allow] [.]',
      ].join('\n'),
    });
  });
});

describe('every action is pinned', () => {
  // A tag can be moved to other code; a full commit hash cannot.
  it('uses each action by a full commit hash, with its version in a comment', () => {
    const uses = LINES.filter((l) => /^\s+(?:- )?uses\s*:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line, line).toMatch(/^\s+(?:- )?uses: [a-z-]+\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});

// check:data is the second check of the collector's emitted files. The audit job
// is a required check and installs nothing, so the check runs there, on the
// job's own checkout, before the job takes anything from the build job.
describe('the data check in the audit job', () => {
  const audit = job('audit');
  const names = audit.filter((l) => l.startsWith('      - name: ')).map((l) => l.slice('      - name: '.length));
  const NAME = 'Data the site reads holds only its grammar (check:data)';

  it('runs check:data, and nothing else, in a step of its own', () => {
    expect(value(step(audit, NAME), 'run')).toBe('npm run check:data');
    expect(LINES.filter((l) => /\brun:.*check[:-]data/.test(l)).map((l) => l.trim())).toEqual(['run: npm run check:data']);
  });

  it('runs before the job downloads the built site', () => {
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf('No dependencies in this job'));
    expect(names.indexOf(NAME)).toBeLessThan(names.indexOf('Download the built site (untrusted input)'));
  });

  it('is a check that package.json runs with node and the script alone', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['check:data']).toBe('node scripts/check-data.mjs');
  });
});

describe('collector job', () => {
  const collector = job('collector');
  const names = collector.filter((l) => l.startsWith('      - name: ')).map((l) => l.slice('      - name: '.length));

  it('is named for the required checks and needs no other job', () => {
    expect(value(collector, 'name')).toBe('Collector (offline)');
    expect(collector.some((l) => /^\s+needs\s*:/.test(l))).toBe(false);
  });

  it('checks out, sets up the pinned Python and runs the tests, the self-test and emit --check on both sets, and nothing else', () => {
    expect(collector.filter((l) => l.startsWith('      - ')).length).toBe(names.length);
    expect(names).toEqual([
      'Check out',
      'Set up Python from collector/.python-version (no package cache)',
      'Unit tests (standard library only)',
      'Self-test of the gate (every planted sample refused)',
      'Emitted fixture matches its inputs (emit --check)',
      'Site data file matches its inputs (emit --check --set site)',
    ]);
    const runs = names.slice(2).map((name) => value(step(collector, name), 'run'));
    expect(runs).toEqual([
      'python -I -S -B -m unittest discover -s collector/tests -t collector -v',
      'python -I -S -B collector/run.py selftest',
      'python -I -S -B collector/run.py emit --check --set fixture',
      'python -I -S -B collector/run.py emit --check --set site',
    ]);
  });

  it('keeps no credentials and takes the Python version from the collector, without a package cache', () => {
    const checkout = step(collector, 'Check out');
    expect(value(checkout, 'uses')).toBe(value(step(job('build'), 'Check out'), 'uses'));
    expect(value(checkout, 'persist-credentials')).toBe('false');
    const python = step(collector, 'Set up Python');
    expect(value(python, 'uses')).toMatch(/^actions\/setup-python@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    const inputs = block(python, (l) => l === '        with:', 'setup-python inputs').slice(1);
    expect(inputs.filter((l) => l.trim() !== '').map((l) => l.trim())).toEqual(['python-version-file: collector/.python-version']);
  });

  it('installs no package and fetches nothing', () => {
    for (const line of collector) expect(line, line).not.toMatch(/\b(?:pip|pipx|uv|poetry|requirements|curl|wget)\b|https?:/);
  });
});
