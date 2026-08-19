export function sha256(bytes: string | Uint8Array): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(bytes);
  return `sha256-${hash.digest("hex")}`;
}
