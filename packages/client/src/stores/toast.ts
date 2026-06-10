import { create } from "zustand";

export interface Toast {
  id: string;
  level: "info" | "warning" | "error";
  text: string;
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  toasts: Toast[];
  push(t: Omit<Toast, "id">): string;
  dismiss(id: string): void;
}

let seq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push(t) {
    const id = `t${++seq}`;
    set(s => ({ toasts: [...s.toasts, { ...t, id }] }));
    // info/warning 3 秒自动消失,error 常驻
    if (t.level !== "error") {
      setTimeout(() => {
        set(s => ({ toasts: s.toasts.filter(x => x.id !== id) }));
      }, 3000);
    }
    return id;
  },
  dismiss(id) {
    set(s => ({ toasts: s.toasts.filter(x => x.id !== id) }));
  },
}));
