'use client';

import { api } from './api';
import { ACCOUNTS_ENABLED } from './flags';
import { readHint } from './hint';

/**
 * Storage adapter hooks for chat-with-pdf. For signed-out visitors (or with
 * chat sync off) these do nothing and make no requests. Only questions,
 * answers, the document title and page citations are sent, never the document.
 */
type Turn = {
  question: string;
  answer: string;
  sources: { n: number; docName: string; unit: 'page' | 'section'; page: number }[];
  via: string;
  at: number;
};

const signedIn = () => ACCOUNTS_ENABLED && readHint() !== null;

async function chatsOn(): Promise<boolean> {
  if (!signedIn()) return false;
  const { currentSettings } = await import('./sync');
  return (await currentSettings())?.syncChats === true;
}

export async function pushChat(key: string, title: string, turns: Turn[]): Promise<void> {
  if (!(await chatsOn())) return;
  await api('PUT', `/api/me/chats/${key}`, { title: title.slice(0, 300) || 'Untitled', turns });
}

export async function pullChat(key: string): Promise<Turn[] | null> {
  if (!(await chatsOn())) return null;
  const r = await api<{ chat: { turns: Turn[] } }>('GET', `/api/me/chats/${key}`);
  return r.ok ? r.data.chat.turns : null;
}

/** Deleting a conversation also deletes its synced copy, even if sync has since been switched off. */
export async function deleteRemoteChat(key: string): Promise<void> {
  if (!signedIn()) return;
  await api('DELETE', `/api/me/chats/${key}`);
}
