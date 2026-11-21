// Start with Windows writes one login item, under one fixed name, and a copy
// Windows started at sign-in never opens the dashboard or counts as engaged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createAutostart, isLoginLaunch, legacyEntry, ENTRY, ARG } = require('./autostart');

function fakeApp(over = {}) {
  const calls = [];
  // The registry's Run key, as Electron's setLoginItemSettings treats it.
  const run = new Map(over.run || []);
  let aumid = 'electron.app.Nus Companion';
  const app = { isPackaged: true, getName: () => 'Nus Companion',
    setAppUserModelId(id) { aumid = id; },
    setLoginItemSettings(s) {
      calls.push(s);
      const name = s.name || aumid;
      if (s.openAtLogin) run.set(name, `"${s.path}" ${(s.args || []).join(' ')}`); else run.delete(name);
    }, ...over.app };
  return { app, calls, run };
}
const EXE = 'C:\\Users\\x\\AppData\\Local\\Programs\\nus-companion\\Nus Companion.exe';

test('on: one item, under the appId, running this exe with --autostart', () => {
  const f = fakeApp();
  const a = createAutostart({ app: f.app, platform: 'win32', execPath: EXE });
  assert.equal(a.apply(true), true);
  assert.deepEqual([...f.run], [[ENTRY, `"${EXE}" ${ARG}`]]);
});

test('the name does not follow the AppUserModelID: startup and a later yes write the same item', () => {
  const f = fakeApp();
  const a = createAutostart({ app: f.app, platform: 'win32', execPath: EXE });
  a.apply(true);                                   // at startup, before the id is set
  f.app.setAppUserModelId('com.nus.companion');
  a.apply(true);                                   // the Knot's "yes", or the Settings switch
  assert.equal(f.run.size, 1);
});

test('the item 0.1.16 to 0.1.29 left under Electron\'s default name is removed', () => {
  const both = [[legacyEntry('Nus Companion'), `"${EXE}" ${ARG}`], [ENTRY, `"${EXE}" ${ARG}`]];
  const on = fakeApp({ run: both });
  createAutostart({ app: on.app, platform: 'win32', execPath: EXE }).apply(true);
  assert.deepEqual([...on.run.keys()], [ENTRY]);
  const off = fakeApp({ run: both });
  createAutostart({ app: off.app, platform: 'win32', execPath: EXE }).apply(false);
  assert.equal(off.run.size, 0, 'off removes both');
  const never = fakeApp({ run: both });
  createAutostart({ app: never.app, platform: 'win32', execPath: EXE }).cleanup();
  assert.deepEqual([...never.run.keys()], [ENTRY], 'cleanup alone leaves the real item as it is');
});

test('a dev run and other platforms register nothing', () => {
  const dev = fakeApp({ app: { isPackaged: false } });
  const a = createAutostart({ app: dev.app, platform: 'win32', execPath: EXE });
  assert.equal(a.apply(true), false); assert.equal(a.cleanup(), false);
  const mac = fakeApp();
  assert.equal(createAutostart({ app: mac.app, platform: 'darwin', execPath: EXE }).apply(true), false);
  assert.equal(dev.calls.length + mac.calls.length, 0);
});

test('a refusal from Windows is logged, never thrown', () => {
  const lines = [];
  const f = fakeApp({ app: { setLoginItemSettings() { throw new Error('access denied'); } } });
  const a = createAutostart({ app: f.app, platform: 'win32', execPath: EXE, log: m => lines.push(m) });
  assert.equal(a.apply(true), false);
  assert.match(lines[0], /access denied/);
});

test('a login launch is told from the arguments', () => {
  assert.equal(isLoginLaunch([EXE, '--autostart']), true);
  assert.equal(isLoginLaunch([EXE, '--allow-file-access-from-files', '--autostart', '--original-process-start-time=1']), true);
  assert.equal(isLoginLaunch([EXE]), false);
  assert.equal(isLoginLaunch(undefined), false);
});

test('main-companion: the second copy from sign-in is ignored before the dashboard or engaged', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main-companion.js'), 'utf8');
  // The whole handler, to its closing line (0.1.34 added the database check and its comment).
  const from = main.indexOf("app.on('second-instance'");
  const handler = main.slice(from, main.indexOf('});', from) + 3);
  assert.ok(handler.indexOf('openHome()') > 0 && handler.indexOf('stats.engaged()') > 0, 'the handler was read to its end');
  assert.match(handler, /\(_event, argv\) =>/);
  assert.ok(handler.indexOf('if (isLoginLaunch(argv)) return;') > 0, 'the guard is there');
  assert.ok(handler.indexOf('isLoginLaunch(argv)') < handler.indexOf('openHome()'), 'and it comes first');
  assert.ok(handler.indexOf('isLoginLaunch(argv)') < handler.indexOf('stats.engaged()'));
  assert.doesNotMatch(main, /setLoginItemSettings/, 'the login item is written only by src/autostart.js');
});

test('the Companion installer carries src/autostart.js', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.companion.config.js'), 'utf8');
  assert.match(config, /'src\/autostart\.js'/);
});
