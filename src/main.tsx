import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignerStudio } from "./features/studio/DesignerStudio";
import { connectFrameHost } from "./host/bootstrap";

const host = connectFrameHost();
// Hosted Cadence frames mount `#cadence-screen-root`; native daemon and local
// Vite dev mount `#root`. Fall back to creating a container so mount never throws #299.
const container =
  document.getElementById("cadence-screen-root") ??
  document.getElementById("root") ??
  document.body.appendChild(Object.assign(document.createElement("div"), { id: "cadence-screen-root" }));

createRoot(container).render(
  <StrictMode>
    <DesignerStudio host={host} />
  </StrictMode>,
);
