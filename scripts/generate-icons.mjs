import { readFile, rm, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'public', 'logo.png');
const build = join(root, 'build');
const iconset = join(build, 'icon.iconset');
await mkdir(build, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

if (process.platform === 'darwin') {
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  const specs = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of specs) {
    run('sips', ['-s', 'format', 'png', '-z', String(size), String(size), source, '--out', join(iconset, name)]);
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')]);
  await rm(iconset, { recursive: true, force: true });
} else {
  console.log('Skipping ICNS regeneration: macOS iconutil is required.');
}

// ICO supports PNG-compressed icon images. A 256x256 PNG entry is sufficient for
// modern Windows and avoids a heavyweight image dependency in the build toolchain.
const temp256 = join(build, '.icon-256.png');
if (process.platform === 'darwin') {
  run('sips', ['-s', 'format', 'png', '-z', '256', '256', source, '--out', temp256]);
} else {
  await copyFile(source, temp256);
}
const png = await readFile(temp256);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
header.writeUInt8(0, 6); // width: 256
header.writeUInt8(0, 7); // height: 256
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(join(build, 'icon.ico'), Buffer.concat([header, png]));
await rm(temp256, { force: true });
console.log(`Generated icons in ${build}`);
