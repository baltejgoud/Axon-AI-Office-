export const MENTION_MARK = '\n\n<mentioned-colleagues>';

/** What the user typed, without the hidden context appended for the model. */
export function visibleUserText(content: string): string {
  return content
    .split('\n\n<attachment')[0]
    .split('\n\nFile context: ')[0]
    .split('\n\n<file path=')[0]
    .split(MENTION_MARK)[0];
}
