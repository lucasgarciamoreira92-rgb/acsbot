const encoder = new TextEncoder();
export const PACKAGE_AAD = "acs-pilot/package/v1";
export type Envelope = { version: 1; algorithm: "AES-256-GCM"; nonce: string; ciphertext: string };
export function b64(bytes: Uint8Array): string {
  let s = ""; for (const byte of bytes) s += String.fromCharCode(byte); return btoa(s);
}
export function unb64(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export function randomKey() { return b64(crypto.getRandomValues(new Uint8Array(32))); }
export async function encrypt(data: unknown, keyText: string, aad: string): Promise<Envelope> {
  const raw = unb64(keyText); if (raw.length !== 32) throw new Error("Invalid encryption key");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) }, key, encoder.encode(JSON.stringify(data)));
  return { version: 1, algorithm: "AES-256-GCM", nonce: b64(nonce), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function decrypt<T>(envelope: Envelope, keyText: string, aad: string): Promise<T> {
  if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") throw new Error("Unsupported envelope");
  const raw = unb64(keyText), nonce = unb64(envelope.nonce);
  if (raw.length !== 32 || nonce.length !== 12) throw new Error("Invalid envelope");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) }, key, unb64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(decoded));
}
export async function hash(value: string): Promise<string> { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
export async function verifyResult(payload: string, signature: string, keyText: string): Promise<boolean> {
  try { const key = await crypto.subtle.importKey("raw", unb64(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, unb64(signature), unb64(payload));
  } catch { return false; }
}
