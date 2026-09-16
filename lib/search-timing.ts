export function createSearchTiming() {
  const stages = new Map<string, number>();
  return {
    async measure<T>(name: string, task: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try { return await task(); }
      finally { stages.set(name, performance.now() - start); }
    },
    header() {
      return [...stages].map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(", ");
    },
  };
}
