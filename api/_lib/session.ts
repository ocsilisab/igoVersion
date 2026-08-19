import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getEnv, isProduction } from "./env.js";

const COOKIE_NAME = "go_guest";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days
const MAX_NAME_LENGTH = 24;
const MIN_PRINTABLE_CODE_POINT = 32;
const DELETE_CODE_POINT = 127;

function sign(value: string): string {
  return createHmac("sha256", getEnv("AUTH_SECRET")).update(value).digest("hex");
}

function packCookie(guestId: string): string {
  return guestId + "." + sign(guestId);
}

function unpackCookie(raw: string): string | null {
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;

  const guestId = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(guestId);

  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return null;
  }
  return guestId;
}

/** Reads the guest identity from the signed cookie, if present and valid. Never trusts an unsigned value. */
export function readGuestId(req: VercelRequest): string | null {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return null;
  return unpackCookie(raw);
}

export function setGuestCookie(res: VercelResponse, guestId: string): void {
  const parts = [
    COOKIE_NAME + "=" + packCookie(guestId),
    "Path=/",
    "Max-Age=" + String(MAX_AGE_SECONDS),
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** Returns the existing guest identity, or mints and persists a brand new one. */
export function ensureGuestId(req: VercelRequest, res: VercelResponse): string {
  const existing = readGuestId(req);
  if (existing) return existing;

  const guestId = randomBytes(16).toString("hex");
  setGuestCookie(res, guestId);
  return guestId;
}

/** Deterministic "Invitado_XXXX" display name derived from the guest id, so it's stable without extra storage. */
export function defaultGuestName(guestId: string): string {
  return "Invitado_" + sign(guestId).slice(0, 4).toUpperCase();
}

function isPrintableCodePoint(codePoint: number): boolean {
  return codePoint >= MIN_PRINTABLE_CODE_POINT && codePoint !== DELETE_CODE_POINT;
}

/** Trims/strips a user-supplied display name; returns null if nothing usable was given. */
export function sanitizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;

  let printableOnly = "";
  for (const ch of input) {
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && isPrintableCodePoint(codePoint)) {
      printableOnly += ch;
    }
  }

  const cleaned = printableOnly.trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}
