import * as vscode from 'vscode';
import {
  ConventionalOptions,
  validateConventionalMessage as validateMessage,
} from './conventional';

export type Provider = 'openai-chat' | 'openai-responses' | 'anthropic';

export interface LlmConfig {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
  temperature: number;
  conventional: ConventionalOptions & { enabled: boolean };
}

export class LlmError extends Error {}

export function loadLlmConfig(): LlmConfig {
  const config = vscode.workspace.getConfiguration('gitCommitMsgGen');
  const rawKey = config.get<string>('apiKey', '');
  let apiKey = rawKey.trim();
  if (apiKey.startsWith('env:')) {
    apiKey = process.env[apiKey.slice(4)] ?? '';
  }

  const provider = config.get<Provider>('provider', 'openai-chat');
  const model = config.get<string>('model', '') || defaultModel(provider);
  const baseUrl = trimTrailingSlash(config.get<string>('baseUrl', '') || defaultBaseUrl(provider));

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    language: config.get<string>('language', 'en'),
    temperature: config.get<number>('temperature', 0.2),
    conventional: {
      enabled: config.get<boolean>('conventionalCommits.enabled', true),
      types: config.get<string[]>('conventionalCommits.types', []).filter(Boolean),
      scopeRequired: config.get<boolean>('conventionalCommits.scopeRequired', false),
      subjectMaxLength: config.get<number>('conventionalCommits.subjectMaxLength', 72),
      additionalInstructions: config.get<string>('conventionalCommits.additionalInstructions', '').trim(),
    },
  };
}

function defaultModel(provider: Provider): string {
  if (provider === 'anthropic') {
    return 'claude-3-5-haiku-latest';
  }
  return 'gpt-4o-mini';
}

function defaultBaseUrl(provider: Provider): string {
  if (provider === 'anthropic') {
    return 'https://api.anthropic.com';
  }
  return 'https://api.openai.com/v1';
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

const SYSTEM_PROMPT = `You are an expert software engineer writing git commit messages.
Return ONLY the commit message with no surrounding quotes or markdown fences.
The first line is an imperative summary of at most 72 characters.
If more detail helps, add a blank line and a short body explaining what changed and why.`;

function buildSystemPrompt(config: LlmConfig): string {
  if (!config.conventional.enabled) {
    return SYSTEM_PROMPT;
  }

  return [
    'You are an expert software engineer writing git commit messages.',
    'Return ONLY the commit message with no surrounding quotes or markdown fences.',
    'The message MUST follow the Conventional Commits 1.0.0 specification.',
    `Use one of these types: ${config.conventional.types.join(', ')}.`,
    config.conventional.scopeRequired
      ? 'Include a concise lowercase scope in parentheses.'
      : 'Include a scope in parentheses only when it genuinely clarifies the change.',
    `The subject after the type and optional scope must be at most ${config.conventional.subjectMaxLength} characters.`,
    'Use imperative mood in the subject, do not end it with a period, and start it with a lowercase word when English is used.',
    'A breaking change may use ! after the type/scope and must include a BREAKING CHANGE footer.',
    'Add a body only when it provides useful context beyond the subject.',
    config.conventional.additionalInstructions,
  ].filter(Boolean).join('\n');
}

export async function generateCommitMessage(
  config: LlmConfig,
  diff: string,
  signal?: AbortSignal
): Promise<string> {
  const userPrompt = [
    `Write a git commit message in ${config.language} for the following changes.`,
    'Respond with the message only.',
    config.conventional.enabled
      ? 'Use this exact header format: <type>(<scope>): <subject> or <type>: <subject>.'
      : '',
    '',
    '```diff',
    diff,
    '```',
  ].join('\n');

  const raw = await requestCompletion(config, buildSystemPrompt(config), userPrompt, signal);
  const message = cleanMessage(raw);
  if (!message) {
    throw new LlmError('LLM returned an empty response.');
  }
  if (config.conventional.enabled) {
    validateMessage(message, config.conventional);
  }
  return message;
}

async function requestCompletion(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey) {
    throw new LlmError('API key is not configured.');
  }

  if (config.provider === 'anthropic') {
    return requestAnthropic(config, system, user, signal);
  }
  if (config.provider === 'openai-responses') {
    return requestOpenAiResponses(config, system, user, signal);
  }
  return requestOpenAiChat(config, system, user, signal);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error;
    }
    throw new LlmError(`Request failed: ${(error as Error).message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new LlmError(`API error ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

async function requestOpenAiChat(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    authorization: `Bearer ${config.apiKey}`,
  }, {
    model: config.model,
    temperature: config.temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function requestOpenAiResponses(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const data = await postJson(`${config.baseUrl}/responses`, {
    authorization: `Bearer ${config.apiKey}`,
  }, {
    model: config.model,
    temperature: config.temperature,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }) as { output?: Array<{ content?: Array<{ text?: string }> }> };
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('');
}

async function requestAnthropic(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const base = config.baseUrl.replace(/\/v1$/, '');
  const data = await postJson(`${base}/v1/messages`, {
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  }, {
    model: config.model,
    max_tokens: 1024,
    temperature: config.temperature,
    system,
    messages: [{ role: 'user', content: user }],
  }) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

function cleanMessage(raw: string): string {
  let message = raw.trim();
  message = message.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  message = message.replace(/^(commit message|git commit message)\s*[:：]\s*/i, '');
  if ((message.startsWith('"') && message.endsWith('"')) ||
      (message.startsWith("'") && message.endsWith("'"))) {
    message = message.slice(1, -1);
  }
  return message.trim();
}
