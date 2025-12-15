/**
 * Helper function to make POST requests with JSON body
 */
export async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = typeof errorData.error === "string" ? errorData.error : `HTTP error ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/**
 * Helper function to make GET requests
 */
export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = typeof errorData.error === "string" ? errorData.error : `HTTP error ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
