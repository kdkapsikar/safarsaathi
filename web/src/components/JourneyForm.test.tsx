import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { fixedNow } from '../test/fixtures';
import { JourneyForm } from './JourneyForm';

const fill = async () => {
  await userEvent.type(screen.getByLabelText('Train number'), '12951');
  await userEvent.type(screen.getByRole('combobox', { name: 'From station' }), 'mmct');
  await userEvent.type(screen.getByRole('combobox', { name: 'To station' }), 'ndls');
};

describe('JourneyForm', () => {
  it('defaults the date to today (IST) and pre-selects common alerts', () => {
    render(<JourneyForm onCreate={vi.fn()} now={fixedNow} />);
    expect(screen.getByLabelText('Journey date')).toHaveValue('2026-10-09');
    const group = screen.getByRole('group', { name: 'Alert me about' });
    expect(within(group).getByRole('checkbox', { name: /Departure/ })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: /Arrival/ })).not.toBeChecked();
  });

  it('shows field errors and does not submit invalid input', async () => {
    const onCreate = vi.fn();
    render(<JourneyForm onCreate={onCreate} now={fixedNow} />);
    await userEvent.type(screen.getByLabelText('Train number'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Train number must be 5 digits')).toBeInTheDocument();
    expect(screen.getByLabelText('Train number')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Station code must be 1-5 letters')).toHaveLength(2);
  });

  it('requires at least one alert type', async () => {
    const onCreate = vi.fn();
    render(<JourneyForm onCreate={onCreate} now={fixedNow} />);
    await fill();
    for (const name of [/Departure/, /Delay/, /Platform change/]) {
      await userEvent.click(screen.getByRole('checkbox', { name }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Choose at least one alert type')).toBeInTheDocument();
  });

  it('only allows train numbers to contain digits', async () => {
    render(<JourneyForm onCreate={vi.fn()} now={fixedNow} />);
    await userEvent.type(screen.getByLabelText('Train number'), '12a9b5');
    expect(screen.getByLabelText('Train number')).toHaveValue('1295');
  });

  it('submits normalised data, then resets and announces success', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<JourneyForm onCreate={onCreate} now={fixedNow} />);
    await fill();
    await userEvent.click(screen.getByRole('checkbox', { name: /Arrival/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));

    expect(onCreate).toHaveBeenCalledWith({
      trainNumber: '12951',
      fromStationCode: 'MMCT',
      fromStationName: undefined,
      toStationCode: 'NDLS',
      toStationName: undefined,
      journeyDate: '2026-10-09',
      alertTypes: ['DEPARTURE', 'DELAY', 'PLATFORM_CHANGE', 'ARRIVAL'],
    });
    expect(await screen.findByText('Journey for train 12951 added.')).toBeInTheDocument();
    expect(screen.getByLabelText('Train number')).toHaveValue('');
  });

  it('rejects a date in the past', async () => {
    const onCreate = vi.fn();
    render(<JourneyForm onCreate={onCreate} now={fixedNow} />);
    await fill();
    const date = screen.getByLabelText('Journey date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Journey date is in the past')).toBeInTheDocument();
  });

  it('shows server-side field errors', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, 'VALIDATION', 'Check fields', { journeyDate: 'Server says no' }),
      );
    render(<JourneyForm onCreate={onCreate} now={fixedNow} />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));
    expect(await screen.findByText('Server says no')).toBeInTheDocument();
  });

  it('shows a general error when the request fails', async () => {
    const onCreate = vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK', 'Offline'));
    render(<JourneyForm onCreate={onCreate} now={fixedNow} />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Add journey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  });
});
