import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LibraryPage } from "./pages/library.js";
import { WorkspacePage } from "./pages/workspace.js";
import { UsageDetailPage } from "./pages/usage-detail.js";
import { ToastContainer } from "./components/toast.js";

export function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/books/:bookId/onboard" element={<OnboardPlaceholder />} />
        <Route path="/books/:bookId/usage" element={<UsageDetailPage />} />
        <Route path="/books/:bookId" element={<WorkspacePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

// 占位页(Task 7.1 onboard 编排器存在,但前端 UI 待 Task 8.3 之后接入)
function OnboardPlaceholder() {
  return <main style={{ padding: 24 }}><h1>新建书引导(待实现)</h1></main>;
}
function NotFound() {
  return <main style={{ padding: 24 }}><h1>404</h1></main>;
}

