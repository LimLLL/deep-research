import { Md5 } from "ts-md5";

export function generateSignature(key: string, timestamp: number): string {
  const data = `${key}::${timestamp.toString().substring(0, 8)}`;
  return Md5.hashStr(data);
}

/**
 * Verify signature with ±1 time-window tolerance (~30s total validity).
 * This accommodates multi-step AI SDK calls where tool execution
 * may cause significant delay between initial auth and follow-up requests.
 */
export function verifySignature(
  signature = "",
  key: string,
  timestamp: number
): boolean {
  const window = 30000; // ~30s per window (8-char prefix granularity)
  for (const offset of [0, -window, window]) {
    if (signature === generateSignature(key, timestamp + offset)) {
      return true;
    }
  }
  return false;
}
