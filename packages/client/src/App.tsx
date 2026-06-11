import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LibraryPage } from "./pages/library.js";
import { WorkspacePage } from "./pages/workspace.js";
import { UsageDetailPage } from "./pages/usage-detail.js";
import { SettingsPage } from "./pages/settings.js";
import { OnboardPage } from "./pages/onboard.js";
import { ToastContainer } from "./components/toast.js";

export function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/books/:bookId/onboard" element={<OnboardPage />} />
        <Route path="/books/:bookId/usage" element={<UsageDetailPage />} />
        <Route path="/books/:bookId" element={<WorkspacePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return <main style={{ padding: 24 }}><h1>404</h1></main>;
}

