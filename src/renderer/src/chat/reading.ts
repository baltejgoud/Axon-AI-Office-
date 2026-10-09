import { create } from 'zustand';
import type { Message } from '../../../shared/types';

/** The reply open in the reading view, with who wrote it and the folder its files belong in. */
export interface Reading {
  message: Message;
  authorName: string;
  /** Where Save starts: the conversation's project folder, when it has one. */
  folder?: string | null;
}

export const useReading = create<{ open: Reading | null; read: (reading: Reading | null) => void }>((set) => ({
  open: null,
  read: (open) => set({ open })
}));

/** Long enough, or structured enough, that the side panel is the wrong place to read it. */
export const worthReading = (content: string): boolean =>
  content.length > 1200 || (content.match(/^#{1,3}\s/gm)?.length ?? 0) >= 2;

export interface Section {
  id: string;
  level: number;
  title: string;
  /** The heading and everything under it, up to the next heading at its level or above. */
  markdown: string;
}

/** A heading's text as plain words: no Markdown marks. */
export const plainHeading = (text: string) => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/** A heading's id: its words, so the same text in the contents and in the page find each other. */
export const headingId = (title: string, seen: Map<string, number>) => {
  const base =
    'rv-' +
    (plainHeading(title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'section');
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
};

/** The reply's headings (# to ###) and what each covers, skipping anything inside code fences. */
export function sections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const found: { line: number; level: number; title: string }[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const marker = line.match(/^\s{0,3}(```|~~~)/)?.[1];
    if (marker) fence = fence === marker ? null : (fence ?? marker);
    if (fence) return;
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) found.push({ line: i, level: heading[1].length, title: plainHeading(heading[2]) });
  });
  const seen = new Map<string, number>();
  return found.map((h, i) => {
    const next = found.slice(i + 1).find((other) => other.level <= h.level);
    return {
      id: headingId(h.title, seen),
      level: h.level,
      title: h.title,
      markdown: lines.slice(h.line, next ? next.line : lines.length).join('\n').trim()
    };
  });
}
