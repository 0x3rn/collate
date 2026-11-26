import { isSafeAcademicImageUrl } from "./figure-layout";
import { parseMarkdownToBlocks } from "@/lib/writing/editor-blocks";

export interface ResolvedExportFigureAsset {
  url: string;
  mimeType: "image/jpeg" | "image/png";
  docxType: "jpg" | "png";
  bytes: Uint8Array;
  dataUrl: string;
  naturalWidth: number | null;
  naturalHeight: number | null;
}

const MAX_FIGURE_BYTES = 4 * 1024 * 1024; // 4 MB safety cap per image

export function detectImageFormatFromBytes(
  bytes: Uint8Array
): { mimeType: "image/jpeg" | "image/png"; docxType: "jpg" | "png" } | null {
  if (bytes.byteLength < 8) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", docxType: "png" };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", docxType: "jpg" };
  }
  return null;
}

/**
 * Reads exact pixel width & height from PNG IHDR or JPEG SOF0/SOF2 headers without external libs.
 */
export function extractImageDimensionsFromBytes(
  bytes: Uint8Array,
  docxType: "jpg" | "png"
): { width: number; height: number } | null {
  if (docxType === "png" && bytes.byteLength >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) return { width, height };
    return null;
  }

  if (docxType === "jpg" && bytes.byteLength >= 10) {
    let offset = 2;
    while (offset + 9 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1]!;
      offset += 2;
      // Standalone markers without length
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > bytes.byteLength) break;
      const segLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (segLength < 2 || offset + segLength > bytes.byteLength) break;
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 7 < bytes.byteLength) {
        const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
        const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        if (width > 0 && height > 0) return { width, height };
      }
      offset += segLength;
    }
  }

  return null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Fetches verified external academic figure bytes once per export so both PDF (inline data URI)
 * and native Word (.docx ImageRun) render crisp embedded images with zero broken links.
 */
export async function resolveExportFiguresForChapters(
  chapters: Array<{ markdown: string }>,
  options: { fetchFn?: typeof fetch; timeoutMs?: number; maxImages?: number } = {}
): Promise<Record<string, ResolvedExportFigureAsset>> {
  const uniqueUrls = new Set<string>();
  const maxImages = options.maxImages ?? 16;

  for (const ch of chapters) {
    for (const block of parseMarkdownToBlocks(ch.markdown)) {
      if (block.type === "figure" && isSafeAcademicImageUrl(block.figure.url)) {
        uniqueUrls.add(block.figure.url);
        if (uniqueUrls.size >= maxImages) break;
      }
    }
    if (uniqueUrls.size >= maxImages) break;
  }

  if (uniqueUrls.size === 0) return {};

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const resolved: Record<string, ResolvedExportFigureAsset> = {};

  await Promise.all(
    Array.from(uniqueUrls).map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(url, {
          method: "GET",
          headers: {
            accept: "image/jpeg,image/png,*/*;q=0.5",
            "user-agent": "CollateAcademicExport/1.0 (https://collateresearch.app)",
          },
          signal: controller.signal,
        });
        if (!res.ok) return;

        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_FIGURE_BYTES) return;

        const bytes = new Uint8Array(arrayBuf);
        const format = detectImageFormatFromBytes(bytes);
        if (!format) return;

        const dims = extractImageDimensionsFromBytes(bytes, format.docxType);
        const dataUrl = `data:${format.mimeType};base64,${uint8ToBase64(bytes)}`;

        resolved[url] = {
          url,
          mimeType: format.mimeType,
          docxType: format.docxType,
          bytes,
          dataUrl,
          naturalWidth: dims?.width ?? null,
          naturalHeight: dims?.height ?? null,
        };
      } catch {
        // Non-fatal: export degrades cleanly to caption + attribution if an upstream host times out
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return resolved;
}
