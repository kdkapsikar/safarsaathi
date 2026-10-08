import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import { mockApi, sse, unauthenticated } from '../../test/fetchMock';
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

const visitor = (extra = {}) =>
  mockApi({
    'GET /api/auth/me': unauthenticated,
    'GET /api/chat/info': () => ({ status: 200, body: { mode: 'offline', signedIn: false } }),
    ...extra,
  });

const open = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Open Saathi assistant' }));

describe('AssistantWidget', () => {
  it('opens on the scene with example questions, focuses the input, and closes with Escape', async () => {
    visitor();
    renderWidget();
    await open();

    expect(screen.getByRole('dialog', { name: 'Saathi' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Saathi, a friendly red locomotive/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Message Saathi')).toHaveFocus();
    expect(screen.getByRole('list', { name: 'Example questions' })).toBeInTheDocument();
    expect(await screen.findByText(/basic mode/)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Saathi assistant' })).toHaveFocus();
  });

  it('streams an answer, showing what Saathi is checking', async () => {
    const { calls } = visitor({
      'POST /api/chat': () =>
        sse(
          { type: 'tool', name: 'get_live_status', status: 'start' },
          { type: 'tool', name: 'get_live_status', status: 'done' },
          { type: 'text', delta: '12951 is running ' },
          { type: 'text', delta: '25 min late. As of 21:00 IST.' },
          { type: 'done', sessionId: null, mode: 'offline' },
        ),
    });
    renderWidget();
    await open();
    await userEvent.type(screen.getByLabelText('Message Saathi'), 'Is 12951 late?{Enter}');

    const log = screen.getByRole('log');
    expect(
      await within(log).findByText(/12951 is running 25 min late\. As of 21:00 IST\./),
    ).toBeInTheDocument();
    expect(within(log).getByText(/Is 12951 late\?/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/chat')?.body).toEqual({
      message: 'Is 12951 late?',
      history: [],
    });
  });

  it('sends an example question when clicked, with earlier turns for visitors', async () => {
    let n = 0;
    const { calls } = visitor({
      'POST /api/chat': () =>
        sse(
          { type: 'text', delta: `Answer ${++n}` },
          { type: 'done', sessionId: null, mode: 'offline' },
        ),
    });
    renderWidget();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Is 12951 running late?' }));
    await screen.findByText(/Answer 1/);
    await userEvent.type(screen.getByLabelText('Message Saathi'), 'and tomorrow?{Enter}');
    await screen.findByText(/Answer 2/);

    const second = calls.filter((c) => c.key === 'POST /api/chat')[1]!.body as {
      history: unknown[];
    };
    expect(second.history).toEqual([
      { role: 'user', text: 'Is 12951 running late?' },
      { role: 'assistant', text: 'Answer 1' },
    ]);
  });

  it('shows a confirm card for a proposed journey and runs it only on Confirm', async () => {
    const onChanged = vi.fn();
    window.addEventListener('safar:journeys-changed', onChanged);
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: { user } }),
      'GET /api/chat/info': () => ({ status: 200, body: { mode: 'claude', signedIn: true } }),
      'GET /api/chat/history': () => ({ status: 200, body: { sessionId: null, messages: [] } }),
      'POST /api/chat': () =>
        sse(
          {
            type: 'proposal',
            proposal: {
              id: 'p1',
              kind: 'CREATE_JOURNEY',
              summary: 'Track train 12301 from HWH to NDLS on 2026-10-10',
              expiresAt: 'x',
            },
          },
          { type: 'text', delta: 'Press Confirm to save it.' },
          { type: 'done', sessionId: 's1', mode: 'claude' },
        ),
      'POST /api/chat/proposals/p1/confirm': () => ({ status: 200, body: { result: 'created' } }),
    });
    renderWidget();
    await open();
    await userEvent.type(screen.getByLabelText('Message Saathi'), 'track 12301 tomorrow{Enter}');

    expect(
      await screen.findByText('Track train 12301 from HWH to NDLS on 2026-10-10'),
    ).toBeInTheDocument();
    expect(calls.map((c) => c.key)).not.toContain('POST /api/chat/proposals/p1/confirm');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Done: journey added to your dashboard.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('safar:journeys-changed', onChanged);
  });

  it('greets a signed-in user by name and restores their last conversation', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: { user } }),
      'GET /api/chat/info': () => ({ status: 200, body: { mode: 'claude', signedIn: true } }),
      'GET /api/chat/history': () => ({
        status: 200,
        body: {
          sessionId: 's1',
          messages: [
            { role: 'user', text: 'Is 12951 late?' },
            { role: 'assistant', text: 'It was 20 min late as of 20:00 IST.' },
          ],
        },
      }),
    });
    renderWidget();
    await open();
    expect(await screen.findByText(/It was 20 min late as of 20:00 IST\./)).toBeInTheDocument();
  });

  it('shows rate-limit and error messages', async () => {
    visitor({
      'POST /api/chat': () => ({
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Too many messages from this network.' } },
      }),
    });
    renderWidget();
    await open();
    await userEvent.type(screen.getByLabelText('Message Saathi'), 'hi{Enter}');
    expect(await screen.findByText(/Too many messages from this network\./)).toBeInTheDocument();
  });
});
