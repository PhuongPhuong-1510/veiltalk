ALTER TABLE users
    ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'system',
    ADD CONSTRAINT chk_users_theme CHECK (theme IN ('dark', 'light', 'system'));
