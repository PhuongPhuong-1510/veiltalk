ALTER TABLE users
    ADD COLUMN username VARCHAR(30),
    ADD COLUMN is_username_searchable BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT chk_users_username_format CHECK (
        username IS NULL OR (
            char_length(username) BETWEEN 3 AND 30
            AND username ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$'
            AND username !~ '(\.\.|__|\._|_\.)'
        )
    ),
    ADD CONSTRAINT chk_users_username_searchable_requires_username CHECK (
        NOT is_username_searchable OR username IS NOT NULL
    );

-- Bao gồm soft-deleted rows: username chỉ được giải phóng khi row bị hard-delete sau retention.
CREATE UNIQUE INDEX idx_users_username
    ON users (username)
    WHERE username IS NOT NULL;

-- varchar_pattern_ops bảo đảm LIKE 'prefix%' dùng được B-tree với non-C collation.
CREATE INDEX idx_users_searchable_username_prefix
    ON users (username varchar_pattern_ops)
    WHERE deleted_at IS NULL
      AND is_username_searchable = TRUE
      AND username IS NOT NULL;
