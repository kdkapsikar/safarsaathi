import { useState } from 'react';

/** Shown on the GitHub Pages build, where everything runs in the visitor's browser. */
export function DemoBanner() {
  const [confirming, setConfirming] = useState(false);
  const reset = () => void import('../demo/backend').then((m) => m.resetDemo());

  return (
    <div role="note" className="bg-ink px-4 py-2 text-center text-xs text-white sm:text-sm">
      <span className="font-semibold text-saffron">Demo</span> · Runs entirely in your browser with
      simulated train data. Your data stays on this device.{' '}
      {confirming ? (
        <>
          Erase demo data?{' '}
          <button
            type="button"
            onClick={reset}
            className="font-semibold underline underline-offset-2"
          >
            Yes, reset
          </button>{' '}
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="underline underline-offset-2"
          >
            No
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="underline underline-offset-2"
        >
          Reset demo
        </button>
      )}
    </div>
  );
}
