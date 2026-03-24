import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Chunker } from '@/lib/Chunker';
import { PDFExtractor, type PDFExtractionResult } from '@/lib/PDFExtractor';
import {
  VectorStore,
  type VectorSearchResult,
  type VectorStoreInsert
} from '@/lib/VectorStore';
import type {
  EmbeddingWorkerCompleteMessage,
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse,
  NERWorkerCompleteMessage,
  NERWorkerRequest,
  NERWorkerResponse,
  RedactionResult,
  WorkerStatusMessage
} from '@/workers/types';
import { requestSecureCompletion } from '@/services/llmService';
import { rehydrateResponse } from '@/utils/rehydration';

export type DocumentAIPhase =
  | 'idle'
  | 'initializing'
  | 'processing-document'
  | 'ready'
  | 'querying'
  | 'error';

export interface DocumentChunkMetadata {
  chunkIndex: number;
  length: number;
}

export interface RedactedSearchResult {
  id: string;
  score: number;
  redactedText: string;
  dictionary: RedactionResult['dictionary'];
  spans: RedactionResult['spans'];
  metadata?: DocumentChunkMetadata;
}

export interface DocumentAIWorkerState {
  stage: DocumentAIPhase | WorkerStatusMessage['stage'];
  message: string;
  progress?: number;
  model?: string;
  device?: 'webgpu' | 'wasm';
}

export interface UseDocumentAIState {
  phase: DocumentAIPhase;
  documentName: string | null;
  pageCount: number;
  chunkCount: number;
  extraction: PDFExtractionResult | null;
  results: RedactedSearchResult[];
  error: string | null;
  queryStatusMessage: string | null;
  streamingMessage: StreamingAssistantMessage | null;
  embeddingWorker: DocumentAIWorkerState;
  nerWorker: DocumentAIWorkerState;
}

export interface UseDocumentAIReturn extends UseDocumentAIState {
  processDocument: (file: File) => Promise<void>;
  queryDocument: (query: string) => Promise<DocumentAIQueryResponse>;
  clearDocument: () => void;
}

export interface UseDocumentAIOptions {
  semanticThreshold?: number;
}

export interface PhantomHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type SemanticRoute = 'document' | 'general';

export interface StreamingAssistantMessage {
  content: string;
  createdAt: number;
  route: SemanticRoute;
  routeMessage: string;
  metaIntentOverride: boolean;
  semanticScore: number;
  semanticThreshold: number;
  sanitizedInput: string;
  sanitizedInputDictionary: RedactionResult['dictionary'];
  redactedMatches: RedactedSearchResult[];
}

export interface DocumentAIQueryResponse {
  answer: string;
  sanitizedAnswer: string;
  sanitizedInput: string;
  sanitizedInputDictionary: RedactionResult['dictionary'];
  redactedMatches: RedactedSearchResult[];
  tokenDictionary: Record<string, string>;
  route: SemanticRoute;
  routeMessage: string;
  metaIntentOverride: boolean;
  semanticScore: number;
  semanticThreshold: number;
}

interface WorkerRequestHandlers<TComplete> {
  resolve: (message: TComplete) => void;
  reject: (reason?: unknown) => void;
}

interface PIIDefense {
  regex: RegExp;
  tag: string;
  captureGroup?: number;
}

interface PrefilteredInputRedaction {
  redactedText: string;
  dictionary: RedactionResult['dictionary'];
  tokenDictionary: Record<string, string>;
  appliedCount: number;
}

const DEFAULT_WORKER_STATE: DocumentAIWorkerState = {
  stage: 'idle',
  message: 'Not initialized.'
};

export const DEFAULT_SEMANTIC_THRESHOLD = 0.25;
const META_QUERY_PATTERN =
  /\b(summarize|summary|this pdf|the pdf|this document|the document)\b/i;
const PII_DEFENSES: PIIDefense[] = [
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    tag: '[INPUT_EMAIL]'
  },
  {
    regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    tag: '[INPUT_PHONE]'
  },
  {
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    tag: '[INPUT_CC]'
  },
  {
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    tag: '[INPUT_SSN]'
  },
  {
    regex:
      /(?:my name is|i am|this is|manager|boss|colleague|director|mr\.|mrs\.|ms\.|dr\.)(?:,)?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/gi,
    tag: '[INPUT_PERSON]',
    captureGroup: 1
  },
  {
    regex:
      /(?:lives in|from|located in|traveling to|based in)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/gi,
    tag: '[INPUT_LOCATION]',
    captureGroup: 1
  }
];
const TOKEN_FRAGMENT_PATTERN = /\[[A-Z0-9_]+\]/;

export function useDocumentAI({
  semanticThreshold = DEFAULT_SEMANTIC_THRESHOLD
}: UseDocumentAIOptions = {}): UseDocumentAIReturn {
  const embeddingWorkerRef = useRef<Worker | null>(null);
  const nerWorkerRef = useRef<Worker | null>(null);
  const vectorStoreRef = useRef(new VectorStore<DocumentChunkMetadata>());
  const pendingEmbeddingRequestsRef = useRef(
    new Map<
      string,
      WorkerRequestHandlers<EmbeddingWorkerCompleteMessage>
    >()
  );
  const pendingNERRequestsRef = useRef(
    new Map<string, WorkerRequestHandlers<NERWorkerCompleteMessage>>()
  );
  const [phase, setPhase] = useState<DocumentAIPhase>('idle');
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [extraction, setExtraction] = useState<PDFExtractionResult | null>(null);
  const [results, setResults] = useState<RedactedSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [queryStatusMessage, setQueryStatusMessage] = useState<string | null>(
    null
  );
  const [streamingMessage, setStreamingMessage] =
    useState<StreamingAssistantMessage | null>(null);
  const [phantomHistory, setPhantomHistory] = useState<PhantomHistoryMessage[]>(
    []
  );
  const [embeddingWorker, setEmbeddingWorker] =
    useState<DocumentAIWorkerState>(DEFAULT_WORKER_STATE);
  const [nerWorker, setNerWorker] =
    useState<DocumentAIWorkerState>(DEFAULT_WORKER_STATE);
  const globalTokenDictionaryRef = useRef<Record<string, string>>({});
  const tokenRegistryRef = useRef(new Map<string, string>());
  const tokenCountersRef = useRef<Record<string, number>>({});

  const chunker = useMemo(() => new Chunker(), []);

  useEffect(() => {
    const embeddingWorker = new Worker(
      new URL('../workers/embedding-worker.ts', import.meta.url),
      { type: 'module' }
    );
    const nerWorker = new Worker(
      new URL('../workers/ner-worker.ts', import.meta.url),
      { type: 'module' }
    );

    embeddingWorkerRef.current = embeddingWorker;
    nerWorkerRef.current = nerWorker;

    embeddingWorker.onmessage = (
      event: MessageEvent<EmbeddingWorkerResponse>
    ) => {
      handleEmbeddingWorkerMessage(event.data);
    };

    nerWorker.onmessage = (event: MessageEvent<NERWorkerResponse>) => {
      handleNERWorkerMessage(event.data);
    };

    setPhase('initializing');
    void initializeWorkers();

    return () => {
      embeddingWorker.terminate();
      nerWorker.terminate();
      embeddingWorkerRef.current = null;
      nerWorkerRef.current = null;

      for (const pending of pendingEmbeddingRequestsRef.current.values()) {
        pending.reject(new Error('Embedding worker was terminated.'));
      }
      pendingEmbeddingRequestsRef.current.clear();

      for (const pending of pendingNERRequestsRef.current.values()) {
        pending.reject(new Error('NER worker was terminated.'));
      }
      pendingNERRequestsRef.current.clear();
    };
  }, []);

  const handleEmbeddingWorkerMessage = (message: EmbeddingWorkerResponse): void => {
    if (message.type === 'status') {
      startTransition(() => {
        setEmbeddingWorker({
          stage: message.stage,
          message: message.message,
          progress: message.progress,
          model: message.model,
          device: message.device
        });
      });
      return;
    }

    if (message.type === 'error') {
      const pendingRequest = message.requestId
        ? pendingEmbeddingRequestsRef.current.get(message.requestId)
        : undefined;

      if (pendingRequest) {
        pendingEmbeddingRequestsRef.current.delete(message.requestId!);
        pendingRequest.reject(new Error(message.message));
      }

      setError(message.message);
      setPhase('error');
      return;
    }

    const pendingRequest = pendingEmbeddingRequestsRef.current.get(
      message.requestId
    );

    if (pendingRequest) {
      pendingEmbeddingRequestsRef.current.delete(message.requestId);
      pendingRequest.resolve(message);
    }
  };

  const handleNERWorkerMessage = (message: NERWorkerResponse): void => {
    if (message.type === 'status') {
      startTransition(() => {
        setNerWorker({
          stage: message.stage,
          message: message.message,
          progress: message.progress,
          model: message.model,
          device: message.device
        });
      });
      return;
    }

    if (message.type === 'error') {
      const pendingRequest = message.requestId
        ? pendingNERRequestsRef.current.get(message.requestId)
        : undefined;

      if (pendingRequest) {
        pendingNERRequestsRef.current.delete(message.requestId!);
        pendingRequest.reject(new Error(message.message));
      }

      setError(message.message);
      setPhase('error');
      return;
    }

    const pendingRequest = pendingNERRequestsRef.current.get(message.requestId);

    if (pendingRequest) {
      pendingNERRequestsRef.current.delete(message.requestId);
      pendingRequest.resolve(message);
    }
  };

  const initializeWorkers = async (): Promise<void> => {
    await Promise.all([
      sendEmbeddingRequest({
        type: 'init',
        requestId: uuidv4()
      }),
      sendNERRequest({
        type: 'init',
        requestId: uuidv4()
      })
    ]);

    setPhase('idle');
  };

  const processDocument = async (file: File): Promise<void> => {
    setError(null);
    setDocumentName(null);
    setPageCount(0);
    setChunkCount(0);
    setExtraction(null);
    setResults([]);
    setQueryStatusMessage(null);
    setStreamingMessage(null);
    setPhase('processing-document');
    vectorStoreRef.current.clear();

    try {
      const extracted = await PDFExtractor.extract(file);
      const chunks = chunker.split(extracted.fullText);
      const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));

      const records: VectorStoreInsert<DocumentChunkMetadata>[] = chunks.map(
        (chunk, index) => ({
          text: chunk.text,
          embedding: embeddings[index],
          metadata: {
            chunkIndex: chunk.index,
            length: chunk.length
          }
        })
      );

      vectorStoreRef.current.addMany(records);

      startTransition(() => {
        setDocumentName(file.name);
        setPageCount(extracted.pageCount);
        setChunkCount(chunks.length);
        setExtraction(extracted);
        setPhase('ready');
      });
    } catch (processingError) {
      const message =
        processingError instanceof Error
          ? processingError.message
          : 'Failed to process document.';
      setError(message);
      setPhase('error');
      throw processingError;
    }
  };

  const queryDocument = async (
    query: string
  ): Promise<DocumentAIQueryResponse> => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        answer: '',
        sanitizedAnswer: '',
        sanitizedInput: '',
        sanitizedInputDictionary: {},
        redactedMatches: [],
        tokenDictionary: {},
        route: 'general',
        routeMessage: 'Bypassing document index (empty query). Engaging general AI mode.',
        metaIntentOverride: false,
        semanticScore: 0,
        semanticThreshold
      };
    }

    setError(null);
    setQueryStatusMessage('Sanitizing input...');
    setPhase('querying');

    try {
      const {
        sanitizedInput,
        sanitizedInputDictionary,
        tokenDictionary: inputTokenDictionary
      } = await sanitizeInputWithDefenses(trimmedQuery);
      const nextPhantomHistory = [
        ...phantomHistory,
        {
          role: 'user' as const,
          content: sanitizedInput
        }
      ];

      setPhantomHistory(nextPhantomHistory);

      setQueryStatusMessage('Searching document...');
      const semanticMatches =
        vectorStoreRef.current.size() > 0
          ? vectorStoreRef.current.search(
              (await embedTexts([trimmedQuery]))[0],
              5
            )
          : [];
      const topSemanticScore = semanticMatches[0]?.score ?? 0;
      const metaIntentOverride =
        vectorStoreRef.current.size() > 0 &&
        META_QUERY_PATTERN.test(sanitizedInput);
      const route: SemanticRoute =
        metaIntentOverride ||
        (semanticMatches.length > 0 && topSemanticScore >= semanticThreshold)
          ? 'document'
          : 'general';
      const routeMessage =
        metaIntentOverride
          ? 'Meta-intent override detected. Using local document context for a document-level request.'
          : route === 'document'
          ? `Using document context (${(topSemanticScore * 100).toFixed(1)}% semantic match).`
          : semanticMatches.length === 0
            ? 'Bypassing document index (no local document context available). Engaging general AI mode.'
            : 'Bypassing document index (low semantic match). Engaging general AI mode.';
      const routedMatches =
        route === 'document'
          ? metaIntentOverride
            ? buildMetaIntentMatches(
                vectorStoreRef.current.values(),
                semanticMatches,
                5
              )
            : semanticMatches.slice(0, 3)
          : [];

      const { redactedMatches, tokenDictionary: chunkTokenDictionary } =
        route === 'document'
          ? promoteRedactedResults(
              combineResults(
                routedMatches,
                await redactTexts(routedMatches.map((match) => match.text))
              )
            )
          : {
              redactedMatches: [],
              tokenDictionary: {}
            };
      const tokenDictionary = {
        ...globalTokenDictionaryRef.current,
        ...inputTokenDictionary,
        ...chunkTokenDictionary
      };
      const streamingContext = {
        createdAt: Date.now(),
        route,
        routeMessage,
        metaIntentOverride,
        semanticScore: topSemanticScore,
        semanticThreshold,
        sanitizedInput,
        sanitizedInputDictionary,
        redactedMatches
      };
      let rawAccumulatedAnswer = '';

      setQueryStatusMessage(
        route === 'document'
          ? 'Streaming document response...'
          : 'Streaming general AI response...'
      );
      setStreamingMessage({
        ...streamingContext,
        content: ''
      });
      const sanitizedAnswer = await requestSecureCompletion({
        conversationHistory: nextPhantomHistory,
        sanitizedChunks: redactedMatches.map((match) => match.redactedText),
        useContext: route === 'document',
        onDelta: (delta) => {
          rawAccumulatedAnswer += delta;

          startTransition(() => {
            setStreamingMessage({
              ...streamingContext,
              content: sanitizeStreamingDisplay(
                rehydrateResponse(
                  rawAccumulatedAnswer,
                  globalTokenDictionaryRef.current
                )
              )
            });
          });
        }
      });
      setPhantomHistory([
        ...nextPhantomHistory,
        {
          role: 'assistant',
          content: sanitizedAnswer
        }
      ]);

      const answer = rehydrateResponse(
        sanitizedAnswer,
        globalTokenDictionaryRef.current
      );

      startTransition(() => {
        setResults(redactedMatches);
        setStreamingMessage(null);
        setQueryStatusMessage(null);
        setPhase('ready');
      });

      return {
        answer,
        sanitizedAnswer,
        sanitizedInput,
        sanitizedInputDictionary,
        redactedMatches,
        tokenDictionary,
        route,
        routeMessage,
        metaIntentOverride,
        semanticScore: topSemanticScore,
        semanticThreshold
      };
    } catch (queryError) {
      const message =
        queryError instanceof Error ? queryError.message : 'Query failed.';
      setError(message);
      setStreamingMessage(null);
      setQueryStatusMessage(null);
      setPhase('error');
      throw queryError;
    }
  };

  const clearDocument = (): void => {
    vectorStoreRef.current.clear();
    setDocumentName(null);
    setPageCount(0);
    setChunkCount(0);
    setExtraction(null);
    setResults([]);
    setError(null);
    setQueryStatusMessage(null);
    setStreamingMessage(null);
    setPhase('idle');
  };

  const sendEmbeddingRequest = (
    request: EmbeddingWorkerRequest
  ): Promise<EmbeddingWorkerCompleteMessage> => {
    const worker = embeddingWorkerRef.current;
    if (!worker) {
      return Promise.reject(new Error('Embedding worker is not available.'));
    }

    return new Promise<EmbeddingWorkerCompleteMessage>((resolve, reject) => {
      pendingEmbeddingRequestsRef.current.set(request.requestId, {
        resolve,
        reject
      });

      worker.postMessage(request);
    });
  };

  const sendNERRequest = (
    request: NERWorkerRequest
  ): Promise<NERWorkerCompleteMessage> => {
    const worker = nerWorkerRef.current;
    if (!worker) {
      return Promise.reject(new Error('NER worker is not available.'));
    }

    return new Promise<NERWorkerCompleteMessage>((resolve, reject) => {
      pendingNERRequestsRef.current.set(request.requestId, {
        resolve,
        reject
      });

      worker.postMessage(request);
    });
  };

  const embedTexts = async (texts: string[]): Promise<Float32Array[]> => {
    const response = await sendEmbeddingRequest({
      type: 'embed',
      requestId: uuidv4(),
      payload: {
        texts
      }
    });

    return response.embeddings;
  };

  const redactTexts = async (texts: string[]): Promise<RedactionResult[]> => {
    const response = await sendNERRequest({
      type: 'redact',
      requestId: uuidv4(),
      payload: {
        texts
      }
    });

    return response.results;
  };

  const resetConversationMemory = (): void => {
    setPhantomHistory([]);
    globalTokenDictionaryRef.current = {};
    tokenRegistryRef.current = new Map<string, string>();
    tokenCountersRef.current = {};
  };

  const sanitizeInputWithDefenses = async (rawInput: string) => {
    const prefilteredInput = applyPIIDefenses(rawInput);

    if (!shouldRunNERForInput(prefilteredInput.redactedText)) {
      return {
        sanitizedInput: prefilteredInput.redactedText,
        sanitizedInputDictionary: prefilteredInput.dictionary,
        tokenDictionary: prefilteredInput.tokenDictionary
      };
    }

    const [inputRedaction] = await redactTexts([prefilteredInput.redactedText]);

    return promoteInputRedaction(inputRedaction, prefilteredInput);
  };

  const applyPIIDefenses = (rawInput: string): PrefilteredInputRedaction => {
    let redactedText = rawInput;
    const dictionary: RedactionResult['dictionary'] = {};
    const tokenDictionary: Record<string, string> = {};
    let appliedCount = 0;

    for (const defense of PII_DEFENSES) {
      defense.regex.lastIndex = 0;

      redactedText = redactedText.replace(defense.regex, (...args) => {
        const fullMatch = args[0];
        const capturedValue =
          typeof defense.captureGroup === 'number'
            ? String(args[defense.captureGroup] ?? '')
            : fullMatch;
        const originalValue = capturedValue.trim();

        if (!originalValue || TOKEN_FRAGMENT_PATTERN.test(originalValue)) {
          return fullMatch;
        }

        const sessionToken = getOrCreateSessionToken(defense.tag, originalValue);
        const normalizedTag = normalizeTokenLabel(defense.tag);

        dictionary[sessionToken] = {
          label: normalizedTag,
          original: originalValue
        };
        tokenDictionary[sessionToken] = originalValue;
        appliedCount += 1;

        if (typeof defense.captureGroup === 'number') {
          return fullMatch.replace(originalValue, sessionToken);
        }

        return sessionToken;
      });
    }

    return {
      redactedText,
      dictionary,
      tokenDictionary,
      appliedCount
    };
  };

  const promoteInputRedaction = (
    inputRedaction: RedactionResult,
    prefilteredInput?: PrefilteredInputRedaction
  ) => {
    const {
      redactedText: sanitizedInput,
      dictionary: sanitizedInputDictionary,
      tokenDictionary
    } = promoteSanitizedText({
      redactedText: inputRedaction.redactedText,
      dictionary: inputRedaction.dictionary,
      spans: inputRedaction.spans
    });

    return {
      sanitizedInput,
      sanitizedInputDictionary: {
        ...(prefilteredInput?.dictionary ?? {}),
        ...sanitizedInputDictionary
      },
      tokenDictionary: {
        ...(prefilteredInput?.tokenDictionary ?? {}),
        ...tokenDictionary
      }
    };
  };

  const promoteRedactedResults = (redactedMatches: RedactedSearchResult[]) => {
    const tokenDictionary: Record<string, string> = {};

    const promotedMatches = redactedMatches.map((match) => {
      const promoted = promoteSanitizedText({
        redactedText: match.redactedText,
        dictionary: match.dictionary,
        spans: match.spans
      });

      Object.assign(tokenDictionary, promoted.tokenDictionary);

      return {
        ...match,
        redactedText: promoted.redactedText,
        dictionary: promoted.dictionary,
        spans: promoted.spans
      };
    });

    return {
      redactedMatches: promotedMatches,
      tokenDictionary
    };
  };

  const promoteSanitizedText = ({
    redactedText,
    dictionary,
    spans
  }: Pick<RedactionResult, 'redactedText' | 'dictionary' | 'spans'>) => {
    let promotedText = redactedText;
    const promotedDictionary: RedactionResult['dictionary'] = {};
    const promotedSpans = spans.map((span) => ({ ...span }));
    const tokenDictionary: Record<string, string> = {};

    for (const [token, entry] of Object.entries(dictionary)) {
      const sessionToken = getOrCreateSessionToken(entry.label, entry.original);
      promotedText = promotedText.replaceAll(token, sessionToken);
      promotedDictionary[sessionToken] = entry;
      tokenDictionary[sessionToken] = entry.original;

      for (const span of promotedSpans) {
        if (span.placeholder === token) {
          span.placeholder = sessionToken;
        }
      }
    }

    return {
      redactedText: promotedText,
      dictionary: promotedDictionary,
      spans: promotedSpans,
      tokenDictionary
    };
  };

  const getOrCreateSessionToken = (label: string, original: string): string => {
    const normalizedLabel = normalizeTokenLabel(label);
    const fingerprint = `${normalizedLabel}::${original}`;
    const existingToken = tokenRegistryRef.current.get(fingerprint);

    if (existingToken) {
      return existingToken;
    }

    const nextIndex = (tokenCountersRef.current[normalizedLabel] ?? 0) + 1;
    tokenCountersRef.current[normalizedLabel] = nextIndex;

    const sessionToken = `[${normalizedLabel}_${nextIndex}]`;

    tokenRegistryRef.current.set(fingerprint, sessionToken);
    globalTokenDictionaryRef.current[sessionToken] = original;

    return sessionToken;
  };

  return {
    phase,
    documentName,
    pageCount,
    chunkCount,
    extraction,
    results,
    error,
    queryStatusMessage,
    streamingMessage,
    embeddingWorker,
    nerWorker,
    processDocument,
    queryDocument,
    clearDocument
  };
}

function combineResults(
  matches: VectorSearchResult<DocumentChunkMetadata>[],
  redactions: RedactionResult[]
): RedactedSearchResult[] {
  return matches.map((match, index) => {
    const redaction = redactions[index];

    return {
      id: match.id,
      score: match.score,
      redactedText: redaction?.redactedText ?? match.text,
      dictionary: redaction?.dictionary ?? {},
      spans: redaction?.spans ?? [],
      metadata: match.metadata
    };
  });
}

function buildMetaIntentMatches(
  items: Array<{
    id: string;
    text: string;
    embedding: Float32Array;
    metadata?: DocumentChunkMetadata;
  }>,
  semanticMatches: VectorSearchResult<DocumentChunkMetadata>[],
  limit: number
): VectorSearchResult<DocumentChunkMetadata>[] {
  const scoreById = new Map(semanticMatches.map((match) => [match.id, match.score]));

  return [...items]
    .sort(
      (left, right) =>
        (left.metadata?.chunkIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.metadata?.chunkIndex ?? Number.MAX_SAFE_INTEGER)
    )
    .slice(0, limit)
    .map((item) => ({
      ...item,
      score: scoreById.get(item.id) ?? 0
    }));
}

function normalizeTokenLabel(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'ENTITY';
}

function shouldRunNERForInput(text: string): boolean {
  const remainder = text.replace(/\[[A-Z0-9_]+\]/g, ' ').trim();

  return /[A-Za-z]{2,}/.test(remainder);
}

function sanitizeStreamingDisplay(text: string): string {
  const lastOpenBracket = text.lastIndexOf('[');
  const lastCloseBracket = text.lastIndexOf(']');

  if (lastOpenBracket <= lastCloseBracket) {
    return text;
  }

  const trailingFragment = text.slice(lastOpenBracket + 1);

  return /^[A-Z0-9_]+$/.test(trailingFragment)
    ? text.slice(0, lastOpenBracket)
    : text;
}
