// A small cookie-keeping HTTP client for the scripts that drive a deployed app (gate1, judge:warm).
export class ScriptClient {
  private cookie = '';
  constructor(private readonly base: string) {}

  async call(
    method: string,
    path: string,
    body?: unknown | FormData,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const origin = new URL(this.base).origin;
    const isForm = body instanceof FormData;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        origin,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? null : isForm ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    const match = set ? /bl_session=([^;]+)/.exec(set) : null;
    if (match) this.cookie = `bl_session=${match[1]}`;
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json };
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
