-- ============================================================
-- VeilTalk Database Schema v1.0
-- Migration: V1__initial_schema.sql
-- ============================================================

-- Bật extension uuid-ossp nếu chưa có
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- USERS ----
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_discoverable BOOLEAN NOT NULL DEFAULT FALSE,
    -- is_discoverable = TRUE cho phép tìm thấy qua POST /users/search (FR-22)
    -- Mặc định FALSE — user phải chủ động bật trong Settings
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_discoverable_email ON users(email) WHERE deleted_at IS NULL AND is_discoverable = TRUE;
-- Index riêng cho tìm kiếm FR-22: chỉ index user đã bật discoverable
-- Khi tìm kiếm: WHERE email = $1 AND is_discoverable = TRUE AND deleted_at IS NULL
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- ---- AVATAR PROFILES ----
CREATE TABLE avatar_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    model_id VARCHAR(100) NOT NULL,
    model_url VARCHAR(500) NOT NULL,
    customizations JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_avatar_user_id ON avatar_profiles(user_id);
-- idx_avatar_model_url dđã bị xóa: truy vấn avatar luôn dùng
-- WHERE user_id = $1, không phải WHERE model_url = $1

-- ---- CONVERSATIONS ----
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES users(id),
    user_b_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_conv_diff_users CHECK (user_a_id <> user_b_id)
);

-- Đảm bảo mỗi cặp (A,B) chỉ có đúng một conversation
-- LEAST/GREATEST chuẩn hóa thứ tự UUID để (A,B) = (B,A)
CREATE UNIQUE INDEX idx_conv_pair ON conversations(
    LEAST(user_a_id::text, user_b_id::text),
    GREATEST(user_a_id::text, user_b_id::text)
);
CREATE INDEX idx_conv_user_a ON conversations(user_a_id, updated_at DESC);
CREATE INDEX idx_conv_user_b ON conversations(user_b_id, updated_at DESC);

-- ---- MESSAGES ----
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    -- id = idempotency key sinh phía client (NFR-24)
    -- backend INSERT ... ON CONFLICT (id) DO NOTHING để dedup
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')),
    client_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_conv_time ON messages(conversation_id, client_timestamp ASC) WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_sender ON messages(sender_id, created_at DESC);

-- ---- VIDEOS ----
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    duration_secs INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'recording' CHECK (status IN ('recording','processing','ready','failed')),
    -- recording: phiên quay đang diễn ra (chunked upload)
    -- processing: finalize đã gọi, chờ MinIO webhook
    -- ready: MinIO webhook nhận, video phát được
    -- failed: lỗi upload hoặc webhook timeout
    format VARCHAR(10) NOT NULL DEFAULT 'mp4',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_videos_user_created ON videos(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_user_size ON videos(user_id, file_size_bytes) WHERE deleted_at IS NULL;

-- ---- REFRESH TOKENS ----
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent VARCHAR(500)
);

CREATE UNIQUE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id, revoked_at) WHERE revoked_at IS NULL;
-- Lưu ý: không dùng expires_at > NOW() trong predicate vì NOW() là
-- non-immutable function, PostgreSQL không cho phép trong partial index.
-- Lọc expires_at thực hiện trong query: WHERE ... AND expires_at > NOW()

-- ---- AUTO-UPDATE updated_at TRIGGER ----
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_avatar_updated_at BEFORE UPDATE ON avatar_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_videos_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
