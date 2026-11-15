export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** Base64 of a file; FileReader is fast and memory-friendly in browsers. */
export function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    return blob.arrayBuffer().then((buffer) => bytesToBase64(new Uint8Array(buffer)));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
}

/** Short content hash for file names (first 8 hex chars of SHA-1). */
export async function shortHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  return Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
