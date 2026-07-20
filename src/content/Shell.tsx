import type { ReactNode } from 'react';

import { BackIcon, CloseIcon } from './icons';

const Z_INDEX = 2147483646;

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  headerRight?: ReactNode;
  footer?: ReactNode;
  /** Set false when the child manages its own scrolling (e.g. a scrollable list
   *  under a pinned toolbar). The body then just fills the available height. */
  scroll?: boolean;
  children: ReactNode;
}

/** The fixed right-side drawer frame: header (back / title / actions / close),
 *  a scrollable body, and an optional sticky footer. */
export default function Shell({ title, subtitle, onClose, onBack, headerRight, footer, scroll = true, children }: Props) {
  return (
    <div
      style={{ zIndex: Z_INDEX }}
      className="fixed inset-y-0 right-0 flex w-162.5 max-w-[92vw] flex-col bg-white text-gray-900 shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <BackIcon />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
        </div>
        {headerRight}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <CloseIcon />
        </button>
      </header>

      <div className={scroll ? 'flex-1 overflow-y-auto' : 'flex min-h-0 flex-1 flex-col'}>{children}</div>

      {footer && <footer className="border-t border-gray-100 px-4 py-3">{footer}</footer>}
    </div>
  );
}
