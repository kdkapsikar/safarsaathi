import { Link } from 'react-router';

export function Brand() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-saffron"
    >
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-lg font-semibold tracking-tight">Safar Saathi</span>
    </Link>
  );
}
