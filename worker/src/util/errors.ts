export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class Unauthorized extends ApiError {
  // The argument doubles as the error *code* now (same convention as NotFound/
  // Forbidden), so routes can throw `new Unauthorized("invalid_credentials")`
  // and the SPA receives `{error:"invalid_credentials"}`. A bare `new
  // Unauthorized()` still returns `unauthorized`, so existing callers keep
  // working.
  constructor(code = "unauthorized", message = code) {
    super(401, code, message);
    this.name = "Unauthorized";
  }
}

export class Forbidden extends ApiError {
  constructor(code = "forbidden", message = code) {
    super(403, code, message);
    this.name = "Forbidden";
  }
}

export class BadRequest extends ApiError {
  constructor(code = "bad_request") {
    super(400, code, code);
    this.name = "BadRequest";
  }
}

export class NotFound extends ApiError {
  // The caller's specific code (`kid_not_found`, `page_not_found`, …) *is* the
  // code: the SPA maps codes to child-friendly copy, so collapsing them all to a
  // bare "not_found" would hand every screen the same unhelpful sentence.
  constructor(code = "not_found") {
    super(404, code, code);
    this.name = "NotFound";
  }
}

export class BudgetExceeded extends ApiError {
  readonly provider: string;
  readonly remainingUsd: number;

  constructor(provider: string, remainingUsd: number) {
    super(402, "budget_exceeded", "budget_exceeded", { provider, remaining_usd: remainingUsd });
    this.name = "BudgetExceeded";
    this.provider = provider;
    this.remainingUsd = remainingUsd;
  }
}

export class KillSwitchOn extends ApiError {
  constructor() {
    super(402, "kill_switch", "kill_switch");
    this.name = "KillSwitchOn";
  }
}

export class ProviderDisabled extends ApiError {
  constructor(provider: string) {
    super(503, "provider_disabled", "provider_disabled", { provider });
    this.name = "ProviderDisabled";
  }
}

export class RateLimited extends ApiError {
  readonly scope: string;

  constructor(scope: string) {
    super(429, "rate_limited", "rate_limited", { scope });
    this.name = "RateLimited";
    this.scope = scope;
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.code, ...(err.details ?? {}) }, { status: err.status });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
