import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorState } from '../lib/api';
import { mockApi } from '../test/fetchMock';
import { trainStatus } from '../test/trainFixtures';
import { Simulator } from './Simulator';

afterEach(() => vi.unstubAllGlobals());

const state = (overrides: Partial<SimulatorState> = {}): SimulatorState => ({
  alertRun: null,
  now: '2026-10-09T10:30:00.000Z',
  offsetMinutes: 0,
  health: 'HEALTHY',
  scenarios: [
    { id: 'ON_TIME', label: 'On time', description: 'Runs exactly to schedule.' },
    { id: 'CANCELLED', label: 'Cancelled', description: 'Cancelled 4 hours ahead.' },
  ],
  trains: [
    {
      trainNumber: '12951',
      trainName: 'Mumbai Rajdhani',
      from: 'MMCT',
      to: 'NDLS',
      scenario: 'ON_TIME',
    },
  ],
  stats: {
    upstreamCalls: 3,
    cacheHits: 7,
    coalesced: 1,
    staleServed: 0,
    failures: 0,
    breaker: 'CLOSED',
  },
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <Simulator />
    </MemoryRouter>,
  );

describe('Simulator page', () => {
  it('shows simulated time, source stats and each train with its timeline', async () => {
    mockApi({
      'GET /api/simulator': () => ({ status: 200, body: state() }),
      'GET /api/trains/12951/status?date=2026-10-09': () => ({
        status: 200,
        body: { status: trainStatus() },
      }),
    });
    renderPage();

    expect(await screen.findByText('Fri, 9 Oct 2026, 16:00')).toBeInTheDocument();
    expect(screen.getByText('Real time')).toBeInTheDocument();
    const train = await screen.findByRole('article', { name: /Train 12951/ });
    expect(
      within(train).getByRole('list', { name: 'Stations for train 12951' }),
    ).toBeInTheDocument();
    expect(within(train).getByText('PF 4')).toBeInTheDocument();
  });

  it('changes a scenario and advances the clock through the API', async () => {
    const { calls } = mockApi({
      'GET /api/simulator': () => ({ status: 200, body: state() }),
      'GET /api/trains/12951/status?date=2026-10-09': () => ({
        status: 200,
        body: { status: trainStatus() },
      }),
      'POST /api/simulator/scenario': () => ({
        status: 200,
        body: state({ trains: [{ ...state().trains[0]!, scenario: 'CANCELLED' }] }),
      }),
      'POST /api/simulator/clock': () => ({ status: 200, body: state({ offsetMinutes: 60 }) }),
    });
    const onChange = vi.fn();
    window.addEventListener('safar:simulator-changed', onChange);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText('Scenario'), 'CANCELLED');
    expect(calls.find((c) => c.key === 'POST /api/simulator/scenario')?.body).toEqual({
      trainNumber: '12951',
      scenario: 'CANCELLED',
    });

    await userEvent.click(screen.getByRole('button', { name: '+1 hour' }));
    expect(calls.find((c) => c.key === 'POST /api/simulator/clock')?.body).toEqual({
      action: 'advance',
      minutes: 60,
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    window.removeEventListener('safar:simulator-changed', onChange);
  });

  it('explains when the simulator is off', async () => {
    mockApi({});
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('The simulator is turned off');
  });
});
