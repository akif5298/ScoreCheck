/**
 * The upload dropzone.
 *
 * Its whole job is to hand files to the session and move on. The navigation is conditional on
 * files actually being accepted — hopping to the review workspace with an empty batch bounces
 * straight back (that route redirects when there is nothing to review), which reads as the
 * drop having been ignored for no reason.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { navigate, addFiles } = vi.hoisted(() => ({
  navigate: vi.fn(),
  addFiles: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  useNavigate: () => navigate,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/contexts/upload-session", () => ({
  useUploadSession: () => ({ addFiles }),
}));

import { Route } from "@/routes/upload.index";

const UploadDropzone = (Route as unknown as { component: () => ReactNode }).component;

function png(name = "IMG_0001.png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function dropzone() {
  return screen.getByRole("button", { name: /Drop screenshots or click to browse/ });
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  navigate.mockReset();
  addFiles.mockReset().mockReturnValue(1);
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Upload box scores — ScoreCheck" });
  });
});

describe("the dropzone", () => {
  it("explains what to drop and what happens next", () => {
    render(<UploadDropzone />);

    expect(screen.getByText("Drop screenshots or click to browse")).toBeInTheDocument();
    expect(screen.getByText(/PNG or JPEG · select several at once/)).toBeInTheDocument();
  });

  it("names the pipeline stages so the wait is legible", () => {
    render(<UploadDropzone />);

    expect(screen.getByText("Junk filter")).toBeInTheDocument();
    expect(screen.getByText("Fine-tuned VLM")).toBeInTheDocument();
    expect(screen.getByText("Basketball validation")).toBeInTheDocument();
  });

  it("opens the hidden file picker when clicked", async () => {
    const { container } = render(<UploadDropzone />);
    const click = vi.spyOn(fileInput(container), "click");

    await userEvent.click(dropzone());

    expect(click).toHaveBeenCalled();
  });

  it("accepts only the image types the server allows, several at a time", () => {
    const { container } = render(<UploadDropzone />);

    expect(fileInput(container)).toHaveAttribute("accept", "image/png,image/jpeg");
    expect(fileInput(container)).toHaveAttribute("multiple");
  });
});

describe("choosing files", () => {
  it("adds them to the batch and moves to the review workspace", async () => {
    const { container } = render(<UploadDropzone />);

    await userEvent.upload(fileInput(container), png());

    expect(addFiles).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/upload/review" });
  });

  it("stays put when nothing was accepted", async () => {
    addFiles.mockReturnValue(0);
    const { container } = render(<UploadDropzone />);

    await userEvent.upload(
      fileInput(container),
      new File(["x"], "notes.pdf", { type: "application/pdf" }),
    );

    // The review route redirects back here on an empty batch, so navigating would look like
    // the drop was silently discarded.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clears the input so the same file can be picked again", async () => {
    const { container } = render(<UploadDropzone />);
    const input = fileInput(container);

    await userEvent.upload(input, png());

    // A file input does not fire change for an identical selection; without the reset, a
    // retry after "Start over" silently does nothing.
    expect(input.value).toBe("");
  });
});

describe("dragging files in", () => {
  it("takes the dropped files", () => {
    render(<UploadDropzone />);

    fireEvent.drop(dropzone(), { dataTransfer: { files: [png()] } });

    expect(addFiles).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/upload/review" });
  });

  it("highlights while a drag is over it", () => {
    render(<UploadDropzone />);
    const zone = dropzone();

    fireEvent.dragOver(zone);

    expect(zone.className).toContain("border-foreground");
  });

  it("drops the highlight when the drag leaves", () => {
    render(<UploadDropzone />);
    const zone = dropzone();
    fireEvent.dragOver(zone);

    fireEvent.dragLeave(zone);

    expect(zone.className).not.toContain("bg-secondary/60");
  });

  it("drops the highlight after a drop", () => {
    render(<UploadDropzone />);
    const zone = dropzone();
    fireEvent.dragOver(zone);

    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });

    // Otherwise the zone stays lit after navigating back to it.
    expect(zone.className).not.toContain("bg-secondary/60");
  });

  it("prevents the browser from opening the dropped file", () => {
    render(<UploadDropzone />);
    const zone = dropzone();

    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    fireEvent(zone, dragOver);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [png()] } });
    fireEvent(zone, drop);

    // Without preventDefault the browser navigates away to render the image itself.
    expect(dragOver.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });
});
