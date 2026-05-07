// Low-level OpenAI Chat Completions API client.
// Retries once on 429 or 5xx, aborts after 30s.
// Never interprets model output — caller does that.

export type ChatRequest = {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  max_completion_tokens: number;
  response_format: { type: 'json_object' };
  temperature?: number;
};

export type ChatResponse = {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
};

export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

export async function callChat(payload: ChatRequest): Promise<ChatResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAIError('OPENAI_API_KEY not set');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt === 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) throw new OpenAIError(`OpenAI ${res.status}`, res.status);
      return (await res.json()) as ChatResponse;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) throw e instanceof OpenAIError ? e : new OpenAIError(String(e));
    }
  }
  throw new OpenAIError('unreachable');
}
