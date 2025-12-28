export async function requestDecayReport(text: string): Promise<unknown> {
  const res = await fetch('/__api/decay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = (await res.json()) as unknown
  if (!res.ok) {
    const message =
      typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : 'Request failed'
    throw new Error(message)
  }
  return data
}
