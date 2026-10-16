type QuitEvent = { preventDefault(): void };

export class DesktopShutdown {
  private flight: Promise<void> | null = null;
  private completed = false;
  constructor(
    private readonly deps: {
      begin(): void;
      drain(): Promise<void>;
      closeStorage(): void;
      quit(): void;
      failed(): void;
    },
  ) {}

  beforeQuit(event: QuitEvent) {
    if (this.completed) return;
    event.preventDefault();
    if (this.flight) return;
    this.deps.begin();
    this.flight = Promise.resolve()
      .then(() => this.deps.drain())
      .then(() => {
        this.deps.closeStorage();
        this.completed = true;
        this.deps.quit();
      })
      .catch(() => {
        // A cleanup error is not permission to close SQLite under an active job.
        this.flight = null;
        this.deps.failed();
      });
  }
}
