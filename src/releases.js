// GitHub Releases: which release is newer and which of its files fits this platform. No Electron
// here, so it runs in plain node (tests).

const REPO = 'gustganz/farmies';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** "v1.2.3" / "1.2.3" → [1, 2, 3], anything else → null */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * The release file for this platform (see the artifact names in package.json):
 * Windows Farmies-<v>-portable.exe, macOS Farmies-<v>-mac-<arch>.zip.
 */
function assetFor(assets, platform, arch) {
  const pattern =
    platform === 'win32' ? /^Farmies-.+-portable\.exe$/ : platform === 'darwin' ? new RegExp(`^Farmies-.+-mac-${arch}\\.zip$`) : null;
  return pattern ? (assets || []).find((a) => pattern.test(a.name)) : undefined;
}

/**
 * From the GitHub API answer for the latest release: the update to offer, or null.
 * → { version, page, asset: { name, url, size } | null (other platforms: the page only) }
 */
function updateFrom(release, current, platform, arch) {
  if (!release || release.draft || release.prerelease || !isNewer(release.tag_name, current)) return null;
  const asset = assetFor(release.assets, platform, arch);
  // Windows/macOS: only once the file is there (an older release workflow published the release
  // while the other build was still uploading; opening the page instead looks broken)
  if (!asset && (platform === 'win32' || platform === 'darwin')) return null;
  return {
    version: parseVersion(release.tag_name).join('.'),
    page: release.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
  };
}

module.exports = { REPO, LATEST_URL, parseVersion, isNewer, assetFor, updateFrom };
