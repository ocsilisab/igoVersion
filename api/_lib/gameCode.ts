import { randomInt } from "node:crypto";

// Excludes O/0 and I/1 so a spoken or handwritten code is never ambiguous.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export function generateGameCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Case-insensitive: always compare/store codes through this. */
export function normalizeGameCode(input: string): string {
  let result = "";
  for (const ch of input.toUpperCase()) {
    if (ALPHABET.includes(ch)) result += ch;
  }
  return result;
}

export function isValidGameCode(code: string): boolean {
  return code.length === CODE_LENGTH;
}
