/**
 * RFC 7807 `application/problem+json` contract returned by the Spring Boot 4
 * `GlobalExceptionHandler`, plus normalizer helpers.
 *
 * Shape delta the browser must handle during the FastAPI -> Java strangler cutover:
 *   Java (RFC7807):  { type, title, status, detail: string, code?, payload?, errors? }
 *   FastAPI (legacy): { detail: string }  OR  { detail: { code, quota|..., message } }
 *
 * The helpers below tolerate BOTH shapes so the SPA works while traffic is split
 * across the two backends (weighted VirtualService bake). See plan §8.2/§8.3/§8.9.
 */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  instance?: string;
  /** Human-readable message (a string under RFC7807). */
  detail?: string;
  /** Machine-readable code (top-level under RFC7807; was FastAPI `detail.code`). */
  code?: string;
  /** Structured data (top-level under RFC7807; was FastAPI `detail.quota` etc.). */
  payload?: unknown;
  /** Field validation errors: { field: message }. */
  errors?: Record<string, string>;
}

interface HttpErrorLike {
  error?: unknown;
  status?: number;
  statusText?: string;
  message?: string;
}

/** Extracts a human-readable message from any error shape (RFC7807 or FastAPI). */
export function problemMessage(err: unknown): string {
  const e = (err ?? {}) as HttpErrorLike;
  const p = e.error;

  if (p && typeof p === 'object') {
    const pd = p as ProblemDetail & { message?: string; detail?: unknown };

    // RFC7807 validation errors: join the field messages.
    if (pd.errors && typeof pd.errors === 'object') {
      const values = Object.values(pd.errors).filter(Boolean);
      if (values.length) return values.join('; ');
    }

    // Legacy FastAPI: `detail` may itself be an object { message, code, ... }.
    if (pd.detail && typeof pd.detail === 'object') {
      const d = pd.detail as { message?: string; detail?: string };
      return d.message ?? d.detail ?? pd.title ?? fallback(e);
    }

    // RFC7807 (Java): `detail` is a human string. Also handle ErrorEvent.message.
    return (
      (typeof pd.detail === 'string' ? pd.detail : undefined) ??
      pd.title ??
      pd.message ??
      fallback(e)
    );
  }

  // `error` is a plain string body.
  if (typeof p === 'string' && p.trim()) return p;

  return e.message ?? fallback(e);
}

/** Extracts the machine code (RFC7807 top-level `code`, or legacy `detail.code`). */
export function problemCode(err: unknown): string | undefined {
  const p = (err as HttpErrorLike)?.error;
  if (p && typeof p === 'object') {
    const pd = p as ProblemDetail & { detail?: unknown };
    if (typeof pd.code === 'string') return pd.code;
    if (pd.detail && typeof pd.detail === 'object') {
      const code = (pd.detail as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return undefined;
}

/** Extracts structured data (RFC7807 top-level `payload`, or legacy `detail.quota`). */
export function problemPayload<T = unknown>(err: unknown): T | undefined {
  const p = (err as HttpErrorLike)?.error;
  if (p && typeof p === 'object') {
    const pd = p as ProblemDetail & { detail?: unknown };
    if (pd.payload !== undefined) return pd.payload as T;
    if (pd.detail && typeof pd.detail === 'object') {
      const legacy = pd.detail as { quota?: unknown; payload?: unknown };
      return (legacy.quota ?? legacy.payload) as T | undefined;
    }
  }
  return undefined;
}

function fallback(e: HttpErrorLike): string {
  return `Error ${e.status ?? ''}: ${e.statusText ?? 'Unknown error'}`.trim();
}
