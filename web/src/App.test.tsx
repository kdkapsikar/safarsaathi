import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { AuthProvider } from './auth/AuthContext';
import { mockApi, unauthenticated } from './test/fetchMock';
import { journey, user } from './test/fixtures';

afterEach(() => vi.unstubAllGlobals());

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('routing and auth', () => {
  it('shows the landing page to visitors', async () => {
    mockApi({
      'GET /api/auth/me': unauthenticated,
      'GET /api/health': () => ({ status: 200, body: {} }),
    });
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Know before the station board does.' }),
    ).toBeInTheDocument();
  });

  it('sends visitors from the dashboard to sign in', async () => {
    mockApi({ 'GET /api/auth/me': unauthenticated });
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('signs up and lands on an empty dashboard', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/register': () => ({ status: 201, body: { user } }),
      'GET /api/journeys': () => ({ status: 200, body: { journeys: [] } }),
    });
    renderAt('/signup');

    await userEvent.type(await screen.findByLabelText('Your name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('No journeys yet')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/auth/register')?.body).toEqual({
      name: 'Asha Rao',
      email: 'asha@example.com',
      password: 'supersecret1',
    });
  });

  it('validates the sign-up form before calling the API', async () => {
    const { calls } = mockApi({ 'GET /api/auth/me': unauthenticated });
    renderAt('/signup');
    await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toEqual(['GET /api/auth/me']);
  });

  it('shows a sign-in error from the server', async () => {
    mockApi({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } },
      }),
    });
    renderAt('/signin');
    await userEvent.type(await screen.findByLabelText('Email or username'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('shows journeys for a signed-in user and signs out', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: { user } }),
      'GET /api/journeys': () => ({ status: 200, body: { journeys: [journey()] } }),
      'POST /api/auth/logout': () => ({ status: 204 }),
      'GET /api/health': () => ({ status: 200, body: {} }),
    });
    renderAt('/');

    const card = await screen.findByRole('article', { name: /Train 12951/ });
    expect(screen.getByRole('region', { name: 'Your journeys' })).toContainElement(card);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /Know before/ }),
    ).toBeInTheDocument();
  });

  it('adds a new journey to the top of the list', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: { user } }),
      'GET /api/journeys': () => ({ status: 200, body: { journeys: [journey()] } }),
      'POST /api/journeys': (body) => ({
        status: 201,
        body: { journey: journey({ ...(body as object), id: 'j2', trainNumber: '12301' }) },
      }),
    });
    renderAt('/dashboard');

    await userEvent.type(await screen.findByLabelText('Train number'), '12301');
    await userEvent.type(screen.getByRole('combobox', { name: 'From station' }), 'HWH');
    await userEvent.type(screen.getByRole('combobox', { name: 'To station' }), 'NDLS');
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));

    await screen.findByText('Journey for train 12301 added.');
    const names = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(names[0]).toMatch(/Train 12301, HWH to NDLS/);
    expect(names).toHaveLength(2);
  });

  it('removes a deleted journey from the list', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: { user } }),
      'GET /api/journeys': () => ({ status: 200, body: { journeys: [journey()] } }),
      'DELETE /api/journeys/j1': () => ({ status: 204 }),
    });
    renderAt('/dashboard');
    await userEvent.click(
      await screen.findByRole('button', { name: /Delete journey: train 12951/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete journey' }));
    expect(await screen.findByText('No journeys yet')).toBeInTheDocument();
  });
});
