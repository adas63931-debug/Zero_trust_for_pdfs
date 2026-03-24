export type WorkerLifecycleStage =
  | 'init'
  | 'progress'
  | 'ready'
  | 'complete'
  | 'error';

export interface WorkerStatusMessage {
  type: 'status';
  requestId?: string;
  stage: Extract<WorkerLifecycleStage, 'init' | 'progress' | 'ready'>;
  message: string;
  progress?: number;
  model: string;
  device: 'webgpu' | 'wasm';
}

export interface WorkerErrorMessage {
  type: 'error';
  requestId?: string;
  message: string;
}

export interface EmbeddingWorkerInitRequest {
  type: 'init';
  requestId: string;
}

export interface EmbeddingWorkerEmbedRequest {
  type: 'embed';
  requestId: string;
  payload: {
    texts: string[];
  };
}

export type EmbeddingWorkerRequest =
  | EmbeddingWorkerInitRequest
  | EmbeddingWorkerEmbedRequest;

export interface EmbeddingWorkerCompleteMessage {
  type: 'complete';
  requestId: string;
  embeddings: Float32Array[];
  dimension: number;
  count: number;
}

export type EmbeddingWorkerResponse =
  | WorkerStatusMessage
  | WorkerErrorMessage
  | EmbeddingWorkerCompleteMessage;

export interface RedactionDictionaryEntry {
  label: string;
  original: string;
}

export interface RedactionSpan {
  start: number;
  end: number;
  label: string;
  placeholder: string;
  text: string;
  score: number;
}

export interface RedactionResult {
  originalText: string;
  redactedText: string;
  dictionary: Record<string, RedactionDictionaryEntry>;
  spans: RedactionSpan[];
}

export interface NERWorkerInitRequest {
  type: 'init';
  requestId: string;
}

export interface NERWorkerRedactRequest {
  type: 'redact';
  requestId: string;
  payload: {
    texts: string[];
  };
}

export type NERWorkerRequest = NERWorkerInitRequest | NERWorkerRedactRequest;

export interface NERWorkerCompleteMessage {
  type: 'complete';
  requestId: string;
  results: RedactionResult[];
}

export type NERWorkerResponse =
  | WorkerStatusMessage
  | WorkerErrorMessage
  | NERWorkerCompleteMessage;
