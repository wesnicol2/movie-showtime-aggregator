import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Foundation() {
  return (
    <main>
      <h1>Movie Showtimes</h1>
      <p>React frontend foundation is ready for the parity migration.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("React root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <Foundation />
  </StrictMode>,
);
