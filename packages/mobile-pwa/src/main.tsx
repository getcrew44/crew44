import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MobileClientProvider } from "@/client/MobileClientProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileClientProvider>
      <App />
    </MobileClientProvider>
  </React.StrictMode>
);
