export interface SavedPrompt {
  name: string;
  text: string;
}

export function checkedSavedPrompts(value: unknown): SavedPrompt[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw new Error('Keep up to 30 shortcuts.');
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry.name !== 'string' || typeof entry.text !== 'string')
      throw new Error('Each shortcut needs a name and prompt.');
    const name = entry.name.trim(),
      text = entry.text.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name) || !text || text.length > 4000)
      throw new Error(
        'Shortcut names use up to 40 letters, numbers, underscores or hyphens; prompts use up to 4,000 characters.'
      );
    if (seen.has(name.toLowerCase())) throw new Error('Give each shortcut a different name.');
    seen.add(name.toLowerCase());
    return { name, text };
  });
}

export const BUILTIN_PROMPTS: readonly SavedPrompt[] = [
  { name: 'brief', text: 'Give me a short briefing on ' },
  { name: 'summarize', text: 'Summarize this in 5 bullet points: ' },
  { name: 'review', text: 'Review this and list problems by importance: ' },
  { name: 'plan', text: 'Turn this into a step-by-step plan with owners: ' },
  { name: 'post', text: 'Draft a LinkedIn post about ' },
  { name: 'email', text: 'Draft a short, friendly email about ' }
];
