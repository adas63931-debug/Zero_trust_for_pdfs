import type { DropzoneInputProps, DropzoneRootProps } from 'react-dropzone';

interface DropZonePanelProps {
  rootProps: DropzoneRootProps;
  inputProps: DropzoneInputProps;
  isBusy: boolean;
  isDragActive: boolean;
  isDragReject: boolean;
  error: string | null;
}

const featureCards = [
  {
    title: 'Local Parsing',
    body: 'PDF text is extracted inside the browser with no server-side upload step.'
  },
  {
    title: 'Browser Embeddings',
    body: 'Chunking and vector generation stay isolated in dedicated workers.'
  },
  {
    title: 'JIT Redaction',
    body: 'Sensitive entities are masked before any downstream model transport.'
  }
] as const;

export function DropZonePanel({
  rootProps,
  inputProps,
  isBusy,
  isDragActive,
  isDragReject,
  error
}: DropZonePanelProps) {
  const borderState = isDragReject
    ? 'border-rose-400/50 shadow-[0_0_0_1px_rgba(251,113,133,0.28)]'
    : isDragActive
      ? 'border-signal-cyan/60 shadow-glow'
      : 'border-white/10';

  return (
    <section className="w-full max-w-6xl">
      <div className="mx-auto mb-5 flex justify-center">
        <span className="signal-pill">
          <span className="h-2 w-2 rounded-full bg-signal-mint shadow-[0_0_14px_rgba(52,211,153,0.8)]" />
          Zero-Trust Intake
        </span>
      </div>

      <div
        {...rootProps}
        className={`panel-surface group relative overflow-hidden p-8 transition duration-300 md:p-12 ${borderState} ${isBusy ? 'pointer-events-none opacity-70' : 'cursor-pointer hover:-translate-y-0.5 hover:border-white/20'}`}
      >
        <input {...inputProps} />

        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(52,211,153,0.12),transparent_26%)]" />
          <div className="grid-noise absolute inset-0 opacity-40" />
        </div>

        <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.34em] text-slate-400">
                Client-Side RAG Control Plane
              </p>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                  Drop a confidential PDF here for local analysis.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-300 md:text-lg">
                  The document never leaves this browser unparsed. Text
                  extraction, chunking, embeddings, and redaction all happen
                  inside isolated client-side workers.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span className="inline-flex min-w-[210px] items-center justify-center rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-medium text-slate-100">
                {isDragActive
                  ? 'Release to begin secure ingestion'
                  : 'Select or drop a PDF'}
              </span>
              <span className="text-sm text-slate-400">
                Accepts one `.pdf` at a time. All indexing remains local.
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {featureCards.map((feature) => (
              <div
                key={feature.title}
                className="panel-surface-muted relative overflow-hidden p-5"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-signal-cyan">
                  {feature.title}
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-center text-sm text-rose-300">{error}</p>
      ) : null}
    </section>
  );
}
