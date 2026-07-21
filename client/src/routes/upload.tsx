import { createFileRoute, Outlet } from "@tanstack/react-router";
import { UploadSessionProvider } from "@/contexts/upload-session";

// Layout route for the upload flow. Stays mounted across its children (/upload
// dropzone and /upload/review workspace), so the UploadSessionProvider it hosts
// keeps one batch's files and in-flight extractions alive across the hop between them.
export const Route = createFileRoute("/upload")({
  component: UploadLayout,
});

function UploadLayout() {
  return (
    <UploadSessionProvider>
      <Outlet />
    </UploadSessionProvider>
  );
}
