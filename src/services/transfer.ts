import { APP_DATA_VERSION, parseAppData, type RecordItem } from "../models/record";

const PREFIX = "RT1:";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("인코딩 형식이 올바르지 않습니다.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function transform(value: Uint8Array, mode: "compress" | "decompress"): Promise<Uint8Array> {
  const supported = mode === "compress" ? "CompressionStream" in window : "DecompressionStream" in window;
  if (!supported) throw new Error("이 브라우저는 압축 전송을 지원하지 않습니다.");
  const stream = mode === "compress" ? new CompressionStream("gzip") : new DecompressionStream("gzip");
  const safeBytes = new Uint8Array(value.byteLength);
  safeBytes.set(value);
  const output = new Blob([safeBytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function exportRecords(records: RecordItem[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: APP_DATA_VERSION, records }));
  return `${PREFIX}${bytesToBase64Url(await transform(bytes, "compress"))}`;
}

export async function importRecords(value: string): Promise<RecordItem[]> {
  const trimmed = value.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error("지원하지 않는 형식입니다. RT1: 문자열을 사용하세요.");
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(await transform(base64UrlToBytes(trimmed.slice(PREFIX.length)), "decompress")));
    const data = parseAppData(decoded);
    if (data === null) throw new Error("데이터 구조 또는 버전이 올바르지 않습니다.");
    return data.records;
  } catch (error) {
    if (error instanceof Error && error.message !== "The string to be decoded is not correctly encoded.") throw error;
    throw new Error("손상되었거나 읽을 수 없는 가져오기 문자열입니다.");
  }
}
