/**
 * Tests for the vendored Modal primitive (ADR 0006, #95) — adapted from `ui-kit`:
 * same guarantees (a11y role/label, Escape handling, tokens) proven on the local copy.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Modal, ModalContent, ModalDescription, ModalTitle, ModalTrigger } from './modal.js';

describe('ui/Modal', () => {
  it('opens, exposes a dialog role with an accessible name, closes on Escape', async () => {
    render(
      <Modal>
        <ModalTrigger>Open</ModalTrigger>
        <ModalContent>
          <ModalTitle>Confirm</ModalTitle>
          <ModalDescription>Are you sure?</ModalDescription>
        </ModalContent>
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Confirm');
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('controlled mode: reports close requests through onOpenChange', async () => {
    const calls: boolean[] = [];
    const onOpenChange = (open: boolean): void => {
      calls.push(open);
    };
    render(
      <Modal open onOpenChange={onOpenChange}>
        <ModalContent>
          <ModalTitle>Join</ModalTitle>
          <ModalDescription>Session credentials</ModalDescription>
        </ModalContent>
      </Modal>,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(calls).toContain(false));
  });

  it('showClose={false} hides the corner close button', async () => {
    render(
      <Modal open>
        <ModalContent showClose={false} description="No close button">
          <ModalTitle>Bare</ModalTitle>
        </ModalContent>
      </Modal>,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fermer' })).not.toBeInTheDocument();
  });

  it('colors come from tokens only (no hard-coded hex/rgb in classes)', async () => {
    render(
      <Modal open>
        <ModalContent description="token check">
          <ModalTitle>Tokens</ModalTitle>
        </ModalContent>
      </Modal>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(dialog.className).not.toMatch(/\brgb\(/i);
  });
});
