const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): {
  core: [number, number, number];
  prerelease: string[] | null;
} | null {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) return null;

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? null,
  };
}

/** Return true only when candidate is a valid, strictly newer SemVer version. */
export function isNewerExtensionVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;

  for (let index = 0; index < 3; index += 1) {
    if (next.core[index] !== installed.core[index]) {
      return next.core[index] > installed.core[index];
    }
  }

  if (next.prerelease === null) return installed.prerelease !== null;
  if (installed.prerelease === null) return false;

  const length = Math.max(next.prerelease.length, installed.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const nextPart = next.prerelease[index];
    const installedPart = installed.prerelease[index];
    if (nextPart === undefined) return false;
    if (installedPart === undefined) return true;
    if (nextPart === installedPart) continue;

    const nextNumeric = /^\d+$/.test(nextPart);
    const installedNumeric = /^\d+$/.test(installedPart);
    if (nextNumeric && installedNumeric) {
      return Number(nextPart) > Number(installedPart);
    }
    if (nextNumeric !== installedNumeric) return !nextNumeric;
    return nextPart > installedPart;
  }

  return false;
}
