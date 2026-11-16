\set ON_ERROR_STOP on
\timing on

SELECT run_id, user_count, conversation_count, messages_per_conversation, video_count, created_at
FROM perf_seed_runs
WHERE run_id = :'run_id';

SELECT
    pg_size_pretty(pg_database_size(current_database())) AS database_size,
    (SELECT count(*) FROM users) AS total_users,
    (SELECT count(*) FROM conversations) AS total_conversations,
    (SELECT count(*) FROM messages) AS total_messages,
    (SELECT count(*) FROM videos) AS total_videos;

EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)
SELECT c.id, c.user_a_id, c.user_b_id, c.updated_at
FROM conversations AS c
JOIN users AS hub ON hub.id = c.user_a_id OR hub.id = c.user_b_id
WHERE hub.email = :'hub_email'
  AND hub.deleted_at IS NULL
  AND c.deleted_at IS NULL
ORDER BY c.updated_at DESC, c.id DESC
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)
SELECT m.id, m.sender_id, m.content, m.status, m.client_timestamp, m.created_at
FROM messages AS m
WHERE m.conversation_id = (
    SELECT c.id
    FROM conversations AS c
    JOIN users AS hub ON hub.id IN (c.user_a_id, c.user_b_id)
    WHERE hub.email = :'hub_email'
      AND hub.deleted_at IS NULL
    ORDER BY c.updated_at DESC
    LIMIT 1
)
  AND m.deleted_at IS NULL
ORDER BY m.client_timestamp DESC, m.id DESC
LIMIT 30;
