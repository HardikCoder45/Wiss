import { execFileSync, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, 'dist', 'release', 'mac-arm64', 'OmniX Wiss.app');
const strictDistribution = process.env.REQUIRE_NOTARIZED === '1';
const executable = join(appPath, 'Contents', 'MacOS', 'OmniX Wiss');
const architectures = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim().split(/\s+/);
const appleSilicon = architectures.includes('arm64');

const required = [
  executable,
  join(appPath, 'Contents', 'Resources', 'branding', 'logo.png'),
  appleSilicon
    ? join(appPath, 'Contents', 'Resources', 'mlx-runner', 'wiss-mlx-runner')
    : join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'onnxruntime-node'),
];
for (const path of required) await access(path);

execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
const signingDetails = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
if (signingDetails.status !== 0) {
  throw new Error(`Unable to read signing metadata:\n${signingDetails.stderr || signingDetails.stdout}`);
}
const signing = (signingDetails.stderr || signingDetails.stdout || '').trim();
const plist = join(appPath, 'Contents', 'Info.plist');
const lsui = execFileSync('plutil', ['-extract', 'LSUIElement', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
const mic = execFileSync('plutil', ['-extract', 'NSMicrophoneUsageDescription', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
if (lsui !== 'true') throw new Error('LSUIElement is not enabled in the packaged app.');
if (!mic) throw new Error('NSMicrophoneUsageDescription is missing.');
const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (!entitlements.includes('com.apple.security.device.audio-input')) {
  throw new Error('The packaged app is missing the audio-input entitlement.');
}

const assess = spawnSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], { encoding: 'utf8' });
if (strictDistribution && assess.status !== 0) {
  throw new Error(`Gatekeeper assessment failed for release build:\n${assess.stderr || assess.stdout}`);
}

if (strictDistribution) {
  execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' });
}

console.log(JSON.stringify({
  appPath,
  architectures,
  inferenceBackend: appleSilicon ? 'Apple MLX' : 'ONNX Runtime',
  codesignVerified: true,
  gatekeeperAccepted: assess.status === 0,
  gatekeeperOutput: (assess.stderr || assess.stdout || '').trim(),
  lsuiElement: lsui,
  microphoneUsageDescription: mic,
  signingSummary: signing.trim(),
  notarizationRequired: strictDistribution,
}, null, 2));
