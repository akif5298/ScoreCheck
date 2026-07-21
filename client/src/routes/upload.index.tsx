import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { useUploadSession } from "@/contexts/upload-session";

export const Route = createFileRoute("/upload/")({
  head: () => ({
    meta: [
      { title: "Upload box scores — ScoreCheck" },
      {
        name: "description",
        content:
          "Drop several 2K26 screenshots, review each auto-extracted box score, and commit them to your league.",
      },
    ],
  }),
  component: UploadDropzone,
});

function UploadDropzone() {
  const { addFiles } = useUploadSession();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Add the files to the batch, then move to the review workspace where the images,
  // background extraction, and per-file confirm all live. The layout route keeps the
  // session mounted, so extraction that started here continues on the review page.
  const take = (files: FileList | File[] | null) => {
    const added = addFiles(files);
    if (inputRef.current) inputRef.current.value = "";
    if (added > 0) void navigate({ to: "/upload/review" });
  };

  return (
    <AppShell
      eyebrow="Workflow"
      title="Upload box scores"
      description="Drop one or more screenshots from your 2K26 post-game screens. Each extracts in the background — you'll review and confirm them on the next screen."
    >
      <Card>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            take(e.dataTransfer.files);
          }}
          className={`group grid w-full place-items-center gap-4 rounded-md border border-dashed p-16 transition-colors ${
            isDragging
              ? "border-foreground bg-secondary/60"
              : "border-border-strong bg-background hover:border-foreground hover:bg-secondary/40"
          }`}
        >
          <div className="grid h-12 w-12 place-items-center rounded-md border border-border bg-card font-display text-lg">
            ↑
          </div>
          <div className="text-center">
            <div className="font-display text-lg font-semibold">
              Drop screenshots or click to browse
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              PNG or JPEG · select several at once · each auto-extracts in ~12&nbsp;s
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            <Badge tone="outline">Junk filter</Badge>
            <Badge tone="outline">Fine-tuned VLM</Badge>
            <Badge tone="outline">Basketball validation</Badge>
          </div>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          multiple
          className="hidden"
          onChange={(e) => take(e.target.files)}
        />
      </Card>
    </AppShell>
  );
}
