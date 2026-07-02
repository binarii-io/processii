import { Fragment, type ReactNode } from 'react';

/**
 * **Minimal, safe markdown rendering** for the assistant replies. Generates **React elements**
 * (never `dangerouslySetInnerHTML` → no HTML injection), with no external dependency. Covers
 * what the model produces: paragraphs, bulleted / numbered lists, headings, and inline
 * `**bold**`, `*italic*`, `` `code` ``. Intentionally tolerant: any unrecognized markdown falls back to plain text.
 */

// Inline : **gras** | `code` | *italique* | _italique_
const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g;
const BULLET = /^\s*[-*]\s+/;
const NUMBER = /^\s*\d+\.\s+/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      nodes.push(
        <code key={key++} className="rounded bg-bg px-1 py-0.5 text-[0.85em]">
          {m[3]}
        </code>,
      );
    else if (m[4] !== undefined) nodes.push(<em key={key++}>{m[4]}</em>);
    else if (m[5] !== undefined) nodes.push(<em key={key++}>{m[5]}</em>);
    last = INLINE.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { readonly text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(BULLET, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-0.5 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (NUMBER.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBER.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(NUMBER, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-0.5 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      blocks.push(
        <p key={key++} className="font-semibold">
          {renderInline(h[2] ?? '')}
        </p>,
      );
      i++;
      continue;
    }

    // Paragraph: consecutive non-empty, non-list/heading lines.
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || BULLET.test(cur) || NUMBER.test(cur) || HEADING.test(cur)) break;
      para.push(cur);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 ? <br /> : null}
            {renderInline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}
