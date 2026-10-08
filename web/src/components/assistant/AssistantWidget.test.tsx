import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import { mockApi, unauthenticated } from '../../test/fetchMock';
import { user } from '../../test/fixtures';
import { AssistantWidget } from './AssistantWidget';

afterEach(() => vi.unstubAllGlobals());

const renderWidget = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <AssistantWidget />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('AssistantWidget', () => {
  it('opens from the launcher, shows Saathi, and closes with Escape', async () => {
    mockApi({ 'GET /api/auth/me': unauthenticated });
    renderWidget();

    const launcher = screen.getByRole('button', { name: 'Open Saathi assistant' });
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(launcher);

    const panel = screen.getByRole('dialog', { name: 'Saathi' });
    expect(
      screen.getByRole('img', { name: /Saathi, a friendly red locomotive/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Saathi' })).toHaveFocus();
    expect(panel).toHaveTextContent("I can't answer yet");

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Saathi assistant' })).toHaveFocus();
  });

  it('greets a signed-in user by first name', async () => {
    mockApi({ 'GET /api/auth/me': () => ({ status: 200, body: { user } }) });
    renderWidget();
    await userEvent.click(screen.getByRole('button', { name: 'Open Saathi assistant' }));
    expect(await screen.findByText(/Namaste, Asha!/)).toBeInTheDocument();
  });

  it("doesn't pretend to answer: the message box is disabled", async () => {
    mockApi({ 'GET /api/auth/me': unauthenticated });
    renderWidget();
    await userEvent.click(screen.getByRole('button', { name: 'Open Saathi assistant' }));
    expect(screen.getByLabelText('Message Saathi')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
