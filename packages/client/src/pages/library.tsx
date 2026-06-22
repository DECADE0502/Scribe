import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { api, type BookSummary } from "../api/client.js";

export function LibraryPage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listBooks();
      setBooks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleNew = useCallback(async () => {
    try {
      const b = await api.createBook({ title: t.library.untitled });
      navigate(`/books/${b.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [navigate]);

  const handleDelete = useCallback(async (b: BookSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    const sure = window.confirm(`${t.library.deleteConfirm}\n\n${t.library.deleteWarning}`);
    if (!sure) return;
    try {
      await api.deleteBook(b.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [reload]);

  return (
    <main data-testid="page-library" style={{ padding: "32px 24px", maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <h1 className="large-title">{t.library.title}</h1>
        <span style={{ display: "flex", gap: 8 }}>
          <button data-testid="btn-settings" onClick={() => navigate("/settings")}>
            {t.settings.title}
          </button>
          <button className="ios-btn-primary" data-testid="btn-new-book" onClick={handleNew}>
            + {t.library.newBook}
          </button>
        </span>
      </header>
      {loading && <p data-testid="library-loading" className="muted">{t.app.loading}</p>}
      {error && <p data-testid="library-error" role="alert" style={{ color: "var(--ios-red)" }}>{error}</p>}
      {!loading && books.length === 0 && (
        <div data-testid="library-empty" className="ios-card fade-up" style={{ padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 44, margin: "0 0 8px" }}>📚</p>
          <p className="muted">{t.library.emptyHint}</p>
        </div>
      )}
      {books.length > 0 && (
        <div
          data-testid="library-list"
          className="fade-up"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {books.map(b => (
            <article
              key={b.id}
              data-testid={`book-card-${b.id}`}
              className="book-card"
              onClick={() => navigate(`/books/${b.id}`)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3 style={{ margin: 0, fontSize: 17, letterSpacing: "-0.2px" }}>{b.title}</h3>
                {b.genre && (
                  <span
                    style={{
                      fontSize: 11, color: "var(--ios-blue)",
                      background: "rgba(0,122,255,0.1)", borderRadius: 999, padding: "2px 10px",
                      flexShrink: 0,
                    }}
                  >
                    {b.genre}
                  </span>
                )}
              </div>
              <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
                {t.library.lastUpdated} {new Date(b.updatedAt).toLocaleString("zh-CN")}
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {t.library.totalCost} ${b.totalCostUsd.toFixed(4)}
                </span>
                <button
                  className="ios-btn-small ios-btn-danger"
                  onClick={(e) => void handleDelete(b, e)}
                >
                  {t.library.delete}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
