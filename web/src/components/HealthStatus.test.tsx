import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthStatus } from './HealthStatus';

function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

const healthy = () =>
  new Response(
    JSON.stringify({
      status: 'ok',
      service: 'safar-saathi-api',
      time: new Date().toISOString(),
      uptimeSeconds: 1,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('HealthStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the API is up when /api/health responds', async () => {
    const fetchMock = mockFetch(healthy());
    render(<HealthStatus />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking the API');
    expect(await screen.findByText(/API is up/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows an error and recovers on retry', async () => {
    mockFetch(new Response('', { status: 502 }), healthy());
    render(<HealthStatus />);

    expect(await screen.findByText(/API unreachable: .*502/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/API is up/)).toBeInTheDocument();
  });
});
