-- A failed upload can leave a multipart before the video row commits.
-- Such cleanup jobs have no durable video row to reference.
ALTER TABLE video_cleanup_jobs ALTER COLUMN video_id DROP NOT NULL;
