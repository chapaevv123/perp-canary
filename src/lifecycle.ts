export async function withSnapshotSdk<T>(
  sdk: { close(): Promise<void> },
  controller: AbortController,
  work: () => Promise<T>,
  phase: () => string,
  timeoutMs = 180_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Live snapshot timed out after ${timeoutMs} ms during ${phase()}`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    result = await Promise.race([work(), deadline]);
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await sdk.close();
    } catch (closeError) {
      failure = failed ? new AggregateError([failure, closeError], `Snapshot failed and SDK cleanup failed during ${phase()}`) : closeError;
      failed = true;
    }
  }
  if (failed) throw failure;
  return result as T;
}
