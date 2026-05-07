import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callChat, OpenAIError, type ChatRequest } from '../../src/ai/openai-client.js';

const MINIMAL_REQUEST: ChatRequest = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
  max_completion_tokens: 100,
  response_format: { type: 'json_object' },
};

const OK_RESPONSE = {
  choices: [{ message: { content: '{"summary":"test"}' } }],
  usage: { prompt_tokens: 50, completion_tokens: 20 },
};

function makeOkFetch() {
  return vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify(OK_RESPONSE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
});

describe('callChat', () => {
  it('throws OpenAIError when OPENAI_API_KEY not set', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(callChat(MINIMAL_REQUEST)).rejects.toThrow(OpenAIError);
    await expect(callChat(MINIMAL_REQUEST)).rejects.toThrow('OPENAI_API_KEY not set');
  });

  it('returns parsed response on 200', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(makeOkFetch());
    const res = await callChat(MINIMAL_REQUEST);
    expect(res.choices[0]?.message.content).toBe('{"summary":"test"}');
    expect(res.usage.prompt_tokens).toBe(50);
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    let calls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls === 1) return new Response('rate limited', { status: 429 });
      return new Response(JSON.stringify(OK_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await callChat(MINIMAL_REQUEST);
    expect(calls).toBe(2);
    expect(res.choices).toHaveLength(1);
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    let calls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls === 1) return new Response('error', { status: 500 });
      return new Response(JSON.stringify(OK_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await callChat(MINIMAL_REQUEST);
    expect(calls).toBe(2);
    expect(res.usage.completion_tokens).toBe(20);
  });

  it('throws OpenAIError after two 429s', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => new Response('limit', { status: 429 }));
    await expect(callChat(MINIMAL_REQUEST)).rejects.toThrow(OpenAIError);
  });

  it('throws OpenAIError on non-retryable 4xx', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response('bad request', { status: 400 }),
    );
    await expect(callChat(MINIMAL_REQUEST)).rejects.toThrow(OpenAIError);
    await expect(callChat(MINIMAL_REQUEST)).rejects.toThrow('OpenAI 400');
  });
});
