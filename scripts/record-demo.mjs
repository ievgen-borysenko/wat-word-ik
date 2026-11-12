#!/usr/bin/env node
// Records docs/demo.gif, the animation at the top of the README, from the
// built site. CI does not run it: run it by hand after a visible change to the
// page and look at the result before committing it.
//
// It serves dist/ on 127.0.0.1 (a port the system picks), opens the page in
// Chromium through Playwright at the desktop size of the end-to-end tests
// (1280x800), in English, and plays a fixed scenario with the mouse (see
// `scenario` below). After every step it waits until the page's animations
// have finished and takes a screenshot, and every screenshot is shown for a
// fixed time, so the same build gives the same frames. Headless Chromium draws
// no mouse pointer, so an arrow is added to the page that follows the mouse.
// It is styled through the CSSOM (element.style), which the page's
// Content-Security-Policy allows: the page runs unchanged, under its own
// policy, and any console error, page error or unexpected request fails the
// recording. ffmpeg then scales the frames down to 880 pixels wide (the README
// column on github.com), builds one palette of 256 colours for the whole
// animation and writes the GIF without metadata. The result must pass the
// parse of check:tree (parseGif in scripts/check-tree.mjs) and show every
// recorded frame for its time before it replaces the output file.
//
// Needs: the built site (npm run build), Chromium for the installed Playwright
// (npx playwright install chromium, once), and ffmpeg on PATH.
// Usage: node scripts/record-demo.mjs [output]   (default: docs/demo.gif)
// Exit codes: 0 written and checked; 1 the recording failed or its result did
// not pass the checks (the output file is left as it was); 2 something it
// needs is missing (dist/, Chromium, ffmpeg) or the arguments are wrong; 130,
// 143 or 129 stopped by SIGINT (Ctrl-C), SIGTERM or SIGHUP. Whatever the
// exit, the temporary folder with the screenshots is removed (SIGKILL aside).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { parseGif } from './check-tree.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ file: string, cs: number, png: Buffer }} Frame */

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const DEFAULT_OUT = join(ROOT, 'docs', 'demo.gif');

/** The desktop size of the end-to-end tests: the sliders and the whole building fit without scrolling. */
const VIEWPORT = { width: 1280, height: 800 };
/** Screenshots at twice the pixels, scaled down once by ffmpeg: sharper text than a 1:1 capture. */
const DEVICE_SCALE = 2;
const OUT_WIDTH = 880;
/** How long one frame of movement shows, in hundredths of a second (about 11 frames per second). */
const STEP_CS = 9;

/** Grades at the start: middling, with Maths weak. Every other subject is 7. */
const START_MATHS = 4;
const START_OTHERS = 7;
/** Maths goes up to this grade, then Dutch goes down to this one. */
const MATHS_TO = 8;
const DUTCH_TO = 4;
/** The profession whose card closes the animation: it needs Dutch 7. */
const PROFESSION = 'leraar-basisonderwijs';

/** Something the recording needs is missing: exit 2. */
class Prerequisite extends Error {}

/** @param {string} command @param {string[]} args */
function run(command, args, cwd = ROOT) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function preflight() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Prerequisite('dist/index.html not found: build the site first (npm run build)');
  }
  const assets = join(DIST, 'assets');
  if (!existsSync(assets) || readdirSync(assets).length === 0) {
    throw new Prerequisite('dist/assets/ is missing or empty: build the site first (npm run build)');
  }
  const version = run('ffmpeg', ['-hide_banner', '-version']);
  if (version.error) throw new Prerequisite(`ffmpeg is not on PATH (${version.error.message}); install ffmpeg first`);
  if (version.status !== 0) throw new Prerequisite(`ffmpeg -version failed: ${version.stderr.trim()}`);
  const filters = run('ffmpeg', ['-hide_banner', '-filters']).stdout ?? '';
  const encoders = run('ffmpeg', ['-hide_banner', '-encoders']).stdout ?? '';
  for (const name of ['scale', 'palettegen', 'paletteuse']) {
    if (!new RegExp(`\\s${name}\\s`).test(filters)) throw new Prerequisite(`this ffmpeg has no ${name} filter`);
  }
  if (!/\sgif\s/.test(encoders)) throw new Prerequisite('this ffmpeg has no GIF encoder');
}

/**
 * Serves the files of dist/ on 127.0.0.1, read once at the start. Anything
 * else the browser asks for gets a 404 and is noted in `unexpected`.
 */
async function serveDist() {
  /** @type {Map<string, { type: string, body: Buffer }>} */
  const files = new Map();
  const index = { type: 'text/html; charset=utf-8', body: readFileSync(join(DIST, 'index.html')) };
  files.set('/', index);
  files.set('/index.html', index);
  for (const name of readdirSync(join(DIST, 'assets'))) {
    const type = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[extname(name)];
    if (type) files.set(`/assets/${name}`, { type, body: readFileSync(join(DIST, 'assets', name)) });
  }
  /** @type {string[]} */
  const unexpected = [];
  const server = createServer((req, res) => {
    const file = req.method === 'GET' ? files.get(req.url ?? '') : undefined;
    if (!file) {
      unexpected.push(`${req.method} ${req.url}`);
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' }).end(file.body);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done(undefined));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the local server has no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    unexpected,
    close: () => new Promise((done) => server.close(() => done(undefined))),
  };
}

/** Waits until the page has rendered and every running animation and transition has finished. */
async function settle(/** @type {Page} */ page) {
  const finished = await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(() => done(undefined)));
    const all = Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => true);
    return Promise.race([all, new Promise((done) => setTimeout(() => done(false), 3000))]);
  });
  if (!finished) throw new Error('the page animations did not finish within 3 seconds');
}

/**
 * Adds the drawn mouse pointer: an arrow that follows the mouse and a ring
 * around its tip while the button is down. It is a manual popover, so it can be
 * put back on top of a modal dialog (raisePointer). Styled through the CSSOM only.
 */
async function addPointer(/** @type {Page} */ page) {
  await page.evaluate(() => {
    const svgNs = 'http://www.w3.org/2000/svg';
    const box = document.createElement('div');
    box.setAttribute('popover', 'manual');
    box.dataset['demoPointer'] = '';
    Object.assign(box.style, {
      position: 'fixed',
      inset: 'auto',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'visible',
      pointerEvents: 'none',
      transform: 'translate(-100px, -100px)',
    });
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute',
      left: '-15px',
      top: '-15px',
      width: '30px',
      height: '30px',
      boxSizing: 'border-box',
      borderRadius: '50%',
      border: '2px solid rgba(29, 78, 216, 0.8)',
      background: 'rgba(59, 130, 246, 0.3)',
      display: 'none',
    });
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '26');
    svg.setAttribute('height', '30');
    svg.setAttribute('viewBox', '0 0 26 30');
    Object.assign(svg.style, { position: 'absolute', left: '-2px', top: '-2px', overflow: 'visible' });
    const arrow = document.createElementNS(svgNs, 'path');
    arrow.setAttribute('d', 'M2 2 L2 23 L7.5 18 L11.5 27 L15.5 25.2 L11.6 16.4 L18.8 16.4 Z');
    arrow.setAttribute('fill', '#111827');
    arrow.setAttribute('stroke', '#ffffff');
    arrow.setAttribute('stroke-width', '1.8');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.append(arrow);
    box.append(ring, svg);
    document.body.append(box);
    box.showPopover();
    const follow = (/** @type {MouseEvent} */ e) => {
      box.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener('mousemove', follow, true);
    window.addEventListener(
      'mousedown',
      (e) => {
        follow(e);
        ring.style.display = 'block';
      },
      true,
    );
    window.addEventListener(
      'mouseup',
      (e) => {
        follow(e);
        ring.style.display = 'none';
      },
      true,
    );
  });
}

/** Puts the pointer back on top: a modal dialog opened later covers it otherwise. */
async function raisePointer(/** @type {Page} */ page) {
  await page.evaluate(() => {
    const box = document.querySelector('[data-demo-pointer]');
    if (!(box instanceof HTMLElement)) throw new Error('the drawn pointer is gone');
    box.hidePopover();
    box.showPopover();
  });
}

/** Number of open tiles, as the page counts them. */
const openTiles = (/** @type {Page} */ page) => page.locator('.tile.is-open').count();

/**
 * The scenario. Each `shoot(cs)` adds one frame shown for `cs` hundredths of a
 * second; a screenshot equal to the one before only extends that frame.
 * @param {Page} page
 * @param {(cs: number) => Promise<void>} shoot
 */
async function scenario(page, shoot) {
  // Set the start grades with the keyboard, before anything is recorded.
  const slider = (/** @type {string} */ id) => page.locator(`#slider-${id}`);
  const ids = await page.locator('.slider-list input[type="range"]').evaluateAll((all) => all.map((el) => el.id.replace(/^slider-/, '')));
  if (!ids.includes('wiskunde') || !ids.includes('nederlands')) throw new Error(`unexpected sliders: ${ids.join(', ')}`);
  for (const id of ids) {
    const want = id === 'wiskunde' ? START_MATHS : START_OTHERS;
    const s = slider(id);
    await s.focus();
    for (let guard = 0; Number(await s.inputValue()) !== want; guard++) {
      if (guard > 10) throw new Error(`the ${id} slider does not reach ${want} with the arrow keys`);
      await page.keyboard.press(Number(await s.inputValue()) < want ? 'ArrowRight' : 'ArrowLeft');
    }
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await settle(page);
  const openAtStart = await openTiles(page);

  const thumbSize = await slider('wiskunde').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--thumb')));
  if (!(thumbSize > 0)) throw new Error('cannot read the slider thumb size (--thumb)');
  /** Where the thumb of a slider sits for a grade. @param {string} id @param {number} grade */
  const thumb = async (id, grade) => {
    const box = await slider(id).boundingBox();
    if (!box) throw new Error(`the ${id} slider is not visible`);
    const [min, max] = [Number(await slider(id).getAttribute('min')), Number(await slider(id).getAttribute('max'))];
    return { x: box.x + thumbSize / 2 + ((box.width - thumbSize) * (grade - min)) / (max - min), y: box.y + box.height / 2 };
  };
  /** @param {Locator} locator */
  const centre = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`not visible: ${locator}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // The pointer starts in the empty corner of the slider panel, next to its title.
  /** @type {Point} */
  let at = { x: 310, y: 100 };
  await page.mouse.move(at.x, at.y);
  /** Moves the mouse along an eased line, one frame per step. @param {Point} to @param {number} steps */
  const glide = async (to, steps) => {
    const from = at;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const k = t * t * (3 - 2 * t);
      await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      await shoot(STEP_CS);
    }
    at = to;
  };
  /** Drags a slider from one grade to another; fails if the grade did not follow. */
  const drag = async (/** @type {string} */ id, /** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ steps) => {
    await glide(await thumb(id, from), 8);
    await page.mouse.down();
    if (Number(await slider(id).inputValue()) !== from) throw new Error(`pressing the ${id} thumb moved it: the thumb position is off`);
    await shoot(20);
    await glide(await thumb(id, to), steps);
    await page.mouse.up();
    if (Number(await slider(id).inputValue()) !== to) throw new Error(`the ${id} slider ended at ${await slider(id).inputValue()}, not ${to}`);
    await shoot(160);
  };

  // 1. The start: middling grades, Maths weak.
  await shoot(200);
  // 2. Maths up: a whole floor and more lights up.
  await drag('wiskunde', START_MATHS, MATHS_TO, 18);
  const openAfterMaths = await openTiles(page);
  // 3. Dutch down: some professions go dark again.
  await drag('nederlands', START_OTHERS, DUTCH_TO, 14);
  const openAfterDutch = await openTiles(page);
  // 4. Open the card of a profession that Dutch closed: it shows what it needs.
  const tile = page.locator(`.tile[data-id="${PROFESSION}"]`);
  if (await tile.evaluate((el) => el.classList.contains('is-open'))) throw new Error(`${PROFESSION} is still open; the card would show no gap`);
  await glide(await centre(tile), 9);
  await shoot(25);
  await page.mouse.down();
  await shoot(15);
  await page.mouse.up();
  await page.locator('.card-dialog[open] #card-title').waitFor();
  await settle(page);
  await raisePointer(page);
  await shoot(90);
  // 5. Point at the Dutch requirement and hold the last frame.
  const dutchRow = page.locator('.card-dialog .need-row').filter({ hasText: 'Dutch' });
  const gap = dutchRow.locator('.need-gap');
  if ((await gap.count()) !== 1) throw new Error('the card shows no gap for Dutch');
  const target = await centre(gap);
  await glide({ x: target.x, y: target.y + 2 }, 7);
  await shoot(400);

  if (!(openAtStart < openAfterMaths && openAfterDutch < openAfterMaths)) {
    throw new Error(`the scenario shows no change: ${openAtStart} open at the start, ${openAfterMaths} after Maths, ${openAfterDutch} after Dutch`);
  }
  return { openAtStart, openAfterMaths, openAfterDutch };
}

/**
 * Records the frames into `dir`.
 * @param {string} dir
 */
async function record(dir) {
  const server = await serveDist();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    await server.close();
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    throw new Prerequisite(`Chromium does not start (${first}); install it once with: npx playwright install chromium`);
  }
  /** @type {Frame[]} */
  const frames = [];
  /** @type {string[]} */
  const problems = [];
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
      locale: 'en-GB',
      colorScheme: 'light',
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()}`));

    await page.goto(`${server.origin}/`);
    await page.locator('.tile').nth(35).waitFor();
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (!lang.startsWith('en')) throw new Error(`the page opened in "${lang}", not in English`);
    await addPointer(page);

    /** @param {number} cs */
    const shoot = async (cs) => {
      await settle(page);
      const png = await page.screenshot({ type: 'png', caret: 'initial', animations: 'allow', scale: 'device' });
      const last = frames.at(-1);
      if (last && png.equals(last.png)) {
        last.cs += cs;
        return;
      }
      const file = `frame-${String(frames.length).padStart(4, '0')}.png`;
      writeFileSync(join(dir, file), png);
      frames.push({ file, cs, png });
    };
    const counts = await scenario(page, shoot);
    await context.close();
    problems.push(...server.unexpected.map((r) => `unexpected request: ${r}`));
    if (problems.length > 0) throw new Error(`the page reported problems during the recording:\n  ${problems.join('\n  ')}`);
    return { frames, counts };
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Turns the frames into a GIF with ffmpeg.
 * @param {string} dir
 * @param {Frame[]} frames
 */
function encode(dir, frames) {
  const last = frames.at(-1);
  if (!last) throw new Error('no frames were recorded');
  // The concat demuxer shows each file for its `duration`. Each image is read at
  // 100 frames per second, so durations stay exact hundredths (the default, 25,
  // would round them to 0.04 s); the `option` line needs -safe 0, and the list
  // holds only the frame files written above. The GIF muxer takes the time of
  // the last frame from -final_delay (in hundredths of a second).
  const list = frames.map((f) => `file '${f.file}'\noption framerate 100\nduration ${(f.cs / 100).toFixed(2)}\n`).join('');
  writeFileSync(join(dir, 'frames.txt'), list);
  const out = join(dir, 'demo.gif');
  const filter = [
    `[0:v]scale=${OUT_WIDTH}:-2:flags=lanczos,split[a][b]`,
    '[a]palettegen=max_colors=256:stats_mode=full[p]',
    '[b][p]paletteuse=dither=none:diff_mode=rectangle',
  ].join(';');
  const res = run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'frames.txt',
      '-filter_complex',
      filter,
      '-fps_mode',
      'vfr',
      '-loop',
      '0',
      '-final_delay',
      String(last.cs),
      '-map_metadata',
      '-1',
      '-flags',
      '+bitexact',
      '-fflags',
      '+bitexact',
      'demo.gif',
    ],
    dir,
  );
  if (res.error) throw new Error(`ffmpeg did not run: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`ffmpeg failed (exit ${res.status}):\n${res.stderr.trim()}`);
  return out;
}

/**
 * Checks the GIF the way check:tree does, and that it shows every frame for its time.
 * @param {string} gifPath
 * @param {Frame[]} frames
 */
function verify(gifPath, frames) {
  if (!existsSync(gifPath)) throw new Error(`ffmpeg exited 0 but wrote no ${gifPath}`);
  const size = statSync(gifPath).size;
  if (size === 0) throw new Error(`ffmpeg exited 0 but ${gifPath} is empty`);
  let info;
  try {
    info = parseGif(readFileSync(gifPath));
  } catch (err) {
    throw new Error(`the GIF does not pass the check of check:tree: ${err instanceof Error ? err.message : String(err)}`);
  }
  const expectedCs = frames.reduce((sum, f) => sum + f.cs, 0);
  const expectedHeight = Math.round((VIEWPORT.height * OUT_WIDTH) / VIEWPORT.width);
  /** @type {string[]} */
  const wrong = [];
  if (info.width !== OUT_WIDTH || info.height !== expectedHeight) wrong.push(`size ${info.width}x${info.height}, not ${OUT_WIDTH}x${expectedHeight}`);
  if (info.frames !== frames.length) wrong.push(`${info.frames} frames, not ${frames.length}`);
  if (info.durationCs !== expectedCs) wrong.push(`${info.durationCs / 100} s long, not ${expectedCs / 100} s`);
  if (wrong.length > 0) throw new Error(`the GIF is not what was recorded: ${wrong.join('; ')}`);
  return { ...info, size };
}

/** @param {string[]} argv */
async function main(argv) {
  if (argv.length > 1 || argv[0]?.startsWith('-')) {
    console.error('usage: node scripts/record-demo.mjs [output]   (default: docs/demo.gif)');
    return 2;
  }
  const out = resolve(argv[0] ?? DEFAULT_OUT);
  const dir = mkdtempSync(join(tmpdir(), 'record-demo-'));
  // The folder holds every screenshot. It goes however the run ends: `finally`
  // below for a return or an error, the exit listener for process.exit, and the
  // signal listeners for Ctrl-C, SIGTERM and SIGHUP, which would otherwise end
  // the process without running `finally`. Only SIGKILL leaves it behind.
  const removeFrames = () => rmSync(dir, { recursive: true, force: true });
  process.on('exit', removeFrames);
  /** @type {[NodeJS.Signals, number][]} */
  const signals = [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ];
  for (const [signal, code] of signals) {
    process.once(signal, () => {
      console.error(`record-demo: stopped by ${signal}; the screenshots are removed`);
      process.exit(code); // runs removeFrames; Playwright closes Chromium on exit
    });
  }
  try {
    preflight();
    if (!existsSync(dirname(out))) throw new Prerequisite(`the folder for ${out} does not exist`);
    const { frames, counts } = await record(dir);
    const gif = verify(encode(dir, frames), frames);
    copyFileSync(join(dir, 'demo.gif'), out);
    console.log(
      `record-demo: wrote ${out}: ${gif.size} bytes, ${gif.width}x${gif.height}, ${gif.frames} frames, ${(gif.durationCs / 100).toFixed(2)} s, looping; open tiles ${counts.openAtStart} -> ${counts.openAfterMaths} (Maths up) -> ${counts.openAfterDutch} (Dutch down)`,
    );
    return 0;
  } catch (err) {
    console.error(`record-demo: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof Prerequisite ? 2 : 1;
  } finally {
    removeFrames();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
