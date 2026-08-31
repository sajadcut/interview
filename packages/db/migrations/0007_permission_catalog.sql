INSERT INTO permissions (key, description) VALUES
  ('organization.read', 'Read organization data'),
  ('organization.manage', 'Manage organization settings and membership'),
  ('job.read', 'Read jobs'),
  ('job.create', 'Create jobs'),
  ('job.edit', 'Edit jobs'),
  ('candidate.read', 'Read candidate data'),
  ('candidate.contact', 'Contact candidates'),
  ('candidate.move_stage', 'Move candidates between pipeline stages'),
  ('candidate.score', 'Review or submit candidate scoring'),
  ('interview.read', 'Read interviews and evidence'),
  ('interview.manage', 'Manage interviews'),
  ('decision.submit', 'Submit hiring decisions'),
  ('integration.manage', 'Manage integrations'),
  ('audit.read', 'Read audit events')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;
