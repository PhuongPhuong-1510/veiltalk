-- ============================================================
-- VeilTalk Database Schema v3.0
-- Migration: V3__video_cleanup_durability.sql
-- P2-T24: GET/PUT/DELETE /videos, cleanup dọn dẹp bền vững cho:
--   (1) abort recording khi xóa tài khoản (API 4.5, 7.5)
--   (2) orphan object timeout cleanup (P2-T22, VideoTimeoutCleanupJob)
-- ============================================================

-- upload_id được gieo vào Redis (video:upload:{videoId}) từ P2-T20 nhưng Redis có TTL và
-- có thể mất trước khi tài khoản bị xóa. Lưu thêm bản bền vững trong DB để cleanup khi xóa
-- tài khoản vẫn biết upload_id cần abort trên MinIO, không phụ thuộc Redis còn sống hay không.
-- NULL cho các row RECORDING tạo TRƯỚC migration này — chấp nhận cho MVP (xem VideoAccountCleanupService).
ALTER TABLE videos ADD COLUMN upload_id VARCHAR(255);

-- ---- VIDEO CLEANUP JOBS ----
-- Dùng chung cho mọi thao tác MinIO cần retry bền vững khi lần gọi đầu thất bại:
--   ABORT_MULTIPART: hủy phiên multipart còn dở (xóa tài khoản, TC-37)
--   REMOVE_OBJECT: xóa object mồ côi sai kích thước (VideoTimeoutCleanupJob, P2-T22)
CREATE TABLE video_cleanup_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id),
    storage_path VARCHAR(500) NOT NULL,
    upload_id VARCHAR(255),
    -- upload_id bắt buộc cho ABORT_MULTIPART, NULL cho REMOVE_OBJECT.
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('ABORT_MULTIPART', 'REMOVE_OBJECT')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FAILED_PERMANENT')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_video_cleanup_jobs_due ON video_cleanup_jobs(next_attempt_at)
    WHERE status = 'PENDING';

CREATE TRIGGER trg_video_cleanup_jobs_updated_at BEFORE UPDATE ON video_cleanup_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
