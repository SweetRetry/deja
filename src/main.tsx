import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTheme, readView } from "@/lib/settings";
import "../design/globals.css";

// Before the first paint, so a light theme never flashes dark.
applyTheme(readView().theme);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
);
