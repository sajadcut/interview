import { TenantContextService } from "./tenant-context.service";

export abstract class TenantRepositoryBase {
  protected constructor(private readonly tenantContext: TenantContextService) {}

  protected get organizationId(): string {
    return this.tenantContext.require().organizationId;
  }

  protected scope<T extends { organizationId: string }>(row: T): T {
    if (row.organizationId !== this.organizationId) {
      throw new Error("Cross-tenant row access blocked");
    }
    return row;
  }
}
