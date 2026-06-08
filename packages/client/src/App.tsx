import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LibraryPage } from "./pages/library.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/books/:bookId/onboard" element={<OnboardPlaceholder />} />
        <Route path="/books/:bookId" element={<WorkspacePlaceholder />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

// 占位页(后续 Task 8.2-8.x 替换成真实组件)
function OnboardPlaceholder() {
  return <main style={{ padding: 24 }}><h1>新建书引导(待实现)</h1></main>;
}
function WorkspacePlaceholder() {
  return <main style={{ padding: 24 }}><h1>工作台(待实现)</h1></main>;
}
function NotFound() {
  return <main style={{ padding: 24 }}><h1>404</h1></main>;
}
