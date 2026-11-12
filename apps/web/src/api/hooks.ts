import {
  ClaimDetailResponse,
  ClaimResponse,
  DeskClaimsResponse,
  DeskDataResponse,
  HealthResponse,
  MyClaimsResponse,
  PoolResponse,
  ProgramsResponse,
  ScenariosResponse,
  UserResponse,
  type ClaimView,
  type DeskAuditBody,
  type DeskDecisionBody,
  type DeskTable,
  type LoginBody,
  type RegisterBody,
  type StartClaimBody,
} from '@bountyline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, apiVoid } from './client';

export const qk = {
  health: ['health'] as const,
  me: ['me'] as const,
  programs: ['programs'] as const,
  claim: (id: string) => ['claim', id] as const,
  myClaims: ['me', 'claims'] as const,
  scenarios: ['judge', 'scenarios'] as const,
  deskClaims: (status?: string) => ['desk', 'claims', status ?? 'all'] as const,
  deskClaim: (id: string) => ['desk', 'claim', id] as const,
  pool: ['desk', 'pool'] as const,
  deskData: (table: DeskTable) => ['desk', 'data', table] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => apiRequest('/api/health', HealthResponse),
  });
}

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return (await apiRequest('/auth/me', UserResponse)).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginBody) =>
      apiRequest('/auth/login', UserResponse, { method: 'POST', body }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterBody) =>
      apiRequest('/auth/register', UserResponse, { method: 'POST', body }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiVoid('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(qk.me, null);
      void qc.invalidateQueries();
    },
  });
}

export function useJudgeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (as: 'claimant' | 'manager') =>
      apiRequest('/judge/session', UserResponse, { method: 'POST', body: { as } }),
    onSuccess: (r) => {
      qc.removeQueries({ queryKey: ['desk'] });
      qc.removeQueries({ queryKey: qk.myClaims });
      qc.setQueryData(qk.me, r.user);
    },
  });
}

export function usePrograms() {
  return useQuery({
    queryKey: qk.programs,
    queryFn: async () => (await apiRequest('/programs', ProgramsResponse)).programs,
    staleTime: 5 * 60_000,
  });
}

export function useStartClaim() {
  return useMutation({
    mutationFn: (body: StartClaimBody) =>
      apiRequest('/claims', ClaimResponse, { method: 'POST', body }),
  });
}

export function useClaim(
  id: string,
  options: { refetchInterval?: (claim: ClaimView | undefined) => number | false } = {},
) {
  const interval = options.refetchInterval;
  return useQuery({
    queryKey: qk.claim(id),
    queryFn: async () =>
      (await apiRequest(`/claims/${encodeURIComponent(id)}`, ClaimResponse)).claim,
    refetchInterval: interval ? (q) => interval(q.state.data) : false,
  });
}

export function useMyClaims(enabled = true) {
  return useQuery({
    queryKey: qk.myClaims,
    queryFn: () => apiRequest('/me/claims?limit=50', MyClaimsResponse),
    enabled,
  });
}

export function useScenarios() {
  return useQuery({
    queryKey: qk.scenarios,
    queryFn: async () => (await apiRequest('/judge/scenarios', ScenariosResponse)).scenarios,
    retry: false,
  });
}

export function useRunScenario() {
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/judge/scenarios/${encodeURIComponent(id)}/run`, ClaimResponse, {
        method: 'POST',
      }),
  });
}

export function useDeskClaims(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}&limit=100` : '?limit=100';
  return useQuery({
    queryKey: qk.deskClaims(status),
    queryFn: () => apiRequest(`/desk/claims${query}`, DeskClaimsResponse),
    refetchInterval: 15_000,
  });
}

export function useDeskClaim(id: string | null) {
  return useQuery({
    queryKey: qk.deskClaim(id ?? ''),
    queryFn: () => apiRequest(`/desk/claims/${encodeURIComponent(id ?? '')}`, ClaimDetailResponse),
    enabled: id !== null && id !== '',
    refetchInterval: 5_000,
  });
}

export function usePool() {
  return useQuery({
    queryKey: qk.pool,
    queryFn: async () => (await apiRequest('/desk/pool', PoolResponse)).pools,
    refetchInterval: 15_000,
  });
}

/** Fetches flat desk rows for AG Studio; used outside React by the data sources too. */
export async function fetchDeskData(table: DeskTable) {
  return (await apiRequest(`/desk/data/${table}`, DeskDataResponse)).data;
}

export function useDeskDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeskDecisionBody }) =>
      apiRequest(`/desk/claims/${encodeURIComponent(id)}/decision`, ClaimResponse, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['desk'] }),
  });
}

export function useDeskAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeskAuditBody }) =>
      apiRequest(`/desk/claims/${encodeURIComponent(id)}/audit`, ClaimResponse, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['desk'] }),
  });
}
