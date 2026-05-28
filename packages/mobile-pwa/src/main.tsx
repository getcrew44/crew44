import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MobileClientProvider } from "@/client/MobileClientProvider";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileClientProvider>
      <App />
    </MobileClientProvider>
  </React.StrictMode>
);
