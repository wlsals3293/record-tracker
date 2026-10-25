import { parseRecords, serializeRecord, type RecordItem } from "../models/record";

const PREFIX = "RT2:";
const LEGACY_PREFIX = "RT1:";
const TRANSFER_DATA_VERSION = 2;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, bytes.length);
    binary += String.fromCharCode.apply(null, bytes.subarray(start, end) as unknown as number[]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("인코딩 형식이 올바르지 않습니다.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function transform(value: Uint8Array, mode: "compress" | "decompress"): Promise<Uint8Array> {
  const supported = mode === "compress"
    ? typeof CompressionStream !== "undefined"
    : typeof DecompressionStream !== "undefined";
  if (!supported) throw new Error("이 브라우저는 압축 전송을 지원하지 않습니다.");
  const stream = mode === "compress" ? new CompressionStream("gzip") : new DecompressionStream("gzip");
  const output = new Blob([value as unknown as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function exportRecords(records: RecordItem[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: TRANSFER_DATA_VERSION, records: records.map(serializeRecord) }));
  return `${PREFIX}${bytesToBase64Url(await transform(bytes, "compress"))}`;
}

export async function importRecords(value: string): Promise<RecordItem[]> {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith(PREFIX) ? PREFIX : trimmed.startsWith(LEGACY_PREFIX) ? LEGACY_PREFIX : null;
  if (prefix === null) throw new Error("지원하지 않는 형식입니다. RT1: 또는 RT2: 문자열을 사용하세요.");
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(await transform(base64UrlToBytes(trimmed.slice(prefix.length)), "decompress")));
    if (
      typeof decoded !== "object" || decoded === null || Array.isArray(decoded) ||
      !Object.hasOwn(decoded, "version") || !Object.hasOwn(decoded, "records") ||
      (decoded as { version: unknown }).version !== (prefix === PREFIX ? TRANSFER_DATA_VERSION : 1)
    ) {
      throw new Error("데이터 구조 또는 버전이 올바르지 않습니다.");
    }
    const records = parseRecords((decoded as { records: unknown }).records);
    if (records === null) throw new Error("데이터 구조 또는 버전이 올바르지 않습니다.");
    return records;
  } catch (error) {
    if (error instanceof Error && error.message !== "The string to be decoded is not correctly encoded.") throw error;
    throw new Error("손상되었거나 읽을 수 없는 가져오기 문자열입니다.");
  }
}
