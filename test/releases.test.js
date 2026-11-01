const test = require('node:test');
const assert = require('node:assert');
const { parseVersion, isNewer, assetFor, updateFrom } = require('../src/releases');

const assets = [
  { name: 'Farmies-0.2.0-portable.exe', browser_download_url: 'https://x/exe', size: 10 },
  { name: 'Farmies-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/arm', size: 20 },
  { name: 'Farmies-0.2.0-mac-x64.zip', browser_download_url: 'https://x/x64', size: 30 },
];
const release = { tag_name: 'v0.2.0', html_url: 'https://github.com/gustganz/farmies/releases/tag/v0.2.0', assets };

test('parseVersion', () => {
  assert.deepStrictEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepStrictEqual(parseVersion('10.0.1'), [10, 0, 1]);
  assert.strictEqual(parseVersion('v1.2'), null);
  assert.strictEqual(parseVersion('v1.2.3-beta'), null);
  assert.strictEqual(parseVersion(undefined), null);
});

test('isNewer compares numerically', () => {
  assert.ok(isNewer('v0.10.0', '0.9.9'));
  assert.ok(isNewer('1.0.0', '0.99.99'));
  assert.ok(!isNewer('v0.1.0', '0.1.0'));
  assert.ok(!isNewer('v0.1.0', '0.2.0'));
  assert.ok(!isNewer('garbage', '0.1.0'));
});

test('assetFor picks the file for platform and arch', () => {
  assert.strictEqual(assetFor(assets, 'win32', 'x64').name, 'Farmies-0.2.0-portable.exe');
  assert.strictEqual(assetFor(assets, 'darwin', 'arm64').name, 'Farmies-0.2.0-mac-arm64.zip');
  assert.strictEqual(assetFor(assets, 'darwin', 'x64').name, 'Farmies-0.2.0-mac-x64.zip');
  assert.strictEqual(assetFor(assets, 'linux', 'x64'), undefined);
  assert.strictEqual(assetFor(undefined, 'win32', 'x64'), undefined);
});

test('updateFrom offers only newer, published releases', () => {
  assert.deepStrictEqual(updateFrom(release, '0.1.0', 'darwin', 'arm64'), {
    version: '0.2.0',
    page: release.html_url,
    asset: { name: 'Farmies-0.2.0-mac-arm64.zip', url: 'https://x/arm', size: 20 },
  });
  assert.strictEqual(updateFrom(release, '0.2.0', 'win32', 'x64'), null);
  assert.strictEqual(updateFrom({ ...release, draft: true }, '0.1.0', 'win32', 'x64'), null);
  assert.strictEqual(updateFrom({ ...release, prerelease: true }, '0.1.0', 'win32', 'x64'), null);
  // newer, but no file for this platform: still offered (opens the release page)
  assert.strictEqual(updateFrom({ ...release, assets: [] }, '0.1.0', 'win32', 'x64').asset, null);
});
