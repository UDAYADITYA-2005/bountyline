import type { ErrorCode } from '@bountyline/contracts';
import { DomainError } from '@bountyline/core';
import { PhotoRejected } from '@bountyline/checks';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const STATUS: Record<ErrorCode, number> = {
  CLAIM_NOT_FOUND: 404,
  PROGRAM_NOT_FOUND: 404,
  PHOTO_NOT_FOUND: 404,
  SCENARIO_NOT_FOUND: 404,
  NOT_FOUND: 404,
  JUDGE_MODE_OFF: 404,
  CODE_EXPIRED: 409,
  INVALID_STATE: 409,
  EMAIL_TAKEN: 409,
  FORBIDDEN: 403,
  NOT_ELIGIBLE: 403,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 400,
  PHOTO_INVALID: 422,
  INTERNAL: 500,
};

const TITLES: Partial<Record<ErrorCode, string>> = {
  CLAIM_NOT_FOUND: 'Claim not found',
  INVALID_STATE: 'That action is not possible in the claim’s current state',
  FORBIDDEN: 'Not allowed',
  UNAUTHENTICATED: 'Please sign in',
  RATE_LIMITED: 'Too many requests',
  VALIDATION_FAILED: 'The request is not valid',
  JUDGE_MODE_OFF: 'Judge mode is off',
  PHOTO_INVALID: 'The photo could not be used',
};

/** An RFC 9457 problem body. */
export function problem(code: ErrorCode, detail: string, status = STATUS[code]) {
  return {
    type: `https://bountyline.dev/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: TITLES[code] ?? code.replace(/_/g, ' ').toLowerCase(),
    status,
    detail,
    code,
  };
}

/** The one error handler: domain codes to problem+json, unknown errors to a bare 500. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    let body;
    if (err instanceof DomainError) {
      body = problem(err.code, err.message);
    } else if (err instanceof PhotoRejected) {
      body = problem('PHOTO_INVALID', err.message);
    } else if (hasZodFastifySchemaValidationErrors(err)) {
      const detail = err.validation
        .map((v) => `${v.instancePath || '(body)'} ${v.message ?? ''}`.trim())
        .join('; ');
      body = problem('VALIDATION_FAILED', detail.slice(0, 500));
    } else if (err.statusCode === 429) {
      body = problem('RATE_LIMITED', 'Slow down and try again shortly.');
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      body = problem('VALIDATION_FAILED', err.message.slice(0, 300), err.statusCode);
    } else {
      // No raw error object: database errors embed query params (emails, payloads) in the message.
      const cause = err.cause instanceof Error ? err.cause.message.slice(0, 200) : undefined;
      req.log.error({ errName: err.name, errCode: err.code, cause }, 'unhandled error');
      body = problem('INTERNAL', 'Something went wrong on our side.');
    }
    void reply.status(body.status).type('application/problem+json').send(body);
  });
  app.setNotFoundHandler((req, reply) => {
    void reply
      .status(404)
      .type('application/problem+json')
      .send(problem('NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}`));
  });
}
