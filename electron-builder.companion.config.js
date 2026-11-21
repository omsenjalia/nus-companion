const base = require('./electron-builder.config.js');
// The publik switch: Sign in with publik, usage counting and publik API (companion/src/publik).
// true for the build listed on publik. false builds the Companion as it was in 0.1.16: no gate,
// no publik provider, and the folder and the app token stay out of the installer.
const PUBLIK = true;
// A Mac app can only be packed on macOS (the build-companion-mac workflow), and a Windows one only
// on Windows, so the host decides which native binaries go in the asar.
const MAC = process.platform === 'darwin';
const ONNX_KEEP = MAC
  ? ['!node_modules/onnxruntime-node/bin/napi-v*/win32/**', '!node_modules/onnxruntime-node/bin/napi-v*/linux/**', '!node_modules/onnxruntime-node/bin/napi-v*/darwin/x64/**']
  : ['!node_modules/onnxruntime-node/bin/napi-v*/darwin/**', '!node_modules/onnxruntime-node/bin/napi-v*/linux/**', '!node_modules/onnxruntime-node/bin/napi-v*/win32/arm64/**',
    // CPU only: the GPU (DirectML) libraries are not loaded for this model.
    '!node_modules/onnxruntime-node/bin/napi-v*/win32/x64/DirectML.dll', '!node_modules/onnxruntime-node/bin/napi-v*/win32/x64/dx*.dll'];
module.exports = {
  appId: 'com.nus.companion',
  productName: 'Nus Companion',
  copyright: base.copyright,
  extraMetadata: { name: 'nus-companion', version: '0.1.31', main: 'src/main-companion.js', publik: PUBLIK,
    description: 'Nūs Companion: the Knot that hears you and acts, on its own.' },
  directories: { output: 'dist-companion', buildResources: 'build' },
  // companion/** carries companion/src/stats.js (anonymous usage stats, plain
  // fetch, no SDK); @supabase and electron-updater stay out of this build.
  // src/license.js (no requires) reads the optional account's plan.
  files: ['companion/**/*', 'src/main-companion.js', 'src/ai.js', 'src/claude-pool.js', 'src/secrets.js', 'src/stt-local.js', 'src/whisper-server.js',
    'src/crash.js', 'src/quit-guard.js', 'src/autostart.js', 'src/db.js', 'src/license.js', 'package.json',
    '!**/*.test.js', '!**/*.bak-*', '!companion/test/**', '!docs/**', '!scripts/**', '!supabase/**',
    // Developer-only checks and the unused 3D Knot stay out of the asar.
    '!companion/verify-focus-guard.cjs', '!companion/renderer/knot3d.js',
    '!renderer/**', '!src/config.js', '!electron-builder*.config.js',
    // publik: the module finds publik-app-token.txt in its folder or a parent (the asar root).
    ...(PUBLIK ? ['publik-app-token.txt'] : ['!companion/src/publik/**']),
    '!node_modules/@supabase/**', '!node_modules/electron-updater/**',
    // Local embeddings (companion/src/recall/embed.js): this host's runtime only (Windows x64, or Mac arm64).
    ...ONNX_KEEP,
    // The Mac beta has no Windows helpers and no Windows voice runtime.
    ...(MAC ? ['!companion/src/win/*.ps1', '!companion/src/reflex/hands.ps1', '!node_modules/sherpa-onnx-win-*/**'] : [])],
  // The voice runtime (sherpa-onnx, N-API) must sit on disk, not inside the asar, to load.
  asarUnpack: MAC
    ? ['node_modules/onnxruntime-node/**', 'node_modules/sherpa-onnx-node/**', 'node_modules/sherpa-onnx-darwin-arm64/**', 'companion/src/voice/engine-worker.js', 'companion/src/voice/parakeet-worker.js']
    : ['companion/src/win/ocr.ps1', 'node_modules/onnxruntime-node/**', 'node_modules/sherpa-onnx-node/**', 'node_modules/sherpa-onnx-win-x64/**', 'companion/src/voice/engine-worker.js', 'companion/src/voice/parakeet-worker.js'],
  afterPack: base.afterPack,
  // The Mac beta: an ad-hoc signed dmg (afterPack above, from the base config), arm64 first.
  // No Developer ID yet, so Gatekeeper asks once (Open Anyway). No zip and no latest-mac.yml:
  // the updater is off on a Mac. Fable's voice files and whisper are not bundled yet.
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    icon: 'build/icon.png',
    category: 'public.app-category.productivity',
    artifactName: 'Nus-Companion-mac-${arch}.${ext}',
    darkModeSupport: true,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    identity: null,
    // Speech to text on the Mac: whisper.cpp (MIT) built on the macOS runner from the same release
    // as the Windows binaries (b4938, CPU only), and the base English model (MIT). The workflow
    // puts them in vendor/whisper-mac and vendor/whisper-models before this build runs.
    extraResources: [
      { from: 'vendor/whisper-mac', to: 'whisper', filter: ['whisper-cli', 'whisper-server', 'LICENSE'] },
      { from: 'vendor/whisper-models', to: 'whisper-models', filter: ['ggml-base.en-q5_1.bin'] },
      // Fable, the Knot's own voice, as on Windows (Kokoro v1.0 through sherpa-onnx; the English files
      // only). Proved on Apple Silicon in run 43778103154. a tester, 2026-11-15: the Mac spoke in the
      // system voice and he expected the Knot's own.
      { from: 'vendor/voice/kokoro-multi-lang-v1_0', to: 'voice/kokoro-multi-lang-v1_0', filter: ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-gb-en.txt', 'lexicon-us-en.txt', 'LICENSE', 'espeak-ng-data/**'] }],
    extendInfo: {
      // The words in macOS's microphone question, asked on the first press of the talk key.
      NSMicrophoneUsageDescription: 'Nūs listens only while you use the talk key, and turns your words into text on this Mac.',
      // The first-run hello types into a new TextEdit document (companion/src/mac-hello.js): macOS asks once.
      NSAppleEventsUsageDescription: 'Nūs opens one new TextEdit document on your first start and types a hello into it. It does not read or change your other documents.',
      NSCameraUsageDescription: 'Nūs does not use the camera. macOS asks because screen capture shares the permission group.',
      NSAudioCaptureUsageDescription: 'Nūs can hear a lecture or meeting only while you turn it on.',
    },
  },
  dmg: {
    artifactName: 'Nus-Companion-mac-${arch}.${ext}',
    contents: [{ x: 130, y: 220 }, { x: 410, y: 220, type: 'link', path: '/Applications' }],
  },
  win: {
    target: base.win.target, icon: 'build/icon.ico', artifactName: 'Nus-Companion-Setup.${ext}',
    extraResources: [...base.win.extraResources,
      { from: 'companion/src/reflex', to: 'win', filter: ['hands.ps1'] },
      // Fable, the Knot's own voice (Kokoro v1.0 via sherpa-onnx, Apache-2.0; espeak-ng-data is
      // GPL-3.0, see THIRD-PARTY.md), so the first word is Fable with no download. The English files only.
      { from: 'vendor/voice/kokoro-multi-lang-v1_0', to: 'voice/kokoro-multi-lang-v1_0', filter: ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-gb-en.txt', 'lexicon-us-en.txt', 'LICENSE', 'espeak-ng-data/**'] },
      { from: 'vendor/whisper-models', to: 'whisper-models', filter: ['ggml-base.en-q5_1.bin'] },
      // all-MiniLM-L6-v2, int8 ONNX (Apache-2.0): search by meaning. npm run setup:embed fetches it.
      { from: 'vendor/embed-models', to: 'embed-models', filter: ['all-MiniLM-L6-v2/model_quantized.onnx', 'all-MiniLM-L6-v2/vocab.txt'] }],
  },
  portable: { artifactName: 'Nus-Companion-Portable.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'Nus Companion', uninstallDisplayName: 'Nūs Companion' },
  publish: [{ provider: 'github', owner: 'potlakai', repo: 'nus-companion' }],
};
