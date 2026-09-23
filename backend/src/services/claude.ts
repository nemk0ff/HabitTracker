import Anthropic from '@anthropic-ai/sdk';
import { ProxyAgent } from 'undici';

/** Main model for all Claude features in the bot. */
export const CLAUDE_MODEL = 'claude-opus-5';

let client: Anthropic | null = null;

export function claudeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Shared client. api.anthropic.com isn't reachable directly from the VPS, so
 * requests go through the same HTTP proxy as Claude Code (CLAUDE_PROXY, xray).
 */
export function getClaude(): Anthropic {
  if (!client) {
    const proxy = process.env.CLAUDE_PROXY;
    client = new Anthropic({
      timeout: 60_000,
      ...(proxy && { fetchOptions: { dispatcher: new ProxyAgent(proxy) } }),
    });
  }
  return client;
}

/** Concatenated text blocks of a response. */
export function responseText(content: { type: string }[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
