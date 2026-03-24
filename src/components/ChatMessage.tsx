import type { RedactedSearchResult } from '@/hooks/useDocumentAI';

export interface ConversationMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  detail?: string;
  createdAt: number;
  route?: 'document' | 'general';
  routeMessage?: string;
  metaIntentOverride?: boolean;
  semanticScore?: number;
  semanticThreshold?: number;
  sanitizedInput?: string;
  sanitizedInputDictionary?: Record<
    string,
    {
      label: string;
      original: string;
    }
  >;
  results?: RedactedSearchResult[];
}

interface ChatMessageProps {
  message: ConversationMessage;
  onInspect?: (message: ConversationMessage) => void;
}

export function ChatMessage({ message, onInspect }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const inspectorAvailable =
    isAssistant && (Boolean(message.sanitizedInput) || Boolean(message.results?.length));

  if (message.role === 'system') {
    return (
      <article className="flex justify-center">
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-slate-400">
          {message.content}
        </div>
      </article>
    );
  }

  return (
    <article className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[28px] px-5 py-4 ${
          isUser
            ? 'bg-[#303030] text-slate-100'
            : 'w-full max-w-none bg-transparent text-slate-100'
        }`}
      >
        {isAssistant ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span>Assistant</span>
            {message.route ? (
              <span
                className={`rounded-full px-2.5 py-1 ${
                  message.route === 'document'
                    ? 'bg-emerald-400/10 text-emerald-300'
                    : 'bg-white/[0.05] text-slate-400'
                }`}
              >
                {message.route === 'document' ? 'Document' : 'General'}
              </span>
            ) : null}
            {message.metaIntentOverride ? (
              <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-300">
                Intent Override
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="whitespace-pre-wrap text-[15px] leading-8 text-current">
          {message.content}
        </p>

        {message.detail ? (
          <p className="mt-3 text-sm leading-6 text-slate-400">{message.detail}</p>
        ) : null}

        {isAssistant ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {typeof message.semanticScore === 'number' &&
            typeof message.semanticThreshold === 'number' ? (
              <span>
                {(message.semanticScore * 100).toFixed(1)}% match against{' '}
                {(message.semanticThreshold * 100).toFixed(0)}%
              </span>
            ) : null}

            {inspectorAvailable && onInspect ? (
              <button
                type="button"
                onClick={() => onInspect(message)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05]"
              >
                Inspect Sanitized Payload
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            You
          </div>
        )}
      </div>
    </article>
  );
}
