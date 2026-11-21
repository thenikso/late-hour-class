// Small pure helpers shared by the server and the browser.

/** True when a value is neither null nor undefined (0 and '' are still set). */
export const isSet = (value) => value !== null && value !== undefined;

/** Keep a number inside [min, max]. */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Return a new array with the same items in a uniformly random order
 * (Fisher-Yates shuffle). Never mutates the input array.
 */
export function shuffle(items, rand = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
