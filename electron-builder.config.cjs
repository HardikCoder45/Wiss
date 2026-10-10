const release = process.env.REQUIRE_CODE_SIGNING === '1';
const buildingWindows = process.argv.includes('--win');
const buildingMacX64 = process.argv.includes('--x64');
const buildingAppleSilicon = !buildingWindows && !buildingMacX64;
const crossBuildingWindows = buildingWindows && process.platform !== 'win32';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.omnix.wiss',
  productName: 'OmniX Wiss',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'dist/release',
    buildResources: 'build',
  },
  files: [
    'out/**/*',
    'package.json',
    ...(buildingAppleSilicon ? [
      // Apple Silicon uses the bundled MLX/Metal runner. Excluding the ONNX
      // fallback prevents shipping two complete inference engines.
      '!node_modules/@huggingface/transformers/**/*',
      '!node_modules/onnxruntime-common/**/*',
      '!node_modules/onnxruntime-node/**/*',
      '!node_modules/onnxruntime-web/**/*',
      '!node_modules/sharp/**/*',
      '!node_modules/@img/**/*',
    ] : []),
  ],
  extraResources: [
    {
      from: 'public/logo.png',
      to: 'branding/logo.png',
    },
    ...(!buildingWindows && !buildingMacX64 ? [{
      from: 'resources/mlx-runner',
      to: 'mlx-runner',
    }] : []),
  ],
  asar: true,
  // uiohook-napi ships N-API prebuilds for Windows. Rebuilding it from macOS is
  // impossible, so cross-packaging uses the shipped win32-x64 prebuild instead.
  npmRebuild: !crossBuildingWindows,
  asarUnpack: [
    'node_modules/uiohook-napi/**/*',
    'node_modules/onnxruntime-node/**/*',
    'node_modules/sharp/**/*',
    'node_modules/@img/**/*',
  ],
  forceCodeSigning: release,
  mac: {
    category: 'public.app-category.productivity',
    icon: 'build/icon.icns',
    target: ['dmg'],
    hardenedRuntime: true,
    entitlements: release ? 'build/entitlements.mac.plist' : 'build/entitlements.mac.local.plist',
    entitlementsInherit: release ? 'build/entitlements.mac.inherit.plist' : 'build/entitlements.mac.local.plist',
    // Let electron-builder use an installed Apple Development identity for
    // local builds. A stable signature keeps macOS TCC grants valid across
    // rebuilds; ad-hoc signing changes the designated requirement every time.
    identity: undefined,
    timestamp: release ? undefined : null,
    notarize: release,
    extendInfo: {
      LSUIElement: true,
      NSMicrophoneUsageDescription: 'OmniX Wiss uses the microphone only while you hold the dictation shortcut so speech can be transcribed locally on this device.',
    },
  },
  dmg: {
    title: 'OmniX Wiss ${version}',
    icon: 'build/icon.icns',
    backgroundColor: '#071257',
    contents: [
      { x: 150, y: 185, type: 'file' },
      { x: 430, y: 185, type: 'link', path: '/Applications' },
    ],
  },
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    requestedExecutionLevel: 'asInvoker',
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'OmniX Wiss',
    uninstallDisplayName: 'OmniX Wiss',
    deleteAppDataOnUninstall: false,
  },
};
