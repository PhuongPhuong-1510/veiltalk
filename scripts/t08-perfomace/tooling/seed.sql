\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS perf_seed_runs (
    run_id VARCHAR(64) PRIMARY KEY,
    user_count INTEGER NOT NULL,
    conversation_count INTEGER NOT NULL,
    messages_per_conversation INTEGER NOT NULL,
    video_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

BEGIN;

INSERT INTO perf_seed_runs (
    run_id, user_count, conversation_count, messages_per_conversation, video_count
) VALUES (
    :'run_id', :user_count, :conversation_count, :messages_per_conversation, :video_count
);

WITH password_template AS MATERIALIZED (
    SELECT crypt(:'load_password', gen_salt('bf', 10)) AS password_hash
)
INSERT INTO users (
    email,
    password_hash,
    display_name,
    role,
    is_discoverable,
    email_notifications,
    theme,
    created_at,
    updated_at
)
SELECT
    format('perf+%s+%s@example.test', :'run_id', lpad(series_number::text, 9, '0')),
    password_template.password_hash,
    format('Perf user %s %s', :'run_id', series_number),
    'user',
    TRUE,
    FALSE,
    CASE series_number % 3 WHEN 0 THEN 'dark' WHEN 1 THEN 'light' ELSE 'system' END,
    NOW() - ((series_number % 31536000)::text || ' seconds')::INTERVAL,
    NOW()
FROM generate_series(1, :user_count) AS series_number
CROSS JOIN password_template;

INSERT INTO avatar_profiles (
    user_id,
    model_id,
    model_url,
    customizations,
    created_at,
    updated_at
)
SELECT
    id,
    CASE row_number() OVER (ORDER BY email) % 3
        WHEN 0 THEN 'avatar_model_01'
        WHEN 1 THEN 'avatar_model_02'
        ELSE 'avatar_model_03'
    END,
    '/models/avatars/reference-avatar-2.vrm',
    jsonb_build_object('perf_run_id', :'run_id'),
    created_at,
    updated_at
FROM users
WHERE email LIKE format('perf+%s+%%@example.test', :'run_id');

WITH run_users AS MATERIALIZED (
    SELECT id, row_number() OVER (ORDER BY email) AS position
    FROM users
    WHERE email LIKE format('perf+%s+%%@example.test', :'run_id')
),
hub AS (
    SELECT id FROM run_users WHERE position = 1
),
peers AS (
    SELECT id, position
    FROM run_users
    WHERE position BETWEEN 2 AND (:conversation_count + 1)
)
INSERT INTO conversations (
    user_a_id,
    user_b_id,
    created_at,
    updated_at
)
SELECT
    hub.id,
    peers.id,
    NOW() - ((peers.position % 7776000)::text || ' seconds')::INTERVAL,
    NOW() - ((peers.position % 2592000)::text || ' seconds')::INTERVAL
FROM hub
CROSS JOIN peers;

WITH run_conversations AS MATERIALIZED (
    SELECT
        conversation.id,
        conversation.user_a_id,
        conversation.user_b_id,
        conversation.created_at,
        row_number() OVER (ORDER BY conversation.id) AS conversation_number
    FROM conversations AS conversation
    JOIN users AS first_user ON first_user.id = conversation.user_a_id
    JOIN users AS second_user ON second_user.id = conversation.user_b_id
    WHERE first_user.email LIKE format('perf+%s+%%@example.test', :'run_id')
      AND second_user.email LIKE format('perf+%s+%%@example.test', :'run_id')
)
INSERT INTO messages (
    id,
    conversation_id,
    sender_id,
    content,
    status,
    client_timestamp,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    conversation.id,
    CASE WHEN message_number % 2 = 0 THEN conversation.user_a_id ELSE conversation.user_b_id END,
    format('Perf message %s / conversation %s / message %s', :'run_id', conversation.conversation_number, message_number),
    CASE message_number % 3 WHEN 0 THEN 'read' WHEN 1 THEN 'sent' ELSE 'delivered' END,
    conversation.created_at + (message_number::text || ' seconds')::INTERVAL,
    conversation.created_at + (message_number::text || ' seconds')::INTERVAL,
    conversation.created_at + (message_number::text || ' seconds')::INTERVAL
FROM run_conversations AS conversation
CROSS JOIN generate_series(1, :messages_per_conversation) AS message_number;

WITH hub AS (
    SELECT id
    FROM users
    WHERE email = format('perf+%s+000000001@example.test', :'run_id')
)
INSERT INTO videos (
    user_id,
    title,
    storage_path,
    file_size_bytes,
    duration_secs,
    status,
    format,
    created_at,
    updated_at
)
SELECT
    hub.id,
    format('Perf video %s %s', :'run_id', video_number),
    format('perf/%s/video-%s.mp4', :'run_id', video_number),
    1048576 + video_number * 1024,
    30 + video_number % 300,
    CASE video_number % 3 WHEN 0 THEN 'ready' WHEN 1 THEN 'processing' ELSE 'failed' END,
    'mp4',
    NOW() - ((video_number % 31536000)::text || ' seconds')::INTERVAL,
    NOW()
FROM hub
CROSS JOIN generate_series(1, :video_count) AS video_number;

COMMIT;

ANALYZE users;
ANALYZE avatar_profiles;
ANALYZE conversations;
ANALYZE messages;
ANALYZE videos;

SELECT
    :'run_id' AS run_id,
    (SELECT count(*) FROM users WHERE email LIKE format('perf+%s+%%@example.test', :'run_id')) AS users,
    (SELECT count(*) FROM conversations AS c
        JOIN users AS a ON a.id = c.user_a_id
        WHERE a.email LIKE format('perf+%s+%%@example.test', :'run_id')) AS conversations,
    (SELECT count(*) FROM messages AS m
        JOIN conversations AS c ON c.id = m.conversation_id
        JOIN users AS a ON a.id = c.user_a_id
        WHERE a.email LIKE format('perf+%s+%%@example.test', :'run_id')) AS messages,
    (SELECT count(*) FROM videos AS v
        JOIN users AS u ON u.id = v.user_id
        WHERE u.email LIKE format('perf+%s+%%@example.test', :'run_id')) AS videos;
