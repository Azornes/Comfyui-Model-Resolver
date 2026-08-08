/**
 * Execute a JSON request through a ComfyUI API client.
 *
 * The client and notification callback are injected so this utility remains
 * independent from ComfyUI globals and can be tested in Node.js.
 */
export async function fetchJson(
  endpoint,
  options = {},
  errorContext = 'API Request',
  {
    apiClient,
    notify,
    logError = console.error,
    throwOnHttpError = true,
  } = {}
) {
  try {
    const fetchOptions = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };
    const response = await apiClient.fetchApi(endpoint, fetchOptions);
    if (!response.ok) {
      if (!throwOnHttpError) return null;
      let errorMsg = `Server returned ${response.status}: ${response.statusText}`;
      try {
        const errData = await response.json();
        if (errData && errData.error) {
          errorMsg = errData.error;
        }
      } catch (_error) {}
      const error = new Error(errorMsg);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) {
      return null;
    }
    if (options.raw) {
      return response;
    }
    return await response.json();
  } catch (error) {
    if (typeof logError === 'function') {
      logError(`Model Resolver: ${errorContext} failed:`, error);
    }
    if (!options.silent && typeof notify === 'function') {
      notify(error.message || 'API request failed', 'error');
    }
    throw error;
  }
}
