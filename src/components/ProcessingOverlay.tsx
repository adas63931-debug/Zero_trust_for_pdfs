export interface ProcessingStep {
  label: string;
  hint: string;
  state: 'pending' | 'active' | 'complete';
}

interface ProcessingOverlayProps {
  isVisible: boolean;
  title: string;
  description: string;
  fileName: string | null;
  progress?: number;
  steps: ProcessingStep[];
}

export function ProcessingOverlay({
  isVisible,
  title,
  description,
  fileName,
  progress,
  steps
}: ProcessingOverlayProps) {
  if (!isVisible) {
    return null;
  }

  const normalizedProgress =
    typeof progress === 'number'
      ? `${Math.max(8, Math.min(progress * 100, 100))}%`
      : '42%';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020611]/75 px-4 backdrop-blur-xl">
      <div className="panel-surface relative w-full max-w-2xl overflow-hidden p-8 md:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(52,211,153,0.12),transparent_28%)]" />
        <div className="relative space-y-8">
          <div className="space-y-3">
            <span className="signal-pill">
              <span className="h-2 w-2 rounded-full bg-signal-cyan animate-pulse-soft" />
              Local Processing Overlay
            </span>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight text-white">
                {title}
              </h2>
              <p className="max-w-xl text-sm leading-7 text-slate-300">
                {description}
              </p>
              {fileName ? (
                <p className="text-sm text-slate-400">Current file: {fileName}</p>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
            <div
              className="relative h-3 bg-gradient-to-r from-signal-cyan via-sky-400 to-signal-mint transition-all duration-500"
              style={{ width: normalizedProgress }}
            >
              <div className="absolute inset-y-0 w-28 animate-sheen bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            </div>
          </div>

          <div className="space-y-3">
            {steps.map((step) => {
              const stateClasses =
                step.state === 'complete'
                  ? 'border-signal-mint/40 bg-signal-mint/10 text-signal-mint'
                  : step.state === 'active'
                    ? 'border-signal-cyan/40 bg-signal-cyan/10 text-signal-cyan'
                    : 'border-white/10 bg-white/[0.03] text-slate-500';

              return (
                <div
                  key={step.label}
                  className="panel-surface-muted flex items-start gap-4 p-4"
                >
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${stateClasses}`}
                  >
                    {step.state === 'complete' ? '✓' : step.state === 'active' ? '…' : '·'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{step.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      {step.hint}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
