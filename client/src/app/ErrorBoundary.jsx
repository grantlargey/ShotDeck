import { Component } from "react";
import { Button } from "@/shared/ui/Button.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import styles from "./styles/ErrorBoundary.module.css";

/**
 * Catches render errors so a broken page shows a recoverable message instead of
 * blanking the whole app. A new `resetKey` (the route) clears the error.
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
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className={styles.fallback}>
        <EmptyState
          title="Something went wrong"
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          }
        >
          This page hit an unexpected error. Reload to try again.
        </EmptyState>
      </div>
    );
  }
}
