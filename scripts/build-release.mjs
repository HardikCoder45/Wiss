import { spawnSync } from 'node:child_process';

const target = process.argv[2];
if (!['mac', 'win'].includes(target)) {
  console.error('Usage: node scripts/build-release.mjs <mac|win>');
  process.exit(2);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['scripts/preflight-release.mjs', target]);
run('npm', ['run', 'build']);

const args = ['electron-builder', '-c', 'electron-builder.config.cjs'];
if (target === 'mac') args.push('--mac', 'dmg', '--arm64');
else args.push('--win', 'nsis', '--x64');

run('npx', args, { ...process.env, REQUIRE_CODE_SIGNING: '1' });
