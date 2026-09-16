import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  label: string;
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[2fado] ${this.props.label} render failed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}
