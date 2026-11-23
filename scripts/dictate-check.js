#!/usr/bin/env node
'use strict';
// The dictation transcript check (ventures/nus/conditor/dictate-0137/README.md).
//
//   node scripts/dictate-check.js sentences
//       prints the 20 sentences to read aloud, one per Ctrl+Win press, in order.
//   node scripts/dictate-check.js score [log.jsonl] [sentences.txt]
//       scores what the app wrote down (the dogfood log, see below) against the
//       sentences, in order: words wrong, per sentence and in all, with timings.
//   node scripts/dictate-check.js bench <folder> [--model DIR]
//       runs the shipped Parakeet worker on every 16 kHz mono .wav in the folder
//       and scores it against <name>.ref.txt next to it (clips with no .ref.txt
//       are transcribed and printed, not scored).
//
// The dogfood log: create the folder %APPDATA%\Nus Companion\dictate-check
// with an empty file named ON in it. While it is there, every dictation appends
// one line to log.jsonl there (raw words, engine, decode time, key-up to paste)
// and keeps its audio as NNN.wav. Delete the folder to stop and forget it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const { wer, total } = require('../companion/src/voice/wer');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const CHECK_DIR = path.join(APPDATA, 'Nus Companion', 'dictate-check');
const SENTENCES = path.join(__dirname, 'dictate-sentences.txt');
const MODEL_DIR = path.join(APPDATA, 'Nus Companion', 'speech', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');

function lines(file) { return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean); }
const pct = (x) => (100 * x).toFixed(1) + '%';

// 16 kHz mono 16-bit PCM out of a WAV file, or null when it is another format.
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, fmt = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4), body = off + 8;
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) return null;
      return b.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  return null;
}

function startParakeet(dir) {
  return new Promise((resolve, reject) => {
    const w = fork(path.join(__dirname, '..', 'companion', 'src', 'voice', 'parakeet-worker.js'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], serialization: 'advanced' });
    const waiting = new Map();
    let seq = 0;
    const t0 = Date.now();
    w.on('message', (m) => {
      if (!m) return;
      if (m.type === 'hello') w.send({ type: 'load', dir, threads: 4 });
      else if (m.type === 'ready') resolve({ loadMs: Date.now() - t0, decode, close: () => w.kill() });
      else if (m.type === 'text' && waiting.has(m.id)) { waiting.get(m.id).resolve(m); waiting.delete(m.id); }
      else if (m.type === 'error') { if (m.id != null && waiting.has(m.id)) { waiting.get(m.id).reject(new Error(m.message)); waiting.delete(m.id); } else reject(new Error(m.message)); }
    });
    w.on('exit', (code) => reject(new Error('worker exited ' + code)));
    function decode(pcm) { const id = ++seq; return new Promise((res, rej) => { waiting.set(id, { resolve: res, reject: rej }); w.send({ type: 'decode', id, pcm }); }); }
  });
}

async function bench(folder, modelDir) {
  const clips = fs.readdirSync(folder).filter((f) => /\.wav$/i.test(f)).sort();
  if (!clips.length) { console.log('No .wav files in ' + folder); return; }
  const pk = await startParakeet(modelDir);
  console.log('Parakeet loaded in ' + pk.loadMs + ' ms from ' + modelDir);
  const pairs = [];
  let audio = 0, spent = 0;
  for (const f of clips) {
    const pcm = readWav(path.join(folder, f));
    if (!pcm) { console.log('skip ' + f + ' (not 16 kHz mono 16-bit)'); continue; }
    const r = await pk.decode(pcm);
    audio += r.secs; spent += r.ms;
    const refFile = path.join(folder, f.replace(/\.wav$/i, '.ref.txt'));
    const ref = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf8').trim() : null;
    if (ref != null) { const w = wer(ref, r.text); pairs.push({ ref, hyp: r.text }); console.log(`${f}  ${r.secs.toFixed(1)} s audio, ${r.ms} ms  ${w.errors}/${w.ref} wrong\n  said:  ${ref}\n  heard: ${r.text}`); }
    else console.log(`${f}  ${r.secs.toFixed(1)} s audio, ${r.ms} ms  (no .ref.txt)\n  heard: ${r.text}`);
  }
  pk.close();
  if (pairs.length) { const t = total(pairs); console.log(`\nAll: ${t.errors} of ${t.ref} words wrong (${pct(t.wer)}), ${t.exact} of ${t.pairs} clips word-perfect.`); }
  console.log(`Decode: ${spent} ms for ${audio.toFixed(1)} s of audio (${(spent / Math.max(1, audio)).toFixed(0)} ms per second of speech).`);
}

function score(logFile, sentencesFile) {
  const said = lines(sentencesFile);
  const got = lines(logFile).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  if (!got.length) { console.log('No dictations in ' + logFile); return; }
  const n = Math.min(said.length, got.length);
  const pairs = [];
  const ms = { decode: [], paste: [] };
  for (let i = 0; i < n; i++) {
    const w = wer(said[i], got[i].raw);
    pairs.push({ ref: said[i], hyp: got[i].raw });
    ms.decode.push(got[i].decodeMs); ms.paste.push(got[i].keyUpToPasteMs);
    console.log(`${String(i + 1).padStart(2)}. ${w.errors}/${w.ref} wrong  ${got[i].engine}, ${got[i].audioMs} ms audio, decode ${got[i].decodeMs} ms, key up to words ${got[i].keyUpToPasteMs} ms, ${got[i].how || '?'}${got[i].app ? ' in ' + got[i].app : ''}`);
    if (w.errors) console.log(`    said:  ${said[i]}\n    heard: ${got[i].raw}`);
  }
  const t = total(pairs);
  const med = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  console.log(`\n${t.errors} of ${t.ref} words wrong (${pct(t.wer)}), ${t.exact} of ${t.pairs} sentences word-perfect.`);
  console.log(`Median decode ${med(ms.decode)} ms, median key up to words ${med(ms.paste)} ms.`);
  console.log(t.wer > 0.1 ? 'More than 1 word in 10 is wrong: fix the speech model before the test runs (README, section "Before the test").' : 'Under 1 word in 10 wrong: the transcript is good enough to run the test.');
  if (got.length !== said.length) console.log(`(${got.length} dictations in the log, ${said.length} sentences: scored the first ${n} in order.)`);
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'sentences') { lines(SENTENCES).forEach((s, i) => console.log(String(i + 1).padStart(2) + '. ' + s)); return; }
  if (cmd === 'score') { score(a || path.join(CHECK_DIR, 'log.jsonl'), b || SENTENCES); return; }
  if (cmd === 'bench') {
    if (!a) throw new Error('bench needs a folder of .wav files');
    const i = process.argv.indexOf('--model');
    await bench(a, i > 0 ? process.argv[i + 1] : MODEL_DIR);
    return;
  }
  console.log('usage: node scripts/dictate-check.js sentences | score [log.jsonl] [sentences.txt] | bench <folder> [--model DIR]');
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { readWav, score, bench };
