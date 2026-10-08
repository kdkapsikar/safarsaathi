export interface HealthResponse {
  status: 'ok';
  service: string;
  time: string;
  uptimeSeconds: number;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', { signal });
  if (!res.ok) throw new Error(`Health check failed (HTTP ${res.status})`);
  return (await res.json()) as HealthResponse;
}
