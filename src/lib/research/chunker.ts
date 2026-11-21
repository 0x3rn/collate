export interface TextPassageChunk {
  passageIndex: number;
  text: string;
  location: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetWords?: number;
  overlapWords?: number;
  maxPassages?: number;
  locationPrefix?: string;
}

export function estimateTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

export function chunkSourceText(rawText: string, options: ChunkOptions = {}): TextPassageChunk[] {
  const cleaned = rawText.trim();
  if (!cleaned) return [];

  const targetWords = options.targetWords ?? 240;
  const overlapWords = Math.min(Math.floor(targetWords / 3), options.overlapWords ?? 40);
  const maxPassages = options.maxPassages ?? 25;
  const locationPrefix = options.locationPrefix ?? "section";

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= targetWords) {
    return [
      {
        passageIndex: 0,
        text: words.join(" "),
        location: locationPrefix === "abstract" ? "abstract" : `${locationPrefix}_1`,
        tokenCount: estimateTokenCount(cleaned),
      },
    ];
  }

  const chunks: TextPassageChunk[] = [];
  const stepSize = Math.max(1, targetWords - overlapWords);
  let start = 0;

  while (start < words.length && chunks.length < maxPassages) {
    const slice = words.slice(start, start + targetWords);
    if (slice.length < 25 && chunks.length > 0) {
      const prev = chunks[chunks.length - 1]!;
      const merged = `${prev.text} ${slice.join(" ")}`;
      prev.text = merged;
      prev.tokenCount = estimateTokenCount(merged);
      break;
    }

    const text = slice.join(" ");
    chunks.push({
      passageIndex: chunks.length,
      text,
      location: `${locationPrefix}_${chunks.length + 1}`,
      tokenCount: estimateTokenCount(text),
    });

    if (start + targetWords >= words.length) break;
    start += stepSize;
  }

  return chunks;
}
