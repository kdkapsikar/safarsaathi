import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/fetchMock';
import { fixedNow, journey } from '../test/fixtures';
import { JourneyList } from './JourneyList';

describe('JourneyList', () => {
  // Live status lines fetch their own data; no data is fine here.
  beforeEach(() => mockApi({}));
  afterEach(() => vi.unstubAllGlobals());

  it('shows an empty state', () => {
    render(<JourneyList journeys={[]} onDelete={vi.fn()} />);
    expect(screen.getByText('No journeys yet')).toBeInTheDocument();
  });

  it('renders journeys in the given order with date and alert badges', () => {
    render(
      <JourneyList
        now={fixedNow}
        onDelete={vi.fn()}
        journeys={[
          journey({ id: 'a', trainNumber: '22222', journeyDate: '2026-10-10' }),
          journey({ id: 'b', trainNumber: '11111', alertTypes: ['PLATFORM_CHANGE'] }),
        ]}
      />,
    );
    const items = screen.getAllByRole('article');
    expect(items.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Train 22222, MMCT to NDLS',
      'Train 11111, MMCT to NDLS',
    ]);
    expect(within(items[0]!).getByText('Tomorrow')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Sat, 10 Oct 2026')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Today')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('list', { name: 'Alerts' })).toHaveTextContent(
      'Platform change',
    );
  });

  it('asks for confirmation; cancel keeps the journey', async () => {
    const onDelete = vi.fn();
    render(<JourneyList journeys={[journey()]} onDelete={onDelete} now={fixedNow} />);

    await userEvent.click(screen.getByRole('button', { name: /Delete journey: train 12951/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this journey?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('Escape closes the dialog without deleting', async () => {
    const onDelete = vi.fn();
    render(<JourneyList journeys={[journey()]} onDelete={onDelete} now={fixedNow} />);
    await userEvent.click(screen.getByRole('button', { name: /Delete journey/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes after confirming', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<JourneyList journeys={[journey()]} onDelete={onDelete} now={fixedNow} />);
    await userEvent.click(screen.getByRole('button', { name: /Delete journey/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete journey' }));
    expect(onDelete).toHaveBeenCalledWith('j1');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows an error if the delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Journey not found.'));
    render(<JourneyList journeys={[journey()]} onDelete={onDelete} now={fixedNow} />);
    await userEvent.click(screen.getByRole('button', { name: /Delete journey/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete journey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Journey not found.');
  });
});
