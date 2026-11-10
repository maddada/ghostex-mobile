/**
 * A render-error boundary: when a child throws while rendering, shows `renderFallback` in its place
 * instead of letting the error close the whole app. React Native has no hook for this, so it is a
 * class component. Try Again (`retry`) remounts the children from scratch.
 *
 * Kept free of react-native imports; the styled
 * fallback cards live with the screens that use it (settings/SectionBoundary.tsx,
 * machine-form/SectionBoundary.tsx).
 *
 * CDXC:Settings 2026-10-26 DECISION: User chose "Yes, around each Settings section" after the iOS Settings crash (#324) closed the whole app because one Settings page threw while rendering and nothing caught it. A section that throws now shows a small error card in its place and the rest of the page and of Settings keep working.
 */

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { logAppEvent } from '../../app/appLog';

export type ErrorBoundaryFallbackProps = {
  error: unknown;
  /** Clears the error and remounts the children. */
  retry: () => void;
};

export type ErrorBoundaryProps = {
  /** Where the error came from, for the log line (for example `settings:advanced:cursor`). */
  name: string;
  renderFallback: (props: ErrorBoundaryFallbackProps) => ReactNode;
  children?: ReactNode;
};

type ErrorBoundaryState = {
  /** `{ error }` once a child threw (boxed so a thrown `null` or `undefined` still counts), else null. */
  caught: { error: unknown } | null;
  /** Bumped by `retry`; the children are keyed by it so they mount fresh. */
  attempt: number;
};

/** One readable line for whatever was thrown (an Error, a `{ message }` object, a string, anything). */
export function errorBoundaryMessage(error: unknown): string {
  if (error instanceof Error) return error.message.length > 0 ? error.message : error.name;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) return error;
  return 'Unknown error';
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { caught: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { caught: { error } };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The app logs with console.warn (chat/rust/*); there is no crash-reporting service. The app
    // log keeps the crash text that section cards no longer show (CDXC:Notices 2026-11-06).
    logAppEvent(`${this.props.name} failed to render: ${errorBoundaryMessage(error)}`);
    console.warn(
      `[error-boundary] ${this.props.name} failed to render: ${errorBoundaryMessage(error)}`,
      error instanceof Error ? error.stack : undefined,
      info.componentStack,
    );
  }

  private retry = (): void => {
    this.setState((state) => ({ caught: null, attempt: state.attempt + 1 }));
  };

  render(): ReactNode {
    const { caught, attempt } = this.state;
    if (caught !== null) return this.props.renderFallback({ error: caught.error, retry: this.retry });
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}
