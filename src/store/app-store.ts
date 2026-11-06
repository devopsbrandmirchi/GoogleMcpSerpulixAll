import { createFirestoreAppStore } from "@/store/firestore";
import { createMemoryAppStore } from "@/store/memory";
import type { AppStore } from "@/store/types";

let store: AppStore | undefined;

export function getAppStore(): AppStore {
  if (!store) {
    store =
      process.env.NODE_ENV === "test" || process.env.VITEST
        ? createMemoryAppStore()
        : createFirestoreAppStore();
  }
  return store;
}

export function setAppStore(next: AppStore): void {
  store = next;
}

export function resetAppStore(): void {
  store = undefined;
}
