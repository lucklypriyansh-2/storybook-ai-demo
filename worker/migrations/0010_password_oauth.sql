-- Email+password and Google OAuth signup.
--
-- Pre-existing `users` rows came from invite-only signup. The new columns are
-- nullable so those rows keep working (`auth_kind` defaults to 'invite'), and
-- `invite_code` becomes optional so email/password and Google users do not need
-- a fake one.
--
-- `password_hash` stores PBKDF2(SHA-256) output as `algo$iterations$saltB64$hashB64`.
-- `google_sub` is the Google-issued subject id (unique per account); nullable so
-- email+password users do not have one.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN auth_kind TEXT NOT NULL DEFAULT 'invite';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
