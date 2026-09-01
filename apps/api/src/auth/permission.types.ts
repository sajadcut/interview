export type PermissionContext = {
  userId: string;
  organizationId?: string;
  roles: string[];
};

export type PermissionCheck = {
  permission: string;
  context: PermissionContext;
};
