import { Component } from 'react';
import { RefreshCw, AlertOctagon } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';

/**
 * Last line of defence. A render error in one panel should not leave the user
 * staring at a blank page with no way forward.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Novatrix] Unhandled render error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-6">
        <div className="w-full max-w-md text-center">
          <LogoMark size={48} className="mx-auto mb-8" glow />

          <span className="icon-tile mx-auto mb-6 h-14 w-14 border-negative/25 bg-negative/[0.08]">
            <AlertOctagon size={22} className="text-negative" strokeWidth={1.8} />
          </span>

          <h1 className="headline text-[2rem] text-ink">Something broke.</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-dim">
            The screen failed to render. Your data is untouched — reloading almost always clears it.
          </p>

          {import.meta.env.DEV && (
            <pre className="mt-6 max-h-40 overflow-auto rounded-2xl border border-hair bg-surface p-4 text-left text-[11px] leading-relaxed text-negative">
              {String(error?.message || error)}
            </pre>
          )}

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary btn-md mx-auto mt-8"
          >
            <RefreshCw size={15} />
            Reload Novatrix
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
