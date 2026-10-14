import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignerStudio } from "./features/studio/DesignerStudio";
import { connectFrameHost } from "./host/bootstrap";

const host = connectFrameHost();
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <DesignerStudio host={host} />
  </StrictMode>,
);
