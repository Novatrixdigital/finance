import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { WaveViz } from '@/components/brand/WaveViz';

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-base px-6">
      <div className="pointer-events-none absolute inset-0 grid-veil opacity-50" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 opacity-40">
        <WaveViz seed={5.1} lines={8} />
      </div>

      <div className="relative w-full max-w-lg text-center">
        <LogoMark size={48} className="mx-auto mb-10" glow />

        <p className="eyebrow mb-5">Error 404</p>
        <h1 className="headline text-[clamp(3rem,10vw,5.5rem)] text-ink">
          Nothing
          <br />
          <span className="text-accent">here.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-sm text-[14px] leading-relaxed text-ink-dim">
          This page does not exist — or it moved while you were looking the other way.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link to="/dashboard" className="btn-primary btn-lg">
            <ArrowLeft size={17} />
            Back to Dashboard
          </Link>
          <Link to="/transactions" className="btn-secondary btn-lg">
            <Compass size={16} />
            Browse transactions
          </Link>
        </div>
      </div>
    </div>
  );
}
