ALTER TABLE avatar_profiles ADD COLUMN profile_revision UUID;
UPDATE avatar_profiles SET profile_revision = gen_random_uuid() WHERE profile_revision IS NULL;
ALTER TABLE avatar_profiles ALTER COLUMN profile_revision SET NOT NULL;

ALTER TABLE avatar_profiles
    ADD COLUMN portrait_object_key VARCHAR(500),
    ADD COLUMN portrait_version UUID,
    ADD COLUMN portrait_updated_at TIMESTAMPTZ,
    ADD COLUMN last_save_request_id UUID,
    ADD COLUMN last_save_payload_hash VARCHAR(64);

CREATE TABLE avatar_portrait_cleanup_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_key VARCHAR(500) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    last_error VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_avatar_portrait_cleanup_due
    ON avatar_portrait_cleanup_jobs(next_attempt_at);
