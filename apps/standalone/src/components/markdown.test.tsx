import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './markdown.js';

describe('Markdown', () => {
  it('renders bold', () => {
    const { container } = render(<Markdown text="Voici du **gras**." />);
    expect(container.querySelector('strong')?.textContent).toBe('gras');
  });

  it('renders italic and inline code', () => {
    const { container } = render(<Markdown text="*ital* et `addStep`" />);
    expect(container.querySelector('em')?.textContent).toBe('ital');
    expect(container.querySelector('code')?.textContent).toBe('addStep');
  });

  it('renders a bulleted list', () => {
    const { container } = render(<Markdown text={'- un\n- deux'} />);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('renders a numbered list', () => {
    const { container } = render(<Markdown text={'1. un\n2. deux\n3. trois'} />);
    expect(container.querySelectorAll('ol li')).toHaveLength(3);
  });

  it('plain text without markdown stays text', () => {
    const { container } = render(<Markdown text="juste du texte" />);
    expect(container.textContent).toBe('juste du texte');
  });
});
