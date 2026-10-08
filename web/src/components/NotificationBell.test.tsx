import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNotification } from '../lib/api';
import { mockApi } from '../test/fetchMock';
import { NotificationBell } from './NotificationBell';

afterEach(() => vi.unstubAllGlobals());

const n = (id: string, overrides: Partial<AppNotification> = {}): AppNotification => ({
  id,
  journeyId: 'j1',
  eventKey: 'DELAY:30',
  title: `Alert ${id}`,
  body: '12951 Mumbai Rajdhani is 30 min late. As of 21:00.',
  readAt: null,
  createdAt: '2026-10-09T15:30:00.000Z',
  ...overrides,
});

describe('NotificationBell', () => {
  it('shows the unread count and lists alerts', async () => {
    mockApi({
      'GET /api/notifications': () => ({
        status: 200,
        body: {
          notifications: [n('a'), n('b', { readAt: '2026-10-09T16:00:00.000Z' })],
          unreadCount: 1,
        },
      }),
    });
    render(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await userEvent.click(bell);
    const panel = screen.getByRole('region', { name: 'Notifications' });
    expect(within(panel).getByText('Alert a')).toBeInTheDocument();
    expect(within(panel).getAllByText('Fri, 9 Oct 2026, 21:00')).toHaveLength(2);
  });

  it('marks one alert, or all, as read', async () => {
    const { calls } = mockApi({
      'GET /api/notifications': () => ({
        status: 200,
        body: { notifications: [n('a'), n('b')], unreadCount: 2 },
      }),
      'POST /api/notifications/a/read': () => ({ status: 204 }),
      'POST /api/notifications/read-all': () => ({ status: 200, body: { marked: 1 } }),
    });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(screen.getByRole('button', { name: /Alert a/ }));
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain('POST /api/notifications/read-all');
  });

  it('shows an empty state and closes with Escape', async () => {
    mockApi({
      'GET /api/notifications': () => ({
        status: 200,
        body: { notifications: [], unreadCount: 0 },
      }),
    });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(screen.getByText(/No alerts yet/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });
});
