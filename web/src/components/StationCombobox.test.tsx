import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Station } from '../lib/stations';
import { StationCombobox } from './StationCombobox';

function Harness({ onSelect }: { onSelect: (s: Station) => void }) {
  const [value, setValue] = useState('');
  return (
    <StationCombobox
      label="From station"
      name="from"
      value={value}
      onChange={setValue}
      onSelect={onSelect}
    />
  );
}

describe('StationCombobox', () => {
  it('suggests stations by name and selects with the keyboard', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'From station' });

    await userEvent.type(input, 'chennai');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);

    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: 'MAS' }));
    expect(input).toHaveValue('MAS');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Chennai Central')).toBeInTheDocument();
  });

  it('selects with a click', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await userEvent.type(screen.getByRole('combobox'), 'howrah');
    await userEvent.click(screen.getByRole('option', { name: /Howrah/ }));
    expect(onSelect).toHaveBeenCalledWith({ code: 'HWH', name: 'Howrah Junction' });
  });

  it('closes on Escape and accepts codes that are not in the list', async () => {
    render(<Harness onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'ndl');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await userEvent.clear(input);
    await userEvent.type(input, 'QQQ');
    expect(input).toHaveValue('QQQ');
  });
});
