import {
  ArrowLeft, CircleUserRound, Film, LoaderCircle, MessageCircle,
  Pencil, Play, RotateCcw, Search, Trash2, Video, WifiOff, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { kokoroLogo } from "../../assets";
import { videosApi } from "../../lib/api";
import type { VideoDetail, VideoStatus, VideoSummary } from "../../lib/api/types";
import { useAuthStore } from "../../lib/store/authStore";
import { resolveMediaUrl } from "../../lib/api/client";
import "./videoLibrary.css";

const statusLabels: Record<VideoStatus, string> = {
  recording: "Đang quay", processing: "Đang xử lý", ready: "Sẵn sàng", failed: "Lỗi",
};
const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const formatDuration = (seconds: number | null) => {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

function VideoNavigation({ mobile = false }: { mobile?: boolean }) {
  const navigate = useNavigate();
  const items = [
    { label: "Trò chuyện", icon: MessageCircle, path: "/home" },
    { label: "Video", icon: Film, path: "/videos", active: true },
    { label: "Tài khoản", icon: CircleUserRound, path: "/profile" },
  ];
  return <nav className={mobile ? "video-bottom-nav" : "video-side-nav"} aria-label="Điều hướng chính">
    {items.map(({ label, icon: Icon, path, active }) => <button key={path} type="button"
      className={active ? "active" : ""} aria-current={active ? "page" : undefined}
      onClick={() => navigate(path)}><Icon /><span>{label}</span></button>)}
  </nav>;
}

function UserAvatar() {
  const user = useAuthStore((state) => state.user);
  const [failed, setFailed] = useState(false);
  return <span className="video-user-avatar" aria-hidden="true">
    {user?.avatar_url && !failed
      ? <img src={resolveMediaUrl(user.avatar_url) ?? undefined} alt="" onError={() => setFailed(true)} />
      : <span>{user?.display_name?.trim().charAt(0).toUpperCase() || "K"}</span>}
  </span>;
}

export default function VideoLibraryScreen() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [storage, setStorage] = useState({ used: 0, limit: 0 });
  const [status, setStatus] = useState<VideoStatus | "">("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<VideoDetail | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async (next?: string) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const response = await videosApi.listVideos({ cursor: next, limit: 20, status: status || undefined });
      if (version !== requestVersion.current) return;
      setVideos((current) => next
        ? [...current, ...response.data.filter((item) => !current.some((old) => old.id === item.id))]
        : response.data);
      setCursor(response.next_cursor);
      setHasMore(response.has_more);
      setStorage({ used: response.storage_used_bytes, limit: response.storage_limit_bytes });
    } catch { if (version === requestVersion.current) setError("Không thể tải thư viện video."); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [status]);

  useEffect(() => {
    setVideos([]);
    setCursor(null);
    setHasMore(false);
    setSelectedId(null);
    setSelectedDetail(null);
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  const visibleVideos = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    if (!normalized) return videos;
    return videos.filter((video) => video.title.toLocaleLowerCase("vi").includes(normalized));
  }, [query, videos]);
  const selectedVideo = videos.find((video) => video.id === selectedId) ?? null;
  const storagePercent = storage.limit > 0 ? Math.min(100, (storage.used / storage.limit) * 100) : 0;
  const storageFull = storage.limit > 0 && storage.used >= storage.limit;

  useEffect(() => {
    if (!query.trim() || !hasMore || !cursor || loading) return;
    void load(cursor);
  }, [cursor, hasMore, load, loading, query]);

  async function selectVideo(video: VideoSummary) {
    setSelectedId(video.id);
    setSelectedDetail(null);
    setError("");
    if (video.status !== "ready") return;
    setBusyId(video.id);
    try {
      const detail = await videosApi.getVideo(video.id);
      setSelectedDetail(detail);
    } catch { setError("Video chưa thể phát. Vui lòng thử lại."); }
    finally { setBusyId(null); }
  }

  async function rename(video: VideoSummary) {
    const title = window.prompt("Tên video mới", video.title)?.trim();
    if (!title || title === video.title) return;
    setBusyId(video.id);
    setError("");
    try {
      const updated = await videosApi.renameVideo(video.id, title);
      setVideos((current) => current.map((item) => item.id === video.id ? updated : item));
      if (selectedDetail?.id === video.id) setSelectedDetail(updated);
    } catch { setError("Không thể đổi tên video."); }
    finally { setBusyId(null); }
  }

  async function remove(video: VideoSummary) {
    if (!window.confirm(`Xóa video “${video.title}”?`)) return;
    setBusyId(video.id);
    setError("");
    try {
      await videosApi.deleteVideo(video.id);
      setVideos((current) => current.filter((item) => item.id !== video.id));
      if (selectedId === video.id) { setSelectedId(null); setSelectedDetail(null); }
    } catch { setError("Không thể xóa video."); }
    finally { setBusyId(null); }
  }

  return <main className={`dark video-library-shell ${selectedVideo ? "has-selected-video" : ""}`}>
    <aside className="video-sidebar">
      <button className="video-brand" type="button" onClick={() => navigate("/home")} aria-label="Kokoro - Trang chủ"><img src={kokoroLogo} alt="" /></button>
      <VideoNavigation />
      <button className="video-profile" type="button" onClick={() => navigate("/profile")} aria-label="Mở tài khoản"><UserAvatar /></button>
    </aside>

    <section className="video-list-column" aria-label="Thư viện video">
      <header className="video-library-heading">
        <div><span>KOKORO</span><h1>Video</h1></div>
        <button type="button" disabled={storageFull} title={storageFull ? "Dung lượng lưu trữ đã đầy" : undefined} onClick={() => navigate("/videos/record")}><Video /><span>{storageFull ? "Đã đầy" : "Quay video"}</span></button>
      </header>
      <label className="video-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm video…" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm"><X /></button>}</label>
      <div className="video-toolbar">
        <strong>{query ? <>Kết quả tìm kiếm <span>· {visibleVideos.length}</span></> : "Video của bạn"}</strong>
        <select value={status} onChange={(event) => setStatus(event.target.value as VideoStatus | "")} aria-label="Lọc trạng thái video">
          <option value="">Tất cả ({videos.length})</option>
          {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>

      {error && !selectedVideo && <div className="video-list-error" role="alert"><WifiOff /><p>{error}</p><button type="button" onClick={() => void load()}><RotateCcw /> Thử lại</button></div>}
      {loading && videos.length === 0 && <div className="video-list-loading"><LoaderCircle /> Đang tải video…</div>}
      {!loading && !error && visibleVideos.length === 0 && <div className="video-list-empty"><Film /><strong>{query ? "Không tìm thấy video" : "Chưa có video nào"}</strong><span>{query ? "Thử tìm bằng một tên khác." : "Quay video avatar đầu tiên của bạn."}</span></div>}

      <div className="video-grid">
        {visibleVideos.map((video, index) => <button type="button" className={`video-card ${selectedId === video.id ? "active" : ""}`} key={video.id} onClick={() => void selectVideo(video)}>
          <span className={`video-card-visual tone-${index % 4}`}>
            {selectedId === video.id && selectedDetail?.view_url
              ? <video src={selectedDetail.view_url} muted preload="metadata" />
              : <Film />}
            <span className="video-duration"><Play /> {formatDuration(video.duration_secs)}</span>
            {busyId === video.id && <span className="video-card-loading"><LoaderCircle /></span>}
          </span>
          <span className="video-card-copy"><strong>{video.title}</strong><small>{statusLabels[video.status]} · {new Date(video.created_at).toLocaleDateString("vi-VN")}</small></span>
        </button>)}
      </div>
      {hasMore && <button className="video-load-more" type="button" disabled={loading || !cursor} onClick={() => cursor && void load(cursor)}>{loading ? "Đang tải…" : "Tải thêm video"}</button>}
      <footer className="video-storage"><span><span style={{ width: `${storagePercent}%` }} /></span><small>{formatBytes(storage.used)} / {formatBytes(storage.limit)} đã dùng</small></footer>
    </section>

    <section className="video-preview-column">
      {!selectedVideo ? <div className="video-empty-preview"><span>{query ? <Search /> : <Video />}</span><h2>{query ? "Tìm video" : "Chọn một video"}</h2><p>{query ? "Chọn một video trong kết quả để xem lại." : "Xem lại video đã quay hoặc quay video mới."}</p></div> : <>
        <header className="video-preview-header">
          <button className="video-preview-back" type="button" onClick={() => { setSelectedId(null); setSelectedDetail(null); }} aria-label="Quay lại thư viện"><ArrowLeft /></button>
          <div><span>ĐANG XEM</span><h2>{selectedVideo.title}</h2></div>
          <div className="video-preview-actions">
            <button type="button" disabled={busyId === selectedVideo.id} onClick={() => void rename(selectedVideo)} aria-label="Đổi tên"><Pencil /></button>
            <button type="button" disabled={busyId === selectedVideo.id} onClick={() => void remove(selectedVideo)} aria-label="Xóa video"><Trash2 /></button>
          </div>
        </header>
        <div className="video-player-wrap">
          {busyId === selectedVideo.id && <div className="video-player-state"><LoaderCircle /> Đang chuẩn bị video…</div>}
          {!busyId && selectedVideo.status !== "ready" && <div className={`video-player-state state-${selectedVideo.status}`}><Film /><strong>{statusLabels[selectedVideo.status]}</strong><span>{selectedVideo.status === "recording" ? "Bản quay chưa hoàn tất. Bạn có thể quay tiếp khi mở lại màn quay." : selectedVideo.status === "failed" ? "Video xử lý thất bại. Bạn có thể xóa video này và thử quay lại." : "Video đang được xử lý. Hãy làm mới thư viện sau ít phút."}</span>{selectedVideo.status === "recording" && <button type="button" onClick={() => navigate(`/videos/record?resume=${encodeURIComponent(selectedVideo.id)}`)}>Tiếp tục bản quay</button>}{selectedVideo.status === "processing" && <button type="button" onClick={() => void load()}>Làm mới trạng thái</button>}{selectedVideo.status === "failed" && <button type="button" onClick={() => void remove(selectedVideo)}><Trash2 /> Xóa video lỗi</button>}</div>}
          {!busyId && selectedVideo.status === "ready" && selectedDetail?.view_url && <video controls autoPlay src={selectedDetail.view_url} />}
          {!busyId && selectedVideo.status === "ready" && !selectedDetail?.view_url && <div className="video-player-state"><WifiOff /><span>{error || "Không tìm thấy đường dẫn phát video."}</span><button type="button" onClick={() => void selectVideo(selectedVideo)}><RotateCcw /> Thử lại</button></div>}
        </div>
        <div className="video-meta">
          <div><span>Thời lượng</span><strong>{formatDuration(selectedVideo.duration_secs)}</strong></div>
          <div><span>Dung lượng</span><strong>{formatBytes(selectedVideo.file_size_bytes)}</strong></div>
          <div><span>Định dạng</span><strong>{selectedVideo.format.toUpperCase()}</strong></div>
          <div><span>Ngày tạo</span><strong>{new Date(selectedVideo.created_at).toLocaleDateString("vi-VN")}</strong></div>
        </div>
      </>}
    </section>
    <VideoNavigation mobile />
  </main>;
}
