export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  has_avatar?: boolean;
  created_at: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserSettings {
  discoverable: boolean;
  email_notifications: boolean;
  theme: "dark" | "light" | "system";
}

export interface AvatarModel {
  id: string;
  name: string;
  thumbnail_url: string;
  model_url: string;
  supported_customizations: string[];
  outfit_options: string[];
}

export interface AvatarProfile {
  id: string;
  user_id: string;
  model_id: string;
  model_url: string;
  customizations: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface ConversationSummary {
  id: string;
  other_user: { id: string; display_name: string; avatar_url: string | null };
  last_message: {
    content: string;
    sender_id: string;
    client_timestamp: string;
    status: "sent" | "delivered" | "read";
  } | null;
  created_at?: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id?: string;
  sender_id: string;
  content: string;
  status: "sent" | "delivered" | "read";
  client_timestamp: string;
  created_at: string;
}

export type VideoStatus = "recording" | "processing" | "ready" | "failed";

export interface VideoSummary {
  id: string;
  title: string;
  status: VideoStatus;
  duration_secs: number | null;
  file_size_bytes: number;
  format: string;
  created_at: string;
}

export interface VideoDetail extends VideoSummary {
  view_url: string | null;
  updated_at: string;
}

export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}
