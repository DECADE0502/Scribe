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
      navigate(`/books/${b.id}/onboard`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [navigate]);

  const handleDelete = useCallback(async (b: BookSummary) => {
    const sure = window.confirm(`${t.library.deleteConfirm}\n\n${t.library.deleteWarning}`);
    if (!sure) return;
    try {
      await api.deleteBook(b.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reload]);

  return (
    <main data-testid="page-library" style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>{t.library.title}</h1>
        <span style={{ display: "flex", gap: 8 }}>
          <button data-testid="btn-settings" onClick={() => navigate("/settings")}>{t.settings.title}</button>
          <button data-testid="btn-new-book" onClick={handleNew}>{t.library.newBook}</button>
        </span>
      </header>
      {loading && <p data-testid="library-loading">{t.app.loading}</p>}
      {error && <p data-testid="library-error" role="alert" style={{ color: "#c00" }}>{error}</p>}
      {!loading && books.length === 0 && (
        <p data-testid="library-empty">{t.library.emptyHint}</p>
      )}
      {books.length > 0 && (
        <ul data-testid="library-list" style={{ listStyle: "none", padding: 0 }}>
          {books.map(b => (
            <BookCard key={b.id} book={b} onDelete={() => handleDelete(b)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function BookCard(props: { book: BookSummary; onDelete: () => void }) {
  const { book, onDelete } = props;
  const navigate = useNavigate();
  const updated = new Date(book.updatedAt).toLocaleString("zh-CN");
  return (
    <li data-testid={`book-card-${book.id}`}
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
      <div>
        <h3 style={{ margin: 0 }}>{book.title}</h3>
        <p style={{ color: "#666", margin: "4px 0 0" }}>
          {book.genre ?? ""} · {t.library.lastUpdated} {updated} · {t.library.totalCost} ${book.totalCostUsd.toFixed(4)}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => navigate(`/books/${book.id}`)}>{t.library.open}</button>
        <button onClick={onDelete} style={{ color: "#c00" }}>{t.library.delete}</button>
      </div>
    </li>
  );
}
