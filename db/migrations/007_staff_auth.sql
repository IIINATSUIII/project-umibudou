-- 招待制スタッフ認証。パスワードと招待トークンは平文で保存しない。

CREATE TABLE IF NOT EXISTS staff_users (
  id text PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_users_status_role_idx
  ON staff_users (status, role);

CREATE TABLE IF NOT EXISTS staff_invitations (
  id text PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_invitations_email_active_idx
  ON staff_invitations (normalized_email, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_invitations_expiry_idx
  ON staff_invitations (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

