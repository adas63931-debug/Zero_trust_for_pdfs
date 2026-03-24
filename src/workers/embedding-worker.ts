/// <reference lib="webworker" />

import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressInfo
} from '@huggingface/transformers';
import ortWasmSimdThreadedJsepMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasmSimdThreadedJsepWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import ortWasmSimdThreadedMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmSimdThreadedWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import type {
  EmbeddingWorkerCompleteMessage,
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse,
  WorkerErrorMessage,
  WorkerStatusMessage
} from './types';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const WORKER_DEVICE: 'webgpu' | 'wasm' =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
const configureONNXEnvironment = env.backends.onnx as {
  wasm?: {
    wasmPaths?:
      | string
      | {
          mjs?: string;
          wasm?: string;
        };
  };
};
const createFeatureExtractionPipeline = pipeline as (
  task: 'feature-extraction',
  model: string,
  options: {
    progress_callback?: (progress: ProgressInfo) => void;
    device: 'webgpu' | 'wasm';
  }
) => Promise<FeatureExtractionPipeline>;

env.allowLocalModels = false;
env.useBrowserCache = true;
configureONNXEnvironment.wasm = configureONNXEnvironment.wasm ?? {};
configureONNXEnvironment.wasm.wasmPaths =
  WORKER_DEVICE === 'webgpu'
    ? {
        mjs: ortWasmSimdThreadedJsepMjsUrl,
        wasm: ortWasmSimdThreadedJsepWasmUrl
      }
    : {
        mjs: ortWasmSimdThreadedMjsUrl,
        wasm: ortWasmSimdThreadedWasmUrl
      };

class EmbeddingPipelineSingleton {
  private static instance: Promise<FeatureExtractionPipeline> | null = null;

  static getInstance(
    progress_callback?: (progress: ProgressInfo) => void
  ): Promise<FeatureExtractionPipeline> {
    if (!this.instance) {
      this.instance = createFeatureExtractionPipeline('feature-extraction', MODEL_NAME, {
        progress_callback,
        device: WORKER_DEVICE
      });
    }

    return this.instance;
  }
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<EmbeddingWorkerRequest>) => {
  const { data } = event;

  try {
    switch (data.type) {
      case 'init': {
        await initializeModel(data.requestId);
        break;
      }
      case 'embed': {
        await embedTexts(data.requestId, data.payload.texts);
        break;
      }
      default: {
        postError(`Unsupported embedding worker message type.`, data);
      }
    }
  } catch (error) {
    postError(
      error instanceof Error ? error.message : 'Embedding worker failed.',
      data
    );
  }
};

async function initializeModel(requestId: string): Promise<void> {
  postStatus({
    requestId,
    stage: 'init',
    message: 'Initializing embedding pipeline...'
  });

  await EmbeddingPipelineSingleton.getInstance((progress) => {
    postProgress(progress, requestId);
  });

  postStatus({
    requestId,
    stage: 'ready',
    message: 'Embedding pipeline is ready.'
  });

  const response: EmbeddingWorkerCompleteMessage = {
    type: 'complete',
    requestId,
    embeddings: [],
    dimension: 0,
    count: 0
  };

  workerScope.postMessage(response satisfies EmbeddingWorkerResponse);
}

async function embedTexts(requestId: string, texts: string[]): Promise<void> {
  if (texts.length === 0) {
    const response: EmbeddingWorkerCompleteMessage = {
      type: 'complete',
      requestId,
      embeddings: [],
      dimension: 0,
      count: 0
    };
    workerScope.postMessage(response);
    return;
  }

  const extractor = await EmbeddingPipelineSingleton.getInstance((progress) => {
    postProgress(progress, requestId);
  });

  postStatus({
    requestId,
    stage: 'ready',
    message: 'Embedding pipeline ready. Generating vectors...'
  });

  const tensor = await extractor(texts, {
    pooling: 'mean',
    normalize: true
  });

  const count = Array.isArray(texts) ? texts.length : 1;
  const dimension = tensor.dims.at(-1) ?? 0;
  const embeddings = Array.from({ length: count }, (_, index) => {
    const start = index * dimension;
    const end = start + dimension;
    return new Float32Array(tensor.data.slice(start, end));
  });

  const response: EmbeddingWorkerCompleteMessage = {
    type: 'complete',
    requestId,
    embeddings,
    dimension,
    count
  };

  workerScope.postMessage(
    response satisfies EmbeddingWorkerResponse,
    embeddings.map((embedding) => embedding.buffer)
  );
}

function postProgress(progress: ProgressInfo, requestId?: string): void {
  const total =
    'total' in progress && typeof progress.total === 'number'
      ? progress.total
      : undefined;
  const loaded =
    'loaded' in progress && typeof progress.loaded === 'number'
      ? progress.loaded
      : undefined;

  postStatus({
    requestId,
    stage: 'progress',
    message:
      'file' in progress && typeof progress.file === 'string'
        ? `Loading ${progress.file}`
        : `Embedding model progress: ${progress.status}`,
    progress:
      total && loaded !== undefined && total > 0 ? loaded / total : undefined
  });
}

function postStatus({
  requestId,
  stage,
  message,
  progress
}: Omit<WorkerStatusMessage, 'type' | 'model' | 'device'>): void {
  const response: WorkerStatusMessage = {
    type: 'status',
    requestId,
    stage,
    message,
    progress,
    model: MODEL_NAME,
    device: WORKER_DEVICE
  };

  workerScope.postMessage(response satisfies EmbeddingWorkerResponse);
}

function postError(
  message: string,
  request?: Partial<EmbeddingWorkerRequest>
): void {
  const response: WorkerErrorMessage = {
    type: 'error',
    requestId: request?.requestId,
    message
  };

  workerScope.postMessage(response satisfies EmbeddingWorkerResponse);
}

export {};
