export type OrganizationUserAction =
  | 'INVITE'
  | 'ASSIGN_ROLE'
  | 'DISABLE'
  | 'REMOVE';

export interface OrganizationUserCommand {
  organizationId: string;
  actorId: string;
  targetUserId?: string;
  action: OrganizationUserAction;
}
