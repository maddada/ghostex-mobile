/**
 * Android self-update: release lookup and version comparison.
 *
 * The Android app is distributed as the `ghostex-android.apk` asset on every
 * GitHub release of maddada/Ghostex (tags look like `v8.6.0`, and the
 * installed app reports `8.6.0` through expo-application, which is the
 * `version` field app.config.js writes into the APK). This module fetches the
 * latest release, finds that asset, and decides whether it is newer than the
 * running build. Errors from GitHub (offline, rate limit, missing asset) are
 * thrown with a user-readable message so the Settings page can show them.
 */

import * as Application from 'expo-application';

export const GITHUB_REPO = 'maddada/Ghostex';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const APK_ASSET_NAME = 'ghostex-android.apk';
/** Automatic checks run at most this often; the Settings button ignores it. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type SemanticVersion = readonly [major: number, minor: number, patch: number];

export type LatestRelease = {
  /** Git tag, e.g. `v8.6.0`. */
  tag: string;
  /** Tag without the `v` prefix, e.g. `8.6.0`. */
  version: string;
  publishedAt: string;
  apkUrl: string;
  apkSize: number;
};

type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GitHubRelease = {
  tag_name: string;
  published_at: string;
  assets: GitHubReleaseAsset[];
};

/** Parse `8.6.0` or `v8.6.0`; anything else is a malformed release tag. */
export function parseSemanticVersion(text: string): SemanticVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(text.trim());
  if (match === null) {
    throw new Error(`Version "${text}" is not MAJOR.MINOR.PATCH.`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemanticVersions(a: SemanticVersion, b: SemanticVersion): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/** True when `candidate` is strictly newer than `installed`. */
export function isNewerVersion(candidate: string, installed: string): boolean {
  return compareSemanticVersions(parseSemanticVersion(candidate), parseSemanticVersion(installed)) > 0;
}

/** The `versionName` of the installed APK (`8.6.0`). */
export function installedAppVersion(): string {
  const version = Application.nativeApplicationVersion;
  if (version === null) {
    throw new Error('The installed app version is unavailable.');
  }
  return version;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function describeGitHubFailure(response: Response): string {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  if ((response.status === 403 || response.status === 429) && remaining === '0') {
    const resetAt = reset === null ? null : new Date(Number(reset) * 1000);
    return resetAt === null || Number.isNaN(resetAt.getTime())
      ? 'GitHub rate limit reached. Try again later.'
      : `GitHub rate limit reached. Try again after ${formatClockTime(resetAt)}.`;
  }
  if (response.status === 404) {
    return `GitHub has no published release for ${GITHUB_REPO}.`;
  }
  return `GitHub responded with HTTP ${response.status}.`;
}

function assertGitHubRelease(body: unknown): GitHubRelease {
  if (typeof body !== 'object' || body === null) {
    throw new Error('GitHub returned an unexpected response.');
  }
  const release = body as Partial<GitHubRelease>;
  if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
    throw new Error('GitHub returned a release without a tag or assets.');
  }
  return {
    tag_name: release.tag_name,
    published_at: typeof release.published_at === 'string' ? release.published_at : '',
    assets: release.assets,
  };
}

/** GET the latest GitHub release and locate the Android APK asset. */
export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease> {
  let response: Response;
  try {
    response = await fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    });
  } catch (error) {
    throw new Error(`Could not reach GitHub (${errorMessage(error)}). Check your connection.`);
  }
  if (!response.ok) {
    throw new Error(describeGitHubFailure(response));
  }

  const release = assertGitHubRelease(await response.json());
  // Validates the tag shape up front so a malformed tag surfaces here, not
  // later in the comparison.
  const [major, minor, patch] = parseSemanticVersion(release.tag_name);
  const asset = release.assets.find((candidate) => candidate.name === APK_ASSET_NAME);
  if (asset === undefined) {
    throw new Error(`Release ${release.tag_name} has no ${APK_ASSET_NAME} asset.`);
  }
  if (typeof asset.browser_download_url !== 'string' || typeof asset.size !== 'number') {
    throw new Error(`Release ${release.tag_name} lists ${APK_ASSET_NAME} without a download URL or size.`);
  }

  return {
    tag: release.tag_name,
    version: `${major}.${minor}.${patch}`,
    publishedAt: release.published_at,
    apkUrl: asset.browser_download_url,
    apkSize: asset.size,
  };
}

/** `195992349` → `187 MB`. */
export function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
