import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("根元素 #root 未找到");
createRoot(root).render(<App />);
