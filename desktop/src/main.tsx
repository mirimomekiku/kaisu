import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/work-sans/wght.css";
import App from "./App";
import AppRecovery from "./components/AppRecovery";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppRecovery><App /></AppRecovery>
  </React.StrictMode>,
);
