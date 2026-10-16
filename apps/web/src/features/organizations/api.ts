import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Organization, OrganizationDetail, Invitation, OrgMember, Team } from '@flygit/shared';
import { api } from '../../lib/api';

export interface OrgListResponse {
  items: Organization[];
  total: number;
}

function useInvalidateOrg(slug: string) {
  const qc = useQueryClient();
  return (keys: string[]) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: [key, slug] });
    void qc.invalidateQueries({ queryKey: ['organizations'] });
  };
}

export function useMyOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<OrgListResponse>('/organizations/mine'),
  });
}

export function useOrganization(slug: string) {
  return useQuery({
    queryKey: ['organization', slug],
    queryFn: () => api.get<OrganizationDetail>(`/organizations/${slug}`),
    enabled: Boolean(slug),
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug: string; description?: string | null }) =>
      api.post<OrganizationDetail>('/organizations', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

export function useOrgMembers(slug: string) {
  return useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.get<OrgMember[]>(`/organizations/${slug}/members`),
    enabled: Boolean(slug),
  });
}

export function useUpdateMemberRole(slug: string) {
  const invalidate = useInvalidateOrg(slug);
  return useMutation({
    mutationFn: ({ username, role }: { username: string; role: string }) =>
      api.patch(`/organizations/${slug}/members/${username}`, { role }),
    onSuccess: () => invalidate(['org-members']),
  });
}

export function useRemoveMember(slug: string) {
  const invalidate = useInvalidateOrg(slug);
  return useMutation({
    mutationFn: (username: string) => api.delete(`/organizations/${slug}/members/${username}`),
    onSuccess: () => invalidate(['org-members']),
  });
}

export function useOrgInvitations(slug: string) {
  return useQuery({
    queryKey: ['org-invitations', slug],
    queryFn: () => api.get<Invitation[]>(`/organizations/${slug}/invitations`),
    enabled: Boolean(slug),
  });
}

export function useInviteMember(slug: string) {
  const invalidate = useInvalidateOrg(slug);
  return useMutation({
    mutationFn: (input: { identifier: string; role: string }) =>
      api.post<Invitation>(`/organizations/${slug}/invitations`, input),
    onSuccess: () => invalidate(['org-invitations']),
  });
}

export function useRevokeInvitation(slug: string) {
  const invalidate = useInvalidateOrg(slug);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${slug}/invitations/${id}`),
    onSuccess: () => invalidate(['org-invitations']),
  });
}

export function useOrgTeams(slug: string) {
  return useQuery({
    queryKey: ['org-teams', slug],
    queryFn: () => api.get<Team[]>(`/organizations/${slug}/teams`),
    enabled: Boolean(slug),
  });
}

export function useCreateTeam(slug: string) {
  const invalidate = useInvalidateOrg(slug);
  return useMutation({
    mutationFn: (input: { name: string; slug: string; description?: string | null }) =>
      api.post<Team>(`/organizations/${slug}/teams`, input),
    onSuccess: () => invalidate(['org-teams']),
  });
}

export function useDeleteTeam(slug: string) {
  const invalidate = useInvalidateOrg(slug);
  return useMutation({
    mutationFn: (teamId: string) => api.delete(`/organizations/${slug}/teams/${teamId}`),
    onSuccess: () => invalidate(['org-teams']),
  });
}
