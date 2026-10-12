import { MENTION_MARK, visibleUserText } from './user-text';

/** Recognize whole catalog names, longest first. */
export function withMentions(
  text: string,
  agents: readonly { id: string; name: string }[],
  own: string
): string {
  const visible = visibleUserText(text);
  const names: string[] = [];
  const ordered = [...agents].sort((a, b) => b.name.length - a.name.length);
  const used = new Set<string>();
  for (const match of visible.matchAll(/(?:^|\s)@/g)) {
    const rest = visible.slice(match.index! + match[0].length);
    const agent = ordered.find(
      (a) =>
        rest.slice(0, a.name.length).toLowerCase() === a.name.toLowerCase() &&
        /^(?:$|[\s.,;!?:)])/u.test(rest.slice(a.name.length))
    );
    if (agent && agent.id !== own && !used.has(agent.id)) {
      used.add(agent.id);
      names.push(agent.name);
    }
  }
  return names.length
    ? `${text}${MENTION_MARK}\nThe user wants these colleagues involved: ${names.join(', ')}. Ask them with ask_colleague (by these exact names) before you answer.\n</mentioned-colleagues>`
    : text;
}
