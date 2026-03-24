const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface GroqChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
}

export interface SecureCompletionParams {
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  sanitizedChunks: string[];
  useContext: boolean;
  onDelta?: (chunk: string) => void;
}

export async function requestSecureCompletion({
  conversationHistory,
  sanitizedChunks,
  useContext,
  onDelta
}: SecureCompletionParams): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      'Missing VITE_GROQ_API_KEY. Add it to your local environment before querying Groq.'
    );
  }

  const joinedChunks = sanitizedChunks
    .map((chunk, index) => `Context Chunk ${index + 1}:\n${chunk}`)
    .join('\n\n');

  const systemPrompt = useContext
    ? `You are a secure document analysis AI. Answer the user's query strictly using the provided context chunks and the sanitized conversation history. The context has been sanitized for privacy (e.g., names replaced with [PERSON_A]). Use these placeholders in your answer exactly as they appear if referring to them. If the answer is not present in the context or the sanitized conversation history, say you do not know based on the provided information.\n\nContext:\n${joinedChunks}`
    : "You are a helpful, highly capable AI assistant. Answer the user's query naturally based on the sanitized conversation history. The conversation may contain privacy placeholders like [PERSON_1]. Preserve those placeholders exactly if you refer to them, and do not invent any hidden document context.";

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      stream: true,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        ...conversationHistory
      ]
    })
  });

  if (!response.ok) {
    const payload = (await response.json()) as GroqChatCompletionResponse;
    throw new Error(
      payload.error?.message ??
        `Groq request failed with status ${response.status}.`
    );
  }

  if (!response.body) {
    throw new Error('Groq streaming response body was not available.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine.startsWith('data:')) {
        continue;
      }

      const payload = trimmedLine.slice(5).trim();

      if (!payload || payload === '[DONE]') {
        continue;
      }

      const chunk = JSON.parse(payload) as GroqChatCompletionStreamChunk;
      const deltaContent = chunk.choices?.[0]?.delta?.content;

      if (!deltaContent) {
        continue;
      }

      accumulatedText += deltaContent;
      onDelta?.(deltaContent);
    }

    if (done) {
      break;
    }
  }

  const trailingPayload = buffer.trim();
  if (trailingPayload.startsWith('data:')) {
    const payload = trailingPayload.slice(5).trim();

    if (payload && payload !== '[DONE]') {
      const chunk = JSON.parse(payload) as GroqChatCompletionStreamChunk;
      const deltaContent = chunk.choices?.[0]?.delta?.content;

      if (deltaContent) {
        accumulatedText += deltaContent;
        onDelta?.(deltaContent);
      }
    }
  }

  if (!accumulatedText.trim()) {
    throw new Error('Groq returned an empty streamed completion.');
  }

  return accumulatedText.trim();
}
