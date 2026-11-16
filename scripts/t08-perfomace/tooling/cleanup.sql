\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE perf_cleanup_users ON COMMIT DROP AS
SELECT id
FROM users
WHERE email LIKE format('perf+%s+%%@example.test', :'run_id');

CREATE TEMP TABLE perf_cleanup_conversations ON COMMIT DROP AS
SELECT id
FROM conversations
WHERE user_a_id IN (SELECT id FROM perf_cleanup_users)
   OR user_b_id IN (SELECT id FROM perf_cleanup_users);

DELETE FROM messages WHERE conversation_id IN (SELECT id FROM perf_cleanup_conversations);
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM perf_cleanup_users);
DELETE FROM avatar_profiles WHERE user_id IN (SELECT id FROM perf_cleanup_users);
DELETE FROM video_cleanup_jobs
WHERE video_id IN (SELECT id FROM videos WHERE user_id IN (SELECT id FROM perf_cleanup_users));
DELETE FROM videos WHERE user_id IN (SELECT id FROM perf_cleanup_users);
DELETE FROM conversations WHERE id IN (SELECT id FROM perf_cleanup_conversations);
DELETE FROM users WHERE id IN (SELECT id FROM perf_cleanup_users);
DELETE FROM perf_seed_runs WHERE run_id = :'run_id';

COMMIT;

ANALYZE users;
ANALYZE avatar_profiles;
ANALYZE conversations;
ANALYZE messages;
ANALYZE videos;
