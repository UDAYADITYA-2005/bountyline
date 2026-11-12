import { Problem } from '@bountyline/contracts';
import type { z } from 'zod';

export const API_BASE = '/api/v1';

/** An error response from the API, parsed from problem+json when possible. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;

  constructor(status: number, code: string, title: string, detail: string) {
    super(detail || title);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.title = title;
  }

  get isOffline(): boolean {
    return this.code === 'NETWORK';
  }
}

/** Builds an ApiError from a failed response body. */
export function problemFromBody(status: number, body: unknown): ApiError {
  const parsed = Problem.safeParse(body);
  if (parsed.success) {
    return new ApiError(status, parsed.data.code, parsed.data.title, parsed.data.detail);
  }
  return new ApiError(
    status,
    status === 401 ? 'UNAUTHENTICATED' : 'UNKNOWN',
    'Request failed',
    `HTTP ${status}`,
  );
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** Calls the API and parses the JSON response with a contract schema. */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  const res = await rawRequest(path, options);
  const body = await readJson(res);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      res.status,
      'CONTRACT',
      'Unexpected response',
      'The server sent data in an unexpected shape.',
    );
  }
  return parsed.data;
}

/** Calls the API when no response body is expected (204). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await rawRequest(path, options);
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(path.startsWith('/api') ? path : `${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(
      0,
      'NETWORK',
      'Offline',
      'Could not reach Bountyline. Check your connection.',
    );
  }
  if (!res.ok) throw problemFromBody(res.status, await readJson(res));
  return res;
}

/** Uploads multipart form data with progress, which fetch can't report. */
export function uploadWithProgress<S extends z.ZodType>(
  path: string,
  form: FormData,
  schema: S,
  onProgress: (fraction: number) => void,
): Promise<z.infer<S>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          0,
          'NETWORK',
          'Offline',
          'The upload failed. Check your connection and try again.',
        ),
      );
    xhr.onload = () => {
      let body: unknown;
      try {
        body = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(problemFromBody(xhr.status, body));
        return;
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        reject(
          new ApiError(
            xhr.status,
            'CONTRACT',
            'Unexpected response',
            'The server sent data in an unexpected shape.',
          ),
        );
        return;
      }
      onProgress(1);
      resolve(parsed.data);
    };
    xhr.send(form);
  });
}

/** A plain message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
