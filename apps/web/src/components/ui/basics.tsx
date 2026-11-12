import type { MoneyView } from '@bountyline/contracts';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/** A money amount from the API; the server formats it, the UI never computes it. */
export function Money({ value, className = '' }: { value: MoneyView; className?: string }) {
  return (
    <span className={`font-mono font-bold tabular-nums text-money ${className}`}>
      {value.formatted}
    </span>
  );
}

/** Framed claim photo with an optional simulated label. */
export function PhotoFrame({
  src,
  alt,
  label,
}: {
  src?: string | undefined;
  alt: string;
  label?: string | undefined;
}) {
  return (
    <figure className="relative overflow-hidden rounded-md border border-line bg-surface-2">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="block aspect-[4/3] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center text-sm text-muted">
          No photo yet
        </div>
      )}
      {label ? (
        <figcaption className="absolute left-2 top-2 rounded-sm bg-ink/80 px-2 py-0.5 text-xs font-semibold text-bg">
          {label}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {body ? <p className="mt-1 text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-muted">
      <span aria-hidden="true" className="bl-pulse h-3 w-3 rounded-full bg-brand" />
      {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-fail bg-fail-soft p-4 text-fail">
      <p className="font-semibold">
        <span aria-hidden="true">✕ </span>
        {message}
      </p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="bl-touch mt-2 font-semibold underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Shows a banner when the browser goes offline. */
export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="status"
      className="bg-hold-soft px-4 py-2 text-center text-sm font-semibold text-hold"
    >
      You are offline. Bountyline will reconnect when your signal returns.
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

const VARIANTS = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  danger: 'bg-fail text-bg hover:opacity-90',
  ghost: 'text-ink underline-offset-4 hover:underline',
};

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
  ariaLabel,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`bl-touch inline-flex items-center justify-center gap-2 rounded-md px-5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Small "simulated" tag for Judge mode, so nothing simulated is ever hidden. */
export function SimTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-skip bg-skip-soft px-1.5 py-0.5 text-xs font-semibold text-skip">
      <span aria-hidden="true">◇</span>
      {children}
    </span>
  );
}
