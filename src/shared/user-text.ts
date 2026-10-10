/** What the user typed, without the attachment and file-context blocks appended for the model. */
export function visibleUserText(content: string): string {
  return content.split('\n\n<attachment')[0].split('\n\nFile context: ')[0].split('\n\n<file path=')[0];
}
