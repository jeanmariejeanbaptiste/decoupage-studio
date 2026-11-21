import type { Route } from '@playwright/test';

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown };
interface Message {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  stop_reason: string;
  stop_sequence: null;
  content: Block[];
  usage: { input_tokens: number; output_tokens: number };
}

/** Le message de l'API Anthropic, en flux (SSE) si la requête le demande, sinon d'un bloc. */
export function anthropicBody(route: Route, m: Message): { contentType: string; body: string } {
  const req = route.request().postDataJSON() as { stream?: boolean } | null;
  if (!req?.stream) return { contentType: 'application/json', body: JSON.stringify(m) };
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  let out = ev('message_start', { message: { ...m, content: [], stop_reason: null, usage: { input_tokens: m.usage.input_tokens, output_tokens: 0 } } });
  m.content.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text ?? '' } });
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input ?? {}) } });
    }
    out += ev('content_block_stop', { index });
  });
  out += ev('message_delta', { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: m.usage.output_tokens } });
  out += ev('message_stop', {});
  return { contentType: 'text/event-stream', body: out };
}
