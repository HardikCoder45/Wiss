import { execFileSync } from 'node:child_process';

const target = process.argv[2];
if (!['mac', 'win'].includes(target)) {
  console.error('Usage: node scripts/preflight-release.mjs <mac|win>');
  process.exit(2);
}

const has = (name) => Boolean(process.env[name]?.trim());
const fail = (message) => {
  console.error(`RELEASE PREFLIGHT FAILED: ${message}`);
  process.exit(1);
};

if (target === 'mac') {
  if (process.platform !== 'darwin') fail('macOS release signing must run on macOS.');
  let identities = '';
  try {
    identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  } catch (error) {
    fail(`unable to inspect the login keychain: ${error instanceof Error ? error.message : String(error)}`);
  }
  const developerIdInstalled = identities.includes('Developer ID Application:');
  const cscProvided = has('CSC_LINK') && has('CSC_KEY_PASSWORD');
  if (!developerIdInstalled && !cscProvided) {
    fail('no “Developer ID Application” certificate is installed and no CSC_LINK/CSC_KEY_PASSWORD signing bundle is configured. An Apple Development certificate is not sufficient for public Gatekeeper distribution.');
  }

  const appleIdAuth = has('APPLE_ID') && has('APPLE_APP_SPECIFIC_PASSWORD') && has('APPLE_TEAM_ID');
  const apiKeyAuth = has('APPLE_API_KEY') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER');
  if (!appleIdAuth && !apiKeyAuth) {
    fail('notarization credentials are missing. Provide APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.');
  }
  console.log('macOS release preflight passed: Developer ID identity and notarization credentials are available.');
}

if (target === 'win') {
  const csc = (has('WIN_CSC_LINK') && has('WIN_CSC_KEY_PASSWORD')) || (has('CSC_LINK') && has('CSC_KEY_PASSWORD'));
  if (!csc) {
    fail('Authenticode credentials are missing. Provide WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK + CSC_KEY_PASSWORD) on the Windows release runner.');
  }
  console.log('Windows release preflight passed: Authenticode certificate material is configured.');
}
