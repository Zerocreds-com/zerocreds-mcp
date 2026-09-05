const BASE_URL = (process.env.ZEROCREDS_URL ?? 'https://zerocreds.ru').replace(/\/$/, '');
const TOKEN = process.env.ZEROCREDS_TOKEN ?? '';
const DEFAULT_DESTINATION = process.env.ZEROCREDS_DEFAULT_DESTINATION ?? 'local-dev';
const TG_BOT_TOKEN = process.env.ZEROCREDS_TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.ZEROCREDS_TG_CHAT_ID;

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'password' | 'email' | 'tel' | 'number' | 'textarea' | 'url';
  placeholder?: string;
  required?: boolean;
  level?: 'secret' | 'pii' | 'attribute' | 'credential';
}

export interface CreateSessionArgs {
  title: string;
  description?: string;
  fields: Field[];
  destination?: string;
  ttl_minutes?: number;
}

export interface SessionResult {
  token: string;
  url: string;
  expires_at: string;
}

export interface StatusResult {
  status: 'pending' | 'done' | 'expired';
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(`ZeroCreds ${res.status}: ${err.error ?? 'unknown error'}`);
  }
  return res.json();
}

export async function createSession(args: CreateSessionArgs): Promise<SessionResult> {
  const body: Record<string, unknown> = {
    title: args.title,
    fields: args.fields,
    destination: args.destination ?? DEFAULT_DESTINATION,
    ttl_minutes: args.ttl_minutes ?? 30,
  };
  if (args.description) body.description = args.description;
  if (TG_BOT_TOKEN && TG_CHAT_ID) {
    body.notify = { tg_bot_token: TG_BOT_TOKEN, tg_chat_id: TG_CHAT_ID };
  }
  return apiFetch('/api/session/create', { method: 'POST', body: JSON.stringify(body) });
}

export async function checkStatus(token: string): Promise<StatusResult> {
  return apiFetch(`/api/session/${token}/status`, { headers: { 'Content-Type': undefined as any } });
}
