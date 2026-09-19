import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Global tokens and base styles load before any component CSS.
import "@/app/styles/index.css";
import App from "@/app/App.jsx";
import { SessionProvider } from "@/entities/session/model/SessionProvider.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
