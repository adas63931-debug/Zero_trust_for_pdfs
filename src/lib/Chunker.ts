export interface ChunkerOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export interface TextChunk {
  index: number;
  text: string;
  length: number;
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

export class Chunker {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly separators: string[];

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1000;
    this.chunkOverlap = options.chunkOverlap ?? 200;
    this.separators = options.separators ?? DEFAULT_SEPARATORS;

    if (this.chunkSize <= 0) {
      throw new Error('chunkSize must be greater than 0.');
    }

    if (this.chunkOverlap < 0) {
      throw new Error('chunkOverlap must be 0 or greater.');
    }

    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error('chunkOverlap must be smaller than chunkSize.');
    }
  }

  split(text: string): TextChunk[] {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }

    const atomicSplits = this.splitRecursively(normalized, this.separators);
    const mergedChunks = this.mergeSplits(atomicSplits);

    return mergedChunks.map((chunk, index) => ({
      index,
      text: chunk,
      length: chunk.length
    }));
  }

  private splitRecursively(text: string, separators: string[]): string[] {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }

    if (normalized.length <= this.chunkSize) {
      return [normalized];
    }

    const separator = this.selectSeparator(normalized, separators);
    if (separator === '') {
      return this.splitByLength(normalized);
    }

    const nextSeparators = separators.slice(separators.indexOf(separator) + 1);
    const rawSplits = this.splitWithSeparator(normalized, separator);
    const results: string[] = [];

    for (const split of rawSplits) {
      const segment = split.trim();
      if (!segment) {
        continue;
      }

      if (segment.length <= this.chunkSize) {
        results.push(segment);
        continue;
      }

      results.push(
        ...this.splitRecursively(segment, nextSeparators.length ? nextSeparators : [''])
      );
    }

    return results;
  }

  private selectSeparator(text: string, separators: string[]): string {
    for (const separator of separators) {
      if (separator === '' || text.includes(separator)) {
        return separator;
      }
    }

    return '';
  }

  private splitWithSeparator(text: string, separator: string): string[] {
    if (separator === '') {
      return text.split('');
    }

    const results: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      const separatorIndex = text.indexOf(separator, startIndex);

      if (separatorIndex === -1) {
        results.push(text.slice(startIndex));
        break;
      }

      const endIndex = separatorIndex + separator.length;
      results.push(text.slice(startIndex, endIndex));
      startIndex = endIndex;
    }

    return results;
  }

  private mergeSplits(splits: string[]): string[] {
    const chunks: string[] = [];
    let currentSegments: string[] = [];
    let currentLength = 0;

    for (const split of splits) {
      if (split.length > this.chunkSize) {
        if (currentSegments.length) {
          chunks.push(this.normalizeChunk(currentSegments.join('')));
          currentSegments = [];
          currentLength = 0;
        }

        chunks.push(...this.splitByLength(split));
        continue;
      }

      if (
        currentSegments.length > 0 &&
        currentLength + split.length > this.chunkSize
      ) {
        chunks.push(this.normalizeChunk(currentSegments.join('')));
        ({ currentSegments, currentLength } = this.trimToOverlap(currentSegments));
      }

      currentSegments.push(split);
      currentLength += split.length;
    }

    if (currentSegments.length > 0) {
      chunks.push(this.normalizeChunk(currentSegments.join('')));
    }

    return chunks.filter(
      (chunk, index) => chunk.length > 0 && chunk !== chunks[index - 1]
    );
  }

  private trimToOverlap(segments: string[]): {
    currentSegments: string[];
    currentLength: number;
  } {
    const overlapSegments = [...segments];
    let overlapLength = overlapSegments.reduce(
      (total, segment) => total + segment.length,
      0
    );

    while (overlapSegments.length > 0 && overlapLength > this.chunkOverlap) {
      const removed = overlapSegments.shift();
      overlapLength -= removed?.length ?? 0;
    }

    return {
      currentSegments: overlapSegments,
      currentLength: overlapLength
    };
  }

  private splitByLength(text: string): string[] {
    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + this.chunkSize, text.length);
      const slice = this.normalizeChunk(text.slice(startIndex, endIndex));

      if (slice) {
        chunks.push(slice);
      }

      if (endIndex === text.length) {
        break;
      }

      startIndex = Math.max(endIndex - this.chunkOverlap, startIndex + 1);
    }

    return chunks;
  }

  private normalizeChunk(chunk: string): string {
    return chunk
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
}
