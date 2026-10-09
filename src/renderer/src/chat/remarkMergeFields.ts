/** A merge field as templates write it: {first_name}, {{company}}, { city }. */
const FIELD = /(\{\{?\s*[A-Za-z_][\w.-]{0,40}\s*\}\}?)/;

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

/**
 * Shows merge fields in prose as code, exactly as written, so a template's placeholders read as
 * fields to fill and never as ordinary words. Code and code blocks are left as they are.
 */
export function remarkMergeFields() {
  const walk = (node: MdNode): void => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type !== 'text' || !child.value || !FIELD.test(child.value)) {
        walk(child);
        return [child];
      }
      // Split on the captured field: the odd pieces are fields, the even ones the text between.
      return child.value
        .split(FIELD)
        .map(
          (part, i): MdNode =>
            i % 2
              ? { type: 'inlineCode', value: part, data: { hProperties: { className: 'merge-field' } } }
              : { type: 'text', value: part }
        )
        .filter((part) => part.value);
    });
  };
  return (tree: MdNode) => walk(tree);
}
