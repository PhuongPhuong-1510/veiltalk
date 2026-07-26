import { request } from "../client";
import type { Paginated, VideoDetail, VideoStatus, VideoSummary } from "../types";

export function listVideos(params?: { cursor?: string; limit?: number; status?: VideoStatus }) {
  return request<Paginated<VideoSummary> & { storage_used_bytes: number; storage_limit_bytes: number }>(
    "/videos",
    { query: params },
  );
}

export function startRecording(fields: {
  title: string;
  estimated_size_bytes: number;
  chunk_size_bytes: number;
  format?: string;
}) {
  return request<{
    id: string;
    title: string;
    status: VideoStatus;
    upload_id: string;
    first_chunk_url: string;
    part_number: number;
    created_at: string;
  }>("/videos", { method: "POST", body: fields });
}

export function getVideo(id: string) {
  return request<VideoDetail>(`/videos/${id}`);
}

export function renameVideo(id: string, title: string) {
  return request<VideoDetail>(`/videos/${id}`, { method: "PUT", body: { title } });
}

export function deleteVideo(id: string) {
  return request<void>(`/videos/${id}`, { method: "DELETE" });
}

export function getNextChunkUrl(
  videoId: string,
  fields: { upload_id: string; part_number: number; etag_previous: string },
) {
  return request<{ chunk_url: string; part_number: number; expires_in: number }>(
    `/videos/${videoId}/chunks`,
    { method: "POST", body: fields },
  );
}

export function finalizeVideo(
  videoId: string,
  fields: { upload_id: string; parts: { part_number: number; etag: string }[]; duration_secs: number },
) {
  return request<{ id: string; status: VideoStatus; message: string }>(`/videos/${videoId}/finalize`, {
    method: "POST",
    body: fields,
  });
}

export function abortRecording(videoId: string, uploadId: string) {
  return request<void>(`/videos/${videoId}/abort`, {
    method: "POST",
    body: { upload_id: uploadId },
  });
}
