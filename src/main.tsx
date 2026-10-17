import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { App } from "@/app/App";
import { startServices } from "@/app/services";
import { TooltipProvider } from "@/components/ui/tooltip";
import { startTheme } from "@/features/settings/preferences";
import { runSelfCheck } from "@/features/selfcheck/selfcheck";
import "../design/globals.css";

// Before the first paint, so a light theme never flashes dark.
const stopTheme = startTheme();
const stopServices = startServices();
import.meta.hot?.dispose(() => {
  stopTheme();
  stopServices();
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
);

// Only when the harness asks for it: prove the desktop build end to end.
void runSelfCheck().catch(() => undefined);
