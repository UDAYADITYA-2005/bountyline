import {
  ClaimResponse,
  EvidenceMeta,
  ListQuery,
  MyClaimsResponse,
  ProgramResponse,
  ProgramsResponse,
  StartClaimBody,
} from '@bountyline/contracts';
import { DomainError } from '@bountyline/core';
import { MAX_UPLOAD_BYTES } from '@bountyline/checks';
import { getPhoto } from '@bountyline/db';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Services } from '../services.js';
import { programSummary } from '../views.js';
import { streamClaim } from './sse.js';

const IdParams = z.object({ id: z.string().min(1).max(64) });
// Per-user limits run after auth and key on the user, so a fresh login doesn't reset the bucket.
const userKey = (req: FastifyRequest) => req.user?.id ?? req.ip;

export const claimRoutes: FastifyPluginAsyncZod<Services> = async (app, s) => {
  app.get(
    '/programs',
    {
      config: { auth: 'public' },
      schema: { tags: ['programs'], response: { 200: ProgramsResponse } },
    },
    async () => ({
      programs: [...s.deps.programs.values()].map((e) => programSummary(e.program)),
    }),
  );

  app.get(
    '/programs/:id',
    {
      config: { auth: 'public' },
      schema: { tags: ['programs'], params: IdParams, response: { 200: ProgramResponse } },
    },
    async (req) => ({ program: programSummary(s.claims.program(req.params.id).program) }),
  );

  app.post(
    '/claims',
    {
      config: {
        auth: 'claimant',
        rateLimit: { max: 10, timeWindow: '1 hour', hook: 'preHandler', keyGenerator: userKey },
      },
      schema: {
        tags: ['claims'],
        body: StartClaimBody,
        headers: z.object({ 'idempotency-key': z.string().max(128).optional() }).passthrough(),
        response: { 201: ClaimResponse },
      },
    },
    async (req, reply) => {
      const claim = await s.claims.start(requireUser(req), req.body, {
        idempotencyKey: req.headers['idempotency-key'],
      });
      return reply.status(201).send({ claim: await s.claims.view(claim, false) });
    },
  );

  app.post(
    '/claims/:id/evidence',
    {
      config: {
        auth: 'claimant',
        rateLimit: { max: 20, timeWindow: '1 hour', hook: 'preHandler', keyGenerator: userKey },
      },
      schema: {
        tags: ['claims'],
        params: IdParams,
        consumes: ['multipart/form-data'],
        response: { 202: ClaimResponse },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      let photo: Buffer | null = null;
      let metaRaw: string | null = null;
      for await (const part of req.parts({
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
      })) {
        if (part.type === 'file' && part.fieldname === 'photo') {
          photo = await part.toBuffer();
          if (part.file.truncated)
            throw new DomainError('PHOTO_INVALID', 'The photo is over 8 MB.');
        } else if (part.type === 'field' && part.fieldname === 'meta') {
          metaRaw = String(part.value);
        }
      }
      if (!photo)
        throw new DomainError('VALIDATION_FAILED', 'Attach the photo as the "photo" field.');
      let meta;
      try {
        meta = EvidenceMeta.parse(JSON.parse(metaRaw ?? 'null'));
      } catch {
        throw new DomainError(
          'VALIDATION_FAILED',
          'The "meta" field must be JSON with lat, lng, accuracyM and capturedAt.',
        );
      }
      const claim = await s.claims.submitEvidence(user, req.params.id, photo, meta);
      return reply.status(202).send({ claim: await s.claims.view(claim, false) });
    },
  );

  app.get(
    '/claims/:id',
    {
      config: { auth: 'any' },
      schema: { tags: ['claims'], params: IdParams, response: { 200: ClaimResponse } },
    },
    async (req) => {
      const user = requireUser(req);
      const claim = await s.claims.getVisible(user, req.params.id);
      return { claim: await s.claims.view(claim, user.role === 'manager') };
    },
  );

  app.get(
    '/claims/:id/stream',
    { config: { auth: 'any' }, schema: { tags: ['claims'], params: IdParams } },
    async (req, reply) => {
      const user = requireUser(req);
      await s.claims.getVisible(user, req.params.id);
      streamClaim(req, reply, s, req.params.id, user.role === 'manager');
    },
  );

  app.get(
    '/me/claims',
    {
      config: { auth: 'claimant' },
      schema: { tags: ['claims'], querystring: ListQuery, response: { 200: MyClaimsResponse } },
    },
    async (req) => s.claims.listMine(requireUser(req), req.query),
  );

  app.get(
    '/photos/:id',
    { config: { auth: 'any' }, schema: { tags: ['claims'], params: IdParams } },
    async (req, reply) => {
      const user = requireUser(req);
      const photo = await getPhoto(s.deps.db.db, req.params.id);
      if (!photo) throw new DomainError('PHOTO_NOT_FOUND', 'No such photo.');
      if (user.role !== 'manager') {
        // Owners only: the photo must belong to one of this user's claims.
        const mine = await s.claims.ownsPhoto(user.id, photo.id);
        if (!mine) throw new DomainError('PHOTO_NOT_FOUND', 'No such photo.');
      }
      return reply
        .header('Cache-Control', 'private, max-age=3600')
        .type('image/jpeg')
        .send(Buffer.from(photo.bytes));
    },
  );
};
