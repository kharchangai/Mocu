export function readObjectInput(input) {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
}

export function clampInteger(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
