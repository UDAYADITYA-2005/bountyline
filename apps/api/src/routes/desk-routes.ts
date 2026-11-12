import {
  ClaimDetailResponse,
  ClaimResponse,
  DeskAuditBody,
  DeskClaimsQuery,
  DeskClaimsResponse,
  DeskDataResponse,
  DeskDecisionBody,
  DeskTable,
  PoolQuery,
  PoolResponse,
} from '@bountyline/contracts';
import { DomainError } from '@bountyline/core';
import { getClaim } from '@bountyline/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Services } from '../services.js';
import { deskRows } from '../services/desk-data.js';

const IdParams = z.object({ id: z.string().min(1).max(64) });

export const deskRoutes: FastifyPluginAsyncZod<Services> = async (app, s) => {
  const manager = { auth: 'manager' as const };

  app.get(
    '/desk/claims',
    {
      config: manager,
      schema: {
        tags: ['desk'],
        querystring: DeskClaimsQuery,
        response: { 200: DeskClaimsResponse },
      },
    },
    async (req) => {
      const claims = await s.desk.list(req.query);
      const last = claims.at(-1);
      return {
        claims: await Promise.all(claims.map((c) => s.claims.view(c, true))),
        ...(claims.length === req.query.limit && last ? { nextCursor: last.id } : {}),
      };
    },
  );

  app.get(
    '/desk/claims/:id',
    {
      config: manager,
      schema: { tags: ['desk'], params: IdParams, response: { 200: ClaimDetailResponse } },
    },
    async (req) => {
      const claim = await getClaim(s.deps.db.db, req.params.id);
      if (!claim) throw new DomainError('CLAIM_NOT_FOUND', 'No such claim.');
      return { claim: await s.claims.view(claim, true), history: await s.desk.history(claim.id) };
    },
  );

  app.post(
    '/desk/claims/:id/decision',
    {
      config: manager,
      schema: {
        tags: ['desk'],
        params: IdParams,
        body: DeskDecisionBody,
        response: { 200: ClaimResponse },
      },
    },
    async (req) => {
      const claim = await s.desk.decide(requireUser(req), req.params.id, req.body);
      return { claim: await s.claims.view(claim, true) };
    },
  );

  app.post(
    '/desk/claims/:id/audit',
    {
      config: manager,
      schema: {
        tags: ['desk'],
        params: IdParams,
        body: DeskAuditBody,
        response: { 200: ClaimResponse },
      },
    },
    async (req) => {
      const claim = await s.desk.audit(requireUser(req), req.params.id, req.body);
      return { claim: await s.claims.view(claim, true) };
    },
  );

  app.get(
    '/desk/pool',
    {
      config: manager,
      schema: { tags: ['desk'], querystring: PoolQuery, response: { 200: PoolResponse } },
    },
    async (req) => ({
      pools: await s.desk.pools(req.query.programId),
    }),
  );

  app.get(
    '/desk/data/:table',
    {
      config: manager,
      schema: {
        tags: ['desk'],
        params: z.object({ table: DeskTable }),
        response: { 200: DeskDataResponse },
      },
    },
    async (req) => ({ data: await deskRows(s.deps.db.db, s.deps.programs, req.params.table) }),
  );
};
