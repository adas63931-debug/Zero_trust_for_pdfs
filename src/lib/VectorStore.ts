import { v4 as uuidv4 } from 'uuid';

export interface VectorStoreItem<TMetadata = Record<string, unknown>> {
  id: string;
  text: string;
  embedding: Float32Array;
  metadata?: TMetadata;
}

export interface VectorStoreInsert<TMetadata = Record<string, unknown>> {
  id?: string;
  text: string;
  embedding: Float32Array | number[];
  metadata?: TMetadata;
}

export interface VectorSearchResult<TMetadata = Record<string, unknown>>
  extends VectorStoreItem<TMetadata> {
  score: number;
}

interface StoredVectorItem<TMetadata> extends VectorStoreItem<TMetadata> {
  magnitude: number;
}

export class VectorStore<TMetadata = Record<string, unknown>> {
  private readonly items = new Map<string, StoredVectorItem<TMetadata>>();
  private embeddingDimensions: number | null = null;

  add(entry: VectorStoreInsert<TMetadata>): VectorStoreItem<TMetadata> {
    const embedding = this.toFloat32Array(entry.embedding);

    if (embedding.length === 0) {
      throw new Error('Embeddings must contain at least one dimension.');
    }

    if (
      this.embeddingDimensions !== null &&
      embedding.length !== this.embeddingDimensions
    ) {
      throw new Error(
        `Embedding dimension mismatch. Expected ${this.embeddingDimensions}, received ${embedding.length}.`
      );
    }

    this.embeddingDimensions ??= embedding.length;

    const item: StoredVectorItem<TMetadata> = {
      id: entry.id ?? uuidv4(),
      text: entry.text,
      embedding,
      metadata: entry.metadata,
      magnitude: this.computeMagnitude(embedding)
    };

    this.items.set(item.id, item);

    return this.toPublicItem(item);
  }

  addMany(entries: VectorStoreInsert<TMetadata>[]): VectorStoreItem<TMetadata>[] {
    return entries.map((entry) => this.add(entry));
  }

  search(
    queryEmbedding: Float32Array | number[],
    topK = 3
  ): VectorSearchResult<TMetadata>[] {
    if (topK <= 0 || this.items.size === 0) {
      return [];
    }

    const normalizedQuery = this.toFloat32Array(queryEmbedding);
    if (
      this.embeddingDimensions !== null &&
      normalizedQuery.length !== this.embeddingDimensions
    ) {
      throw new Error(
        `Query embedding dimension mismatch. Expected ${this.embeddingDimensions}, received ${normalizedQuery.length}.`
      );
    }

    const queryMagnitude = this.computeMagnitude(normalizedQuery);
    if (queryMagnitude === 0) {
      return [];
    }

    return [...this.items.values()]
      .map((item) => ({
        ...this.toPublicItem(item),
        score: this.cosineSimilarity(
          normalizedQuery,
          queryMagnitude,
          item.embedding,
          item.magnitude
        )
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);
  }

  clear(): void {
    this.items.clear();
    this.embeddingDimensions = null;
  }

  size(): number {
    return this.items.size;
  }

  values(): VectorStoreItem<TMetadata>[] {
    return [...this.items.values()].map((item) => this.toPublicItem(item));
  }

  private toPublicItem(
    item: StoredVectorItem<TMetadata>
  ): VectorStoreItem<TMetadata> {
    return {
      id: item.id,
      text: item.text,
      embedding: new Float32Array(item.embedding),
      metadata: item.metadata
    };
  }

  private toFloat32Array(vector: Float32Array | number[]): Float32Array {
    return vector instanceof Float32Array ? vector : new Float32Array(vector);
  }

  private computeMagnitude(vector: Float32Array): number {
    let sum = 0;

    for (const value of vector) {
      sum += value * value;
    }

    if (!Number.isFinite(sum)) {
      console.warn('Vector math resulted in NaN - check embedding validity.');
      return 0;
    }

    const magnitude = Math.sqrt(sum);

    if (!Number.isFinite(magnitude)) {
      console.warn('Vector math resulted in NaN - check embedding validity.');
      return 0;
    }

    return magnitude;
  }

  private cosineSimilarity(
    leftVector: Float32Array,
    leftMagnitude: number,
    rightVector: Float32Array,
    rightMagnitude: number
  ): number {
    if (
      leftMagnitude === 0 ||
      rightMagnitude === 0 ||
      !Number.isFinite(leftMagnitude) ||
      !Number.isFinite(rightMagnitude)
    ) {
      if (!Number.isFinite(leftMagnitude) || !Number.isFinite(rightMagnitude)) {
        console.warn('Vector math resulted in NaN - check embedding validity.');
      }
      return 0;
    }

    let dotProduct = 0;

    for (let index = 0; index < leftVector.length; index += 1) {
      dotProduct += leftVector[index] * rightVector[index];
    }

    if (!Number.isFinite(dotProduct)) {
      console.warn('Vector math resulted in NaN - check embedding validity.');
      return 0;
    }

    const similarity = dotProduct / (leftMagnitude * rightMagnitude);

    if (!Number.isFinite(similarity)) {
      console.warn('Vector math resulted in NaN - check embedding validity.');
      return 0;
    }

    return similarity;
  }
}
