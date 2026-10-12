export { withMentions } from '../../../../../shared/mentions';
import { rankCoworkers } from '../../../../../shared/coworkerSearch';
import type { OfficeAgent } from '../data/officeAgents';

export interface ComposerToken {
  kind: 'mention' | 'shortcut';
  start: number;
  end: number;
  query: string;
}

/** Only the text at the caret opens a menu; email addresses and later slashes stay ordinary text. */
export function composerToken(text: string, caret: number): ComposerToken | null {
  const before = text.slice(0, caret);
  if (/^\/[\w-]*$/.test(before)) return { kind: 'shortcut', start: 0, end: caret, query: before.slice(1) };
  const found = /(?:^|\s)@([^@\n,;!?]{0,60})$/.exec(before);
  return found ? { kind: 'mention', start: caret - found[1].length - 1, end: caret, query: found[1] } : null;
}

export function mentionChoices(query: string, agents: readonly OfficeAgent[], own: string): OfficeAgent[] {
  const other = agents.filter((a) => a.id !== own);
  return query.trim()
    ? rankCoworkers(
        query,
        other,
        (a) => ({ name: a.name, area: `${a.role} ${a.department}`, about: a.description, prompt: '' }),
        6
      )
    : other.slice(0, 6);
}
