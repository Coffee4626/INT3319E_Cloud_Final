import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./Studio";
import { completeSignIn } from "./api";

async function main() {
  let error = "";
  if (location.pathname === "/auth/callback") {
    try {
      await completeSignIn();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App authError={error} />
    </React.StrictMode>,
  );
}
void main();
