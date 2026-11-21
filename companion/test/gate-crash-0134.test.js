'use strict';
// 0.1.34. On 2026-11-21 publik answered every new computer "This app has reached its daily
// provisioning cap" (POST /installs, 429 mint_cap_reached). Three things went wrong on our side:
//   1. the gate window treated that answer like "no internet" and stayed hidden for a minute;
//   2. the person started Nūs again, and that second start opened the dashboard before the
//      database existed, which ended Nūs: db.js "Cannot read properties of undefined (reading
//      'prepare')";
//   3. when the window did come up it said only publik's sentence.
// Nothing here lets anyone past the gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mod = require('../src/publik/publik');
const G = require('../src/publik/gate-window');

const CAP = 'This app has reached its daily provisioning cap.';
const capScreen = () => mod.gateScreen('unreachable', null, null, CAP);
const offScreen = () => mod.gateScreen('unreachable', null);

test('no answer and an answer are told apart', () => {
  assert.equal(offScreen().body, G.NOT_REACHABLE, 'the module\'s own sentence for no answer');
  assert.equal(G.noAnswer(offScreen()), true);
  assert.equal(G.noAnswer(capScreen()), false, 'publik answered: that is not "no answer"');
  assert.equal(G.noAnswer(mod.gateScreen('unreachable', null, null, 'publik could not set up this computer (500).')), false);
  assert.equal(G.noAnswer(mod.gateScreen('sign_in', null)), false);
  assert.equal(G.capReached(capScreen()), true);
  assert.equal(G.capReached(offScreen()), false);
  assert.equal(G.capReached(mod.gateScreen('sign_in', null)), false);
});

test('the cap screen: our words say what happened and when it opens, publik\'s sentence and button stay', () => {
  const nowMs = Date.UTC(2026, 10, 21, 21, 1);
  const v = G.view(capScreen(), { nowMs });
  assert.equal(v.state, 'full');
  assert.equal(v.headline, 'Full for today');
  assert.match(v.line, /publik, which signs you in/);
  assert.match(v.callout, /Nothing is wrong with your install/);
  assert.ok(v.callout.includes(G.reopensAt(nowMs)), 'says when sign-in opens again');
  assert.equal(v.footnote, 'publik says: ' + CAP);
  assert.deepEqual(v.buttons.map((b) => b.label), ['Retry'], 'publik\'s label, untouched');
  assert.equal(v.buttons[0].caption, G.FULL.caption);
  for (const t of v.nus) { assert.ok(!/[—–]/.test(t), 'no dash: ' + t); assert.ok(!/\b(buy|purchase|pay|subscribe|upgrade|pricing)\b/i.test(t), 'nothing to sell: ' + t); }
  // Any other answer from publik is still drawn in publik's own words.
  const other = G.view(mod.gateScreen('unreachable', null, null, 'publik could not set up this computer (500).'));
  assert.equal(other.state, 'unreachable'); assert.equal(other.line, 'publik could not set up this computer (500).');
  const off = G.view(offScreen());
  assert.equal(off.state, 'unreachable'); assert.equal(off.line, G.NOT_REACHABLE);
});

test('the day starts again at midnight UTC, said in the person\'s own clock', () => {
  const keep = process.env.TZ;
  try {
    process.env.TZ = 'America/Chicago';
    assert.match(G.reopensAt(Date.UTC(2026, 10, 21, 21, 1)), /^(6:00\s?PM|18:00) today$/, '3:01 pm in Chicago');
    process.env.TZ = 'Australia/Sydney';
    assert.match(G.reopensAt(Date.UTC(2026, 10, 21, 8, 0)), /^(11:00\s?AM|11:00) tomorrow$/i, '7 pm in Sydney: the next morning');
    process.env.TZ = 'Asia/Kolkata';
    assert.match(G.reopensAt(Date.UTC(2026, 10, 21, 21, 1)), /^(5:30\s?AM|0?5:30) today$/i, '2:31 am in India: later the same morning');
  } finally { if (keep === undefined) delete process.env.TZ; else process.env.TZ = keep; }
});

// The window itself, with Electron stood in for. Only what the gate uses.
function fakeElectron() {
  const made = [];
  class BrowserWindow {
    constructor(o) { this.o = o; this.calls = []; this.destroyed = false; this.top = false; this.listeners = {}; made.push(this);
      this.webContents = { isLoading: () => false, send: (ch, v) => { this.calls.push('send:' + ch); this.last = v; }, once() {} }; }
    loadFile() {} on(n, f) { this.listeners[n] = f; } once() {}
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
    show() { this.calls.push('show'); } focus() { this.calls.push('focus'); } moveTop() { this.calls.push('moveTop'); }
    isMinimized() { return false; } restore() {} minimize() {} isFocused() { return true; } isVisible() { return true; }
    setAlwaysOnTop(v) { this.top = v; this.calls.push('top:' + v); } isAlwaysOnTop() { return this.top; } flashFrame() {}
  }
  const ipcMain = { on() {}, removeListener() {} };
  return { made, electron: { BrowserWindow, ipcMain, shell: { openExternal() {} }, app: { quit() {}, focus() {} } } };
}
function gateWith(opts) {
  const fake = fakeElectron();
  const id = require.resolve('electron');
  const before = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: fake.electron };
  try { return { ui: G.createGateUI(Object.assign({ sleep: async () => {} }, opts)), made: fake.made }; }
  finally { if (before) require.cache[id] = before; else delete require.cache[id]; }
}

test('publik answered with the cap at start: the window is up at once, not after a minute', async () => {
  const seen = [];
  const { ui, made } = gateWith({ now: () => 0, onScreen: (s) => seen.push(s) });
  const answer = ui.show(capScreen());
  await new Promise((r) => setImmediate(r));
  assert.equal(made.length, 1, 'the window was made on the first answer');
  assert.ok(made[0].calls.includes('show'));
  assert.equal(made[0].last.state, 'full');
  assert.deepEqual(seen, ['unreachable'], 'counted as before');
  assert.equal(await Promise.race([answer, new Promise((r) => setTimeout(() => r('still up'), 20))]), 'still up', 'it waits for the person, it does not retry by itself');
  ui.close();
});

test('no answer at start is still retried quietly, with no window', async () => {
  const { ui, made } = gateWith({ now: () => 0 });
  assert.equal(await ui.show(offScreen()), 'retry');
  assert.equal(made.length, 0);
  ui.close();
});

test('starting Nūs again: a window that is up comes forward; with none yet the next screen is drawn', async () => {
  const a = gateWith({ now: () => 0 });
  assert.equal(a.ui.front(), false, 'nothing to bring forward yet');
  a.ui.show(offScreen());
  await new Promise((r) => setImmediate(r));
  assert.equal(a.made.length, 1, 'the person asked twice: no more quiet waiting');
  assert.equal(a.made[0].last.state, 'unreachable');
  a.made[0].calls.length = 0;
  assert.equal(a.ui.front(), true);
  assert.ok(a.made[0].calls.includes('show') && a.made[0].calls.includes('focus'), 'brought to the front');
  a.ui.close();
});

test('the wiring: a second start before the database is open never opens the dashboard', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main-companion.js'), 'utf8');
  const handler = /app\.on\('second-instance', \(_event, argv\) => \{([\s\S]*?)\n\}\);/.exec(main);
  assert.ok(handler, 'the second-instance handler');
  const body = handler[1];
  const guard = body.indexOf('if (!databaseReady) {'), open = body.indexOf('openHome()');
  assert.ok(guard > -1 && open > -1 && guard < open, 'the database check comes before openHome()');
  assert.match(body, /if \(!databaseReady\) \{[^\n]*gateUi\.front\(\);[^\n]*return; \}/, 'the sign-in window comes forward instead');
  assert.match(main, /const ui = gateUi = require\('\.\.\/companion\/src\/publik\/gate-window'\)\.createGateUI\(/);
  assert.match(main, /ui\.close\(\); gateUi = null;/);
  assert.match(main, /app\.on\('activate', \(\) => \{ if \(databaseReady\) openHome\(\); \}\);/, 'the Mac path was already guarded');
});
