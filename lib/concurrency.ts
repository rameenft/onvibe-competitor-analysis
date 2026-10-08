// At most `limit` calls to the returned function run at once; the rest wait their turn.
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (active < limit) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else active--;
  }

  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
