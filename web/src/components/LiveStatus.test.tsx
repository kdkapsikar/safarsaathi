import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifySimulatorChanged } from '../lib/api';
import { mockApi } from '../test/fetchMock';
import { trainStatus } from '../test/trainFixtures';
import { LiveStatus } from './LiveStatus';

afterEach(() => vi.unstubAllGlobals());

const URL = 'GET /api/trains/12951/status?date=2026-10-09&boardingStation=MMCT';
const renderIt = () =>
  render(<LiveStatus trainNumber="12951" date="2026-10-09" boardingCode="MMCT" />);

describe('LiveStatus', () => {
  it('shows on-time status with departure, platform and "as of" time', async () => {
    mockApi({ [URL]: () => ({ status: 200, body: { status: trainStatus() } }) });
    renderIt();
    expect(await screen.findByText('Scheduled, on time')).toBeInTheDocument();
    expect(screen.getByText(/Departs MMCT 17:00 · Platform 4/)).toBeInTheDocument();
    expect(screen.getByText(/as of 15:42 · simulated data/)).toBeInTheDocument();
  });

  it('shows the delay, expected and scheduled departure, and last station', async () => {
    const s = trainStatus({ state: 'RUNNING', delayMinutes: 34 });
    s.stations[0] = {
      ...s.stations[0]!,
      delayMinutes: 34,
      expectedDeparture: '2026-10-09T12:04:00.000Z',
    };
    mockApi({ [URL]: () => ({ status: 200, body: { status: s } }) });
    renderIt();
    expect(await screen.findByText('Running 34 min late')).toBeInTheDocument();
    expect(screen.getByText(/Expected MMCT 17:34 \(sched\. 17:00\)/)).toBeInTheDocument();
  });

  it('shows cancellation with the source note', async () => {
    mockApi({
      [URL]: () => ({
        status: 200,
        body: {
          status: trainStatus({
            state: 'CANCELLED',
            cancelled: true,
            note: 'Cancelled (simulated).',
          }),
        },
      }),
    });
    renderIt();
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Cancelled (simulated).')).toBeInTheDocument();
  });

  it('says so when there is no data, instead of guessing', async () => {
    mockApi({});
    renderIt();
    expect(await screen.findByText('No live data for this train yet.')).toBeInTheDocument();
  });

  it('says so when the data source is down', async () => {
    mockApi({
      [URL]: () => ({
        status: 503,
        body: { error: { code: 'TRAIN_DATA_UNAVAILABLE', message: 'x' } },
      }),
    });
    renderIt();
    expect(await screen.findByText(/Live data is unavailable right now/)).toBeInTheDocument();
  });

  it('refreshes immediately when the simulator changes', async () => {
    let delay = 0;
    mockApi({
      [URL]: () => ({
        status: 200,
        body: { status: trainStatus({ state: 'RUNNING', delayMinutes: delay }) },
      }),
    });
    renderIt();
    expect(await screen.findByText('On time')).toBeInTheDocument();
    delay = 20;
    act(() => notifySimulatorChanged());
    expect(await screen.findByText('Running 20 min late')).toBeInTheDocument();
  });
});
