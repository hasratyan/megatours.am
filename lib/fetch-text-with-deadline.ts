/** Keep the deadline active until the response body has been fully consumed. */
export async function fetchTextWithDeadline(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; text: string }> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
  try {
    const response = await fetch(input, { ...init, signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    // Body consumption can report AbortError instead of the deadline's reason.
    signal.throwIfAborted();
    throw error;
  }
}
