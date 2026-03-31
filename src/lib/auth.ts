/**
 * Token-based authentication for PhoneCC.
 *
 * - Generates and persists a 256-bit random token to ~/.phonecc/auth-token
 * - Provides timing-safe token validation
 * - Caches the token in memory after first disk read
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

// ============================================================================
// CONSTANTS
// ============================================================================

const PHONECC_DIR = path.join(os.homedir(), ".phonecc");

/** Name of the authentication cookie */
export const COOKIE_NAME = "phonecc_auth";

/** Cookie max age in seconds (365 days) */
export const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Path to the auth token file on disk */
const TOKEN_PATH = path.join(PHONECC_DIR, "auth-token");

/** Module-level cache for the token, avoids repeated disk reads */
let cachedToken: string | null = null;

// ============================================================================
// MAIN HANDLERS
// ============================================================================

/**
 * Reads the auth token from disk, or generates a new one if it does not exist.
 * The token is cached in memory after the first read.
 *
 * @returns The authentication token string
 */
export async function getOrCreateToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  try {
    const token = await fs.readFile(TOKEN_PATH, "utf-8");
    cachedToken = token.trim();
    return cachedToken;
  } catch {
    // File does not exist, generate a new token
  }

  const token = generateToken();
  await saveToken(token);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log("\n============================================================");
  console.log("  PhoneCC Auth Token (first run)");
  console.log("============================================================");
  console.log(`  Token:  ${token}`);
  console.log(`  URL:    ${baseUrl}?token=${token}`);
  console.log("============================================================\n");

  cachedToken = token;
  return cachedToken;
}

/**
 * Validates a token against the stored auth token using timing-safe comparison.
 *
 * @param token - The token string to validate
 * @returns True if the token matches, false otherwise
 */
export async function validateToken(token: string): Promise<boolean> {
  const storedToken = await getOrCreateToken();

  // Both buffers must be the same length for timingSafeEqual
  const storedBuf = Buffer.from(storedToken);
  const inputBuf = Buffer.from(token);

  if (storedBuf.length !== inputBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuf, inputBuf);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Ensures the ~/.phonecc directory exists.
 */
async function ensurePhoneccDir(): Promise<void> {
  await fs.mkdir(PHONECC_DIR, { recursive: true });
}

/**
 * Generates a 256-bit random hex token prefixed with "phcc_".
 *
 * @returns The generated token string
 */
function generateToken(): string {
  const randomHex = crypto.randomBytes(32).toString("hex");
  return `phcc_${randomHex}`;
}

/**
 * Saves the token to disk at TOKEN_PATH.
 *
 * @param token - The token string to persist
 */
async function saveToken(token: string): Promise<void> {
  await ensurePhoneccDir();
  await fs.writeFile(TOKEN_PATH, token, "utf-8");
}
