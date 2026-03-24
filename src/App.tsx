import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { v4 as uuidv4 } from 'uuid';
import {
  ChatMessage,
  type ConversationMessage
} from '@/components/ChatMessage';
import {
  DEFAULT_SEMANTIC_THRESHOLD,
  useDocumentAI
} from '@/hooks/useDocumentAI';

interface PipelineStep {
  label: string;
  hint: string;
  state: 'pending' | 'active' | 'complete';
}

function App() {
  const {
    phase,
    documentName,
    pageCount,
    chunkCount,
    results,
    error,
    queryStatusMessage,
    streamingMessage,
    embeddingWorker,
    nerWorker,
    processDocument,
    queryDocument,
    clearDocument
  } = useDocumentAI({
    semanticThreshold: DEFAULT_SEMANTIC_THRESHOLD
  });

  const [displayHistory, setDisplayHistory] = useState<ConversationMessage[]>([]);
  const [composer, setComposer] = useState('');
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [processingStepIndex, setProcessingStepIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedInspectorId, setSelectedInspectorId] = useState<string | null>(
    null
  );
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const toolsPanelRef = useRef<HTMLDivElement | null>(null);

  const isInitializing = phase === 'initializing';
  const isProcessing = phase === 'processing-document';
  const isQuerying = phase === 'querying';
  const hasDocument = Boolean(documentName);
  const canQuery = !isInitializing && !isProcessing && !isQuerying;
  const displayError = surfaceError ?? error;

  useEffect(() => {
    if (!messageViewportRef.current) {
      return;
    }

    messageViewportRef.current.scrollTo({
      top: messageViewportRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [displayHistory, streamingMessage?.content, isQuerying]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (
        toolsPanelRef.current &&
        !toolsPanelRef.current.contains(event.target as Node)
      ) {
        setToolsOpen(false);
      }
    };

    if (toolsOpen) {
      window.addEventListener('mousedown', handlePointerDown);
    }

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [toolsOpen]);

  useEffect(() => {
    if (!isProcessing) {
      setProcessingStepIndex(0);
      return;
    }

    setProcessingStepIndex(0);

    const chunkTimer = window.setTimeout(() => {
      setProcessingStepIndex((current) => Math.max(current, 1));
    }, 550);
    const embedTimer = window.setTimeout(() => {
      setProcessingStepIndex((current) => Math.max(current, 2));
    }, 1350);

    return () => {
      window.clearTimeout(chunkTimer);
      window.clearTimeout(embedTimer);
    };
  }, [isProcessing, activeFileName]);

  useEffect(() => {
    if (
      isProcessing &&
      (embeddingWorker.stage === 'progress' ||
        embeddingWorker.message.toLowerCase().includes('vector'))
    ) {
      setProcessingStepIndex(2);
    }
  }, [embeddingWorker.message, embeddingWorker.stage, isProcessing]);

  const processingSteps = useMemo<PipelineStep[]>(() => {
    const activeIndex = isProcessing ? processingStepIndex : 3;

    return [
      {
        label: 'Parsing PDF text',
        hint: 'pdf.js is extracting page text locally.',
        state: activeIndex > 0 ? 'complete' : 'active'
      },
      {
        label: 'Chunking document',
        hint: 'Recursive segmentation is preparing document passages.',
        state:
          activeIndex > 1
            ? 'complete'
            : activeIndex === 1
              ? 'active'
              : 'pending'
      },
      {
        label: 'Generating embeddings',
        hint: 'The embedding worker is building vectors off the main thread.',
        state:
          activeIndex > 2
            ? 'complete'
            : activeIndex === 2
              ? 'active'
              : 'pending'
      }
    ];
  }, [isProcessing, processingStepIndex]);

  const initializationSteps = useMemo<PipelineStep[]>(() => {
    const embeddingReady = embeddingWorker.stage === 'ready';
    const redactionReady = nerWorker.stage === 'ready';

    return [
      {
        label: 'Booting embedding worker',
        hint: 'Loading the browser-side vector engine.',
        state: embeddingReady ? 'complete' : 'active'
      },
      {
        label: 'Booting redaction worker',
        hint: 'Preparing local NER for just-in-time masking.',
        state: redactionReady
          ? 'complete'
          : embeddingReady
            ? 'active'
            : 'pending'
      },
      {
        label: 'Preparing assistant shell',
        hint: 'Finalizing general chat before queries are accepted.',
        state: embeddingReady && redactionReady ? 'active' : 'pending'
      }
    ];
  }, [embeddingWorker.stage, nerWorker.stage]);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject
  } = useDropzone({
    accept: {
      'application/pdf': ['.pdf']
    },
    maxFiles: 1,
    multiple: false,
    disabled: isInitializing || isProcessing || isQuerying,
    onDrop: async (acceptedFiles, fileRejections) => {
      await handleDrop(acceptedFiles, fileRejections);
    }
  });

  const handleDrop = async (
    acceptedFiles: File[],
    fileRejections: FileRejection[]
  ): Promise<void> => {
    if (fileRejections.length > 0) {
      setSurfaceError(formatRejection(fileRejections[0]));
      return;
    }

    const [file] = acceptedFiles;
    if (!file) {
      return;
    }

    setSurfaceError(null);
    setActiveFileName(file.name);

    try {
      await processDocument(file);
      setSidebarOpen(false);
    } catch (dropError) {
      setSurfaceError(
        dropError instanceof Error
          ? dropError.message
          : 'Failed to process the selected PDF.'
      );
    }
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();

    const query = composer.trim();
    if (!query || !canQuery) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: uuidv4(),
      role: 'user',
      content: query,
      createdAt: Date.now()
    };

    setDisplayHistory((current) => [...current, userMessage]);
    setComposer('');
    setSurfaceError(null);

    try {
      const queryResult = await queryDocument(query);
      const assistantMessage: ConversationMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: queryResult.answer,
        createdAt: Date.now(),
        route: queryResult.route,
        routeMessage: queryResult.routeMessage,
        metaIntentOverride: queryResult.metaIntentOverride,
        semanticScore: queryResult.semanticScore,
        semanticThreshold: queryResult.semanticThreshold,
        sanitizedInput: queryResult.sanitizedInput,
        sanitizedInputDictionary: queryResult.sanitizedInputDictionary,
        results: queryResult.redactedMatches,
        detail: queryResult.metaIntentOverride
          ? 'Document-level request detected. Local context was forced despite low semantic similarity.'
          : undefined
      };

      setDisplayHistory((current) => [...current, assistantMessage]);
      if (inspectorOpen) {
        setSelectedInspectorId(assistantMessage.id);
      }
    } catch (queryError) {
      setSurfaceError(
        queryError instanceof Error ? queryError.message : 'Query failed.'
      );
    }
  };

  const handleInspectMessage = (message: ConversationMessage): void => {
    setSelectedInspectorId(message.id);
    setInspectorOpen(true);
  };

  const handleDetachDocument = (): void => {
    setActiveFileName(null);
    setSurfaceError(null);
    clearDocument();
  };

  const attachBorderState = isDragReject
    ? 'border-rose-400/50 bg-rose-400/5'
    : isDragActive
      ? 'border-signal-cyan/60 bg-signal-cyan/5'
      : 'border-white/10 bg-white/[0.03]';

  const liveAssistantMessage: ConversationMessage | null = streamingMessage
    ? {
        id: 'assistant-stream',
        role: 'assistant',
        content: streamingMessage.content || ' ',
        createdAt: streamingMessage.createdAt,
        route: streamingMessage.route,
        routeMessage: streamingMessage.routeMessage,
        metaIntentOverride: streamingMessage.metaIntentOverride,
        semanticScore: streamingMessage.semanticScore,
        semanticThreshold: streamingMessage.semanticThreshold,
        sanitizedInput: streamingMessage.sanitizedInput,
        sanitizedInputDictionary: streamingMessage.sanitizedInputDictionary,
        results: streamingMessage.redactedMatches,
        detail: streamingMessage.metaIntentOverride
          ? 'Document-level request detected. Local context was forced despite low semantic similarity.'
          : undefined
      }
    : null;

  const inspectableMessages = useMemo(() => {
    const assistantMessages = displayHistory.filter(
      (message) =>
        message.role === 'assistant' &&
        (Boolean(message.sanitizedInput) || Boolean(message.results?.length))
    );

    return liveAssistantMessage
      ? [...assistantMessages, liveAssistantMessage]
      : assistantMessages;
  }, [displayHistory, liveAssistantMessage]);

  const activeInspectorMessage = useMemo(() => {
    if (selectedInspectorId) {
      const selectedMessage = inspectableMessages.find(
        (message) => message.id === selectedInspectorId
      );

      if (selectedMessage) {
        return selectedMessage;
      }
    }

    return inspectableMessages.at(-1) ?? null;
  }, [inspectableMessages, selectedInspectorId]);

  const latestAssistantMessage = useMemo(
    () =>
      [...displayHistory]
        .reverse()
        .find((message) => message.role === 'assistant') ?? null,
    [displayHistory]
  );

  const statusLabel = isInitializing
    ? 'Warming secure engines'
    : isProcessing
      ? 'Indexing document locally'
      : isQuerying
        ? queryStatusMessage ?? 'Generating response'
        : hasDocument
          ? 'General + document mode ready'
          : 'General AI mode ready';

  const dropdownSteps =
    isInitializing || isProcessing
      ? isInitializing
        ? initializationSteps
        : processingSteps
      : [];

  return (
    <div className="h-screen overflow-hidden bg-[#212121] text-[#ececec]">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close documents panel"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}

      <div className="flex h-full">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-white/10 bg-[#171717] transition-transform duration-300 lg:static lg:z-0 lg:w-[260px] lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-white">Documents</p>
              <p className="mt-1 text-xs text-slate-400">
                Local-only PDF grounding
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:bg-white/[0.05] lg:hidden"
            >
              Close
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <SidebarCard title="Attach PDF" subtitle="Add a document at any time.">
              <div
                {...getRootProps()}
                className={`rounded-3xl border p-4 transition ${attachBorderState} ${
                  isInitializing || isProcessing || isQuerying
                    ? 'pointer-events-none opacity-70'
                    : 'cursor-pointer hover:border-white/20'
                }`}
              >
                <input {...getInputProps()} />
                <p className="text-sm font-medium text-white">
                  {isDragActive
                    ? 'Release to attach the PDF'
                    : 'Select or drop a PDF'}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Parsing, chunking, embeddings, and redaction remain inside the
                  browser.
                </p>
              </div>
            </SidebarCard>

            <SidebarCard
              title="Current Document"
              subtitle={documentName ?? 'No PDF attached'}
            >
              {hasDocument ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricTile label="Pages" value={pageCount} />
                    <MetricTile label="Chunks" value={chunkCount} />
                  </div>
                  <button
                    type="button"
                    onClick={handleDetachDocument}
                    className="mt-4 w-full rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                  >
                    Detach Document
                  </button>
                </>
              ) : (
                <p className="text-sm leading-6 text-slate-400">
                  The assistant stays fully usable in general chat mode until a
                  PDF is attached.
                </p>
              )}
            </SidebarCard>

            <SidebarCard
              title="Routing"
              subtitle="Latest behavior"
            >
              <p className="text-sm leading-6 text-slate-300">
                {latestAssistantMessage?.routeMessage ??
                  'Document grounding will turn on automatically when a query or meta-intent points at the PDF.'}
              </p>
            </SidebarCard>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/10 bg-[#212121]">
            <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05] lg:hidden"
                >
                  Documents
                </button>
                <p className="truncate text-sm font-medium text-white">
                  Zero-Trust Assistant
                </p>
              </div>

              <div className="flex items-center gap-2" ref={toolsPanelRef}>
                <StatusBadge tone={hasDocument ? 'mint' : 'neutral'}>
                  {statusLabel}
                </StatusBadge>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setToolsOpen((current) => !current)}
                    className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                  >
                    Tools
                  </button>

                  {toolsOpen ? (
                    <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-3xl border border-white/10 bg-[#1f1f1f] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                      <div className="space-y-3">
                        <ToolPanel title="Privacy Inspector">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm leading-6 text-slate-300">
                              Open the sanitized payload viewer for the current
                              turn.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setInspectorOpen(true);
                                setSelectedInspectorId(
                                  activeInspectorMessage?.id ?? null
                                );
                                setToolsOpen(false);
                              }}
                              disabled={!activeInspectorMessage}
                              className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Open
                            </button>
                          </div>
                        </ToolPanel>

                        <details className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <summary className="cursor-pointer list-none text-sm font-medium text-white">
                            Worker Telemetry
                          </summary>
                          <div className="mt-3 space-y-3">
                            <WorkerCard
                              title="Embedding Worker"
                              stage={embeddingWorker.stage}
                              model={embeddingWorker.model}
                              device={embeddingWorker.device}
                            />
                            <WorkerCard
                              title="Redaction Worker"
                              stage={nerWorker.stage}
                              model={nerWorker.model}
                              device={nerWorker.device}
                            />
                          </div>
                        </details>

                        <details className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <summary className="cursor-pointer list-none text-sm font-medium text-white">
                            Routing Control Plane
                          </summary>
                          <div className="mt-3 space-y-3">
                            <ToolPanel title="Semantic Threshold">
                              <p className="text-sm text-slate-200">
                                {(DEFAULT_SEMANTIC_THRESHOLD * 100).toFixed(0)}%
                              </p>
                            </ToolPanel>
                            <ToolPanel title="Current Phase">
                              <p className="text-sm text-slate-200">{phase}</p>
                              {queryStatusMessage ? (
                                <p className="mt-2 text-sm text-slate-400">
                                  {queryStatusMessage}
                                </p>
                              ) : null}
                            </ToolPanel>
                            <ToolPanel title="Latest Route">
                              <p className="text-sm leading-6 text-slate-300">
                                {latestAssistantMessage?.routeMessage ??
                                  'No assistant response yet'}
                              </p>
                              <p className="mt-2 text-xs text-slate-500">
                                Prepared local chunks: {results.length}
                              </p>
                            </ToolPanel>
                            {dropdownSteps.map((step) => (
                              <ToolStep key={step.label} step={step} />
                            ))}
                          </div>
                        </details>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            {displayError ? (
              <div className="border-b border-rose-300/15 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                {displayError}
              </div>
            ) : null}

            <div ref={messageViewportRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-8">
                {displayHistory.length === 0 && !liveAssistantMessage ? (
                  <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
                    <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                      How can I help?
                    </h1>
                    <p className="mt-5 max-w-2xl text-base leading-8 text-slate-400">
                      Start chatting normally, then attach a PDF whenever you want
                      local document grounding. Sensitive input is sanitized before
                      any network transport.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {displayHistory.map((message) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        onInspect={handleInspectMessage}
                      />
                    ))}

                    {liveAssistantMessage ? (
                      <ChatMessage
                        key={liveAssistantMessage.id}
                        message={liveAssistantMessage}
                        onInspect={handleInspectMessage}
                      />
                    ) : null}

                    {isQuerying && !liveAssistantMessage?.content ? (
                      <article className="flex justify-start">
                        <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-4">
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span>Streaming</span>
                            <span className="h-1 w-1 rounded-full bg-current/60" />
                            <span>{queryStatusMessage ?? 'Generating response'}</span>
                          </div>
                          <div className="mt-4 flex gap-1.5">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500" />
                          </div>
                        </div>
                      </article>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 bg-[#212121]/95">
              <div className="mx-auto w-full max-w-3xl px-4 py-4">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{hasDocument ? `PDF attached: ${documentName}` : 'General AI mode'}</span>
                  <span className="h-1 w-1 rounded-full bg-current/60" />
                  <span>Input is sanitized locally before model transport</span>
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="rounded-[28px] border border-white/10 bg-[#2f2f2f] p-3">
                    <textarea
                      id="query"
                      rows={4}
                      value={composer}
                      onChange={(event) => setComposer(event.target.value)}
                      placeholder={
                        isInitializing
                          ? 'Warming local privacy engines...'
                          : isProcessing
                            ? `Indexing ${activeFileName ?? 'document'} locally...`
                            : hasDocument
                              ? 'Ask anything about the document, or just chat naturally...'
                              : 'Message Zero-Trust Assistant...'
                      }
                      disabled={!canQuery}
                      className="min-h-[120px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-7 text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                    />

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                      <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05]"
                      >
                        Attach Document
                      </button>

                      <button
                        type="submit"
                        disabled={!composer.trim() || !canQuery}
                        className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#111111] transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                      >
                        {isInitializing
                          ? 'Warming'
                          : isProcessing
                            ? 'Indexing'
                            : isQuerying
                              ? 'Thinking...'
                              : 'Send'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </section>
      </div>

      <PayloadDrawer
        isOpen={inspectorOpen}
        message={activeInspectorMessage}
        onClose={() => setInspectorOpen(false)}
      />
    </div>
  );
}

function SidebarCard({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#212121] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <h2 className="mt-2 text-sm font-medium text-white">{subtitle}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusBadge({
  children,
  tone
}: {
  children: ReactNode;
  tone: 'mint' | 'neutral';
}) {
  return (
    <span
      className={`hidden rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] sm:inline-flex ${
        tone === 'mint'
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
          : 'border-white/10 bg-white/[0.03] text-slate-400'
      }`}
    >
      {children}
    </span>
  );
}

function ToolPanel({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#242424] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ToolStep({ step }: { step: PipelineStep }) {
  const tone =
    step.state === 'complete'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : step.state === 'active'
        ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
        : 'border-white/10 bg-white/[0.03] text-slate-500';

  return (
    <div className="rounded-2xl border border-white/10 bg-[#242424] px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${tone}`}
        >
          {step.state === 'complete' ? '✓' : step.state === 'active' ? '…' : '·'}
        </span>
        <p className="text-sm font-medium text-white">{step.label}</p>
      </div>
      <p className="mt-2 pl-9 text-sm leading-6 text-slate-400">{step.hint}</p>
    </div>
  );
}

function WorkerCard({
  title,
  stage,
  model,
  device
}: {
  title: string;
  stage: string;
  model?: string;
  device?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#242424] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-white">{title}</p>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {stage}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-sm text-slate-400">
        <p>{model ?? 'Model not loaded yet'}</p>
        <p>Preferred device: {device ?? 'pending'}</p>
      </div>
    </div>
  );
}

function PayloadDrawer({
  isOpen,
  message,
  onClose
}: {
  isOpen: boolean;
  message: ConversationMessage | null;
  onClose: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="h-full w-full max-w-[460px] overflow-y-auto border-l border-white/10 bg-[#171717] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Sanitized Payload
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Privacy Inspector
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              Review the exact redacted payload prepared for transport without
              cluttering the conversation view.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/[0.05]"
          >
            Close
          </button>
        </div>

        {!message ? (
          <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-slate-400">
            No inspectable assistant payload is available yet.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <ToolPanel title="Route Summary">
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>
                  {message.route === 'document' ? 'Local Document' : 'General AI'}
                </span>
                {message.metaIntentOverride ? (
                  <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-300">
                    Intent Override
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                {message.routeMessage ??
                  'Sanitized user input and local context were prepared for this turn.'}
              </p>
              {typeof message.semanticScore === 'number' &&
              typeof message.semanticThreshold === 'number' ? (
                <p className="mt-2 text-xs text-slate-500">
                  {(message.semanticScore * 100).toFixed(1)}% match against a{' '}
                  {(message.semanticThreshold * 100).toFixed(0)}% threshold.
                </p>
              ) : null}
            </ToolPanel>

            {message.sanitizedInput ? (
              <ToolPanel title="Sanitized User Input">
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
                  {message.sanitizedInput}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(message.sanitizedInputDictionary ?? {}).length ? (
                    Object.entries(message.sanitizedInputDictionary ?? {}).map(
                      ([token, entry]) => (
                        <span
                          key={token}
                          className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-300"
                        >
                          {token} · {entry.label}
                        </span>
                      )
                    )
                  ) : (
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                      No PII placeholders were required in the user input.
                    </span>
                  )}
                </div>
              </ToolPanel>
            ) : null}

            {message.route === 'general' ? (
              <ToolPanel title="Semantic Router">
                <p className="text-sm leading-7 text-slate-300">
                  No document chunks were appended to this payload. The router
                  stayed in general AI mode for this turn.
                </p>
              </ToolPanel>
            ) : null}

            {(message.results ?? []).map((result, index) => {
              const placeholders = Object.entries(result.dictionary);

              return (
                <ToolPanel
                  key={result.id}
                  title={`Chunk ${result.metadata?.chunkIndex ?? index}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    {!message.metaIntentOverride ? (
                      <span>{`${(result.score * 100).toFixed(1)}% similarity`}</span>
                    ) : (
                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-300">
                        Meta-intent attached
                      </span>
                    )}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-100">
                    {result.redactedText}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {placeholders.length ? (
                      placeholders.map(([token, entry]) => (
                        <span
                          key={token}
                          className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-300"
                        >
                          {token} · {entry.label}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                        No PII placeholders were required for this chunk.
                      </span>
                    )}
                  </div>
                </ToolPanel>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatRejection(rejection: FileRejection): string {
  const firstError = rejection.errors[0];

  switch (firstError?.code) {
    case 'file-invalid-type':
      return 'Only PDF files are accepted for secure local analysis.';
    case 'too-many-files':
      return 'Drop a single PDF file at a time.';
    default:
      return firstError?.message ?? 'The selected file could not be processed.';
  }
}

export default App;
