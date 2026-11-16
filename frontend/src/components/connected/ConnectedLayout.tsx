import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import "./connected.css";

export default function ConnectedLayout({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const navigate = useNavigate();
  return <main className="connected-page dark">
    <header className="connected-header">
      <button type="button" aria-label="Về trang chủ" onClick={() => navigate("/home")}><ArrowLeft /></button>
      <h1>{title}</h1>{action}
    </header>
    <div className="connected-content">{children}</div>
  </main>;
}
