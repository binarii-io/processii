/**
 * Tests of the **vendored** UI primitives (ADR 0006) — adapted from `ui-kit`: the same
 * guarantees (a11y, states, tokens — zero hard-coded colors) proved on the local copies.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AppShell } from './app-shell.js';
import { Button, buttonVariants } from './button.js';
import { IconButton } from './icon-button.js';
import { Input } from './input.js';
import { Popover, PopoverContent, PopoverTrigger } from './popover.js';
import { Switch } from './switch.js';
import { Textarea } from './textarea.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';

describe('ui/Button', () => {
  it('renders a clickable button (happy path)', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Valider</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled: no click, attribute set', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        X
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading: disables, marks aria-busy, shows a spinner', () => {
    render(<Button loading>Enregistrer</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn.querySelector('.animate-spin')).not.toBeNull();
  });

  it('colors only through tokens (no hard-coded hex/rgb)', () => {
    const cls = buttonVariants({ variant: 'primary' });
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(cls).not.toMatch(/\brgb\(/i);
  });

  it('asChild: renders the child element while keeping the classes', () => {
    render(
      <Button asChild>
        <a href="/x">Lien</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Lien' });
    expect(link.className).toContain('bg-accent');
  });
});

describe('ui/IconButton', () => {
  it('exposes an accessible name via label (aria-label)', () => {
    render(<IconButton label="Supprimer" />);
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
  });

  it('loading: aria-busy + disabled', () => {
    render(<IconButton label="Charger" loading />);
    const btn = screen.getByRole('button', { name: 'Charger' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('size md = 44px (a11y touch target)', () => {
    render(<IconButton label="A" />);
    expect(screen.getByRole('button').className).toContain('size-11');
  });
});

describe('ui/Input', () => {
  it('keyboard input reflected', async () => {
    render(<Input aria-label="Nom" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Nom' }), 'abc');
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('abc');
  });

  it('invalid: aria-invalid + danger border', () => {
    render(<Input aria-label="Email" invalid />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.className).toContain('border-danger');
  });

  it('disabled: not editable', async () => {
    render(<Input aria-label="X" disabled defaultValue="" />);
    const input = screen.getByRole('textbox', { name: 'X' });
    await userEvent.type(input, 'zzz');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('');
  });
});

describe('ui/Textarea', () => {
  it('invalid: aria-invalid set', () => {
    render(<Textarea aria-label="Bio" invalid />);
    expect(screen.getByRole('textbox', { name: 'Bio' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ui/Switch', () => {
  it('switch role and toggles on click', async () => {
    render(<Switch aria-label="wifi" />);
    const sw = screen.getByRole('switch', { name: 'wifi' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('disabled: no toggle', async () => {
    render(<Switch aria-label="off" disabled />);
    const sw = screen.getByRole('switch', { name: 'off' });
    await userEvent.click(sw);
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

describe('ui/Popover', () => {
  it('toggles the trigger aria-expanded state', async () => {
    render(
      <Popover>
        <PopoverTrigger>Détails</PopoverTrigger>
        <PopoverContent>Contenu</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'Détails' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(await screen.findByText('Contenu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('ui/Tooltip', () => {
  it('appears on keyboard focus and carries the tooltip role', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Icône</TooltipTrigger>
          <TooltipContent>Explication</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab(); // keyboard focus on the trigger
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Explication');
  });
});

describe('ui/AppShell', () => {
  it('sets the banner / complementary / main landmarks', () => {
    render(
      <AppShell sidebar={<nav>menu</nav>} topbar={<div>top</div>}>
        contenu
      </AppShell>,
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Espaces' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('contenu');
  });

  it('sidebarCollapsed: the sidebar becomes inert and hidden from screen readers', () => {
    render(
      <AppShell sidebar={<nav>menu</nav>} sidebarCollapsed>
        contenu
      </AppShell>,
    );
    // Collapsed: no longer exposed as a landmark (aria-hidden), but still mounted (animation).
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
