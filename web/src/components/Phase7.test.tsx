import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinPage, OptOutPage } from '../pages/PublicLink';
import { mockApi } from '../test/fetchMock';
import { journey } from '../test/fixtures';
import { trainStatus } from '../test/trainFixtures';
import { JourneySettingsForm } from './JourneySettingsForm';
import { LiveStatus } from './LiveStatus';
import { RecipientsPanel } from './RecipientsPanel';

afterEach(() => vi.unstubAllGlobals());

describe('JourneySettingsForm', () => {
  it('saves delay threshold, quiet hours, travel time and a connection', async () => {
    const j = journey();
    const other = journey({
      id: '0b9f3c2e-4c1a-4f5e-9d7b-2a6c8e1f0a11',
      trainNumber: '12002',
      fromStationCode: 'NDLS',
      toStationCode: 'AGC',
    });
    const { calls } = mockApi({
      'PUT /api/journeys/j1/settings': (body) => ({
        status: 200,
        body: { journey: { ...j, settings: body } },
      }),
    });
    const onSaved = vi.fn();
    render(<JourneySettingsForm journey={j} others={[other]} onSaved={onSaved} />);

    await userEvent.selectOptions(screen.getByLabelText('Delay alerts start at'), '30');
    await userEvent.click(screen.getByLabelText(/Hold non-urgent alerts/));
    await userEvent.type(screen.getByLabelText('Travel time to MMCT (minutes)'), '45');
    await userEvent.selectOptions(
      screen.getByLabelText('Connects to'),
      '0b9f3c2e-4c1a-4f5e-9d7b-2a6c8e1f0a11',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(calls.find((c) => c.key === 'PUT /api/journeys/j1/settings')?.body).toEqual({
      minDelayMinutes: 30,
      quietHoursStart: '22:00',
      quietHoursEnd: '06:30',
      travelTimeMinutes: 45,
      leaveBufferMinutes: 15,
      connectsToJourneyId: '0b9f3c2e-4c1a-4f5e-9d7b-2a6c8e1f0a11',
      connectionBufferMinutes: 30,
    });
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it('warns when the connecting train starts from another station', async () => {
    mockApi({});
    const other = journey({ id: 'j2', trainNumber: '12002', fromStationCode: 'DLI' });
    render(<JourneySettingsForm journey={journey()} others={[other]} onSaved={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Connects to'), 'j2');
    expect(screen.getByText(/starts from a different station than NDLS/)).toBeInTheDocument();
  });

  it('turning quiet hours off and clearing travel time sends nulls', async () => {
    const j = journey({
      settings: {
        ...journey().settings,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00',
        travelTimeMinutes: 30,
      },
    });
    const { calls } = mockApi({
      'PUT /api/journeys/j1/settings': () => ({ status: 200, body: { journey: j } }),
    });
    render(<JourneySettingsForm journey={j} others={[]} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/Hold non-urgent alerts/));
    await userEvent.clear(screen.getByLabelText('Travel time to MMCT (minutes)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(calls.at(-1)?.body).toMatchObject({
      quietHoursStart: null,
      quietHoursEnd: null,
      travelTimeMinutes: null,
    });
  });
});

describe('RecipientsPanel', () => {
  it('lists, adds and removes people, and shows opted-out status', async () => {
    const { calls } = mockApi({
      'GET /api/journeys/j1/recipients': () => ({
        status: 200,
        body: {
          recipients: [
            {
              id: 'r1',
              journeyId: 'j1',
              name: 'Amma',
              email: 'amma@example.com',
              channel: 'EMAIL',
              optedOut: true,
              createdAt: 'x',
            },
          ],
        },
      }),
      'POST /api/journeys/j1/recipients': (b) => ({
        status: 201,
        body: {
          recipient: {
            id: 'r2',
            journeyId: 'j1',
            ...(b as object),
            channel: 'EMAIL',
            optedOut: false,
            createdAt: 'x',
          },
        },
      }),
      'DELETE /api/journeys/j1/recipients/r1': () => ({ status: 204 }),
    });
    render(<RecipientsPanel journey={journey()} onInviteChange={vi.fn()} />);

    expect(await screen.findByText('Opted out')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Their name'), 'Raju');
    await userEvent.type(screen.getByLabelText('Their email'), 'raju@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText("Raju will get this journey's alerts.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Amma' }));
    expect(screen.queryByText('amma@example.com')).not.toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain('DELETE /api/journeys/j1/recipients/r1');
  });

  it('validates the email before sending', async () => {
    const { calls } = mockApi({
      'GET /api/journeys/j1/recipients': () => ({ status: 200, body: { recipients: [] } }),
    });
    render(<RecipientsPanel journey={journey()} onInviteChange={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText('Their name'), 'Raju');
    await userEvent.type(screen.getByLabelText('Their email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(calls.map((c) => c.key)).not.toContain('POST /api/journeys/j1/recipients');
  });

  it('creates and shows an invite link', async () => {
    mockApi({
      'GET /api/journeys/j1/recipients': () => ({ status: 200, body: { recipients: [] } }),
      'POST /api/journeys/j1/invite': () => ({
        status: 200,
        body: { inviteToken: 'tok_abcdefghijklmnop' },
      }),
    });
    const onInviteChange = vi.fn();
    const { rerender } = render(
      <RecipientsPanel journey={journey()} onInviteChange={onInviteChange} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Create invite link' }));
    expect(onInviteChange).toHaveBeenCalledWith('tok_abcdefghijklmnop');
    rerender(
      <RecipientsPanel
        journey={journey({ inviteToken: 'tok_abcdefghijklmnop' })}
        onInviteChange={onInviteChange}
      />,
    );
    expect(screen.getByLabelText('Invite link')).toHaveValue(
      `${window.location.origin}/join/tok_abcdefghijklmnop`,
    );
  });
});

describe('public links', () => {
  const at = (path: string, el: React.ReactNode, route: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
        </Routes>
      </MemoryRouter>,
    );
  const info = {
    trainNumber: '12951',
    fromStationCode: 'MMCT',
    toStationCode: 'NDLS',
    journeyDate: '2026-10-09',
  };

  it('join page: shows who invited you and adds you', async () => {
    const { calls } = mockApi({
      'GET /api/invites/tok123': () => ({
        status: 200,
        body: { invite: { ...info, ownerFirstName: 'Asha' } },
      }),
      'POST /api/invites/tok123': () => ({ status: 201, body: { joined: true } }),
    });
    at('/join/tok123', <JoinPage />, '/join/:token');
    expect(
      await screen.findByText(
        /Asha invited you to get updates about train 12951, MMCT → NDLS on Fri, 9 Oct 2026/,
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Raju');
    await userEvent.type(screen.getByLabelText('Your email'), 'raju@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Get alerts' }));
    expect(await screen.findByRole('heading', { name: "You're on the list" })).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ name: 'Raju', email: 'raju@example.com' });
  });

  it('join page: explains an invalid link', async () => {
    mockApi({});
    at('/join/bad', <JoinPage />, '/join/:token');
    expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
  });

  it('opt-out page: one click stops alerts', async () => {
    mockApi({
      'GET /api/opt-out/tok9': () => ({
        status: 200,
        body: { optOut: { ...info, recipientName: 'Raju', optedOut: false } },
      }),
      'POST /api/opt-out/tok9': () => ({ status: 200, body: { optedOut: true } }),
    });
    at('/optout/tok9', <OptOutPage />, '/optout/:token');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop these alerts' }));
    expect(await screen.findByRole('heading', { name: 'Alerts stopped' })).toBeInTheDocument();
  });
});

describe('LiveStatus leave-by', () => {
  it('shows when to leave home from the live departure', async () => {
    mockApi({
      'GET /api/trains/12951/status?date=2026-10-09&boardingStation=MMCT': () => ({
        status: 200,
        body: { status: trainStatus() },
      }),
    });
    render(
      <LiveStatus
        trainNumber="12951"
        date="2026-10-09"
        boardingCode="MMCT"
        travelTimeMinutes={45}
        leaveBufferMinutes={15}
      />,
    );
    expect(await screen.findByText('Leave home by 16:00')).toBeInTheDocument();
    expect(screen.getByText(/45 min travel \+ 15 min spare/)).toBeInTheDocument();
  });
});
