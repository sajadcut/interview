CREATE UNIQUE INDEX IF NOT EXISTS memberships_id_org_uq ON memberships(id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS roles_id_org_uq ON roles(id, organization_id);

ALTER TABLE membership_roles ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE membership_roles mr
SET organization_id = m.organization_id
FROM memberships m
WHERE mr.membership_id = m.id AND mr.organization_id IS NULL;

ALTER TABLE membership_roles ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS membership_roles_org_idx ON membership_roles(organization_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_roles_membership_org_fk') THEN
    ALTER TABLE membership_roles
      ADD CONSTRAINT membership_roles_membership_org_fk
      FOREIGN KEY (membership_id, organization_id)
      REFERENCES memberships(id, organization_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_roles_role_org_fk') THEN
    ALTER TABLE membership_roles
      ADD CONSTRAINT membership_roles_role_org_fk
      FOREIGN KEY (role_id, organization_id)
      REFERENCES roles(id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS files_storage_key_uq ON files(storage_key);
