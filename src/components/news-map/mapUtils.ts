/**
 * Convert an ISO-3166-1 alpha-2 country code to a flag emoji.
 * Returns an empty string for invalid codes (non-alpha or wrong length).
 */
export function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2 || !/^[A-Z]{2}$/.test(upper)) return "";
  return [...upper].map((c) =>
    String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)
  ).join("");
}
