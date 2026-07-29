/**
 * The fallback error page.
 *
 * It is served precisely when the app is broken, so it must not depend on the app: no
 * bundle, no stylesheet, no font, no image. The server's CSP is `default-src 'self'` with
 * script hashes for the shell only, so any external reference here would be blocked and any
 * inline <script> would be refused — leaving a blank page in place of the error page.
 */
import { describe, it, expect } from "vitest";
import { renderErrorPage } from "@/lib/error-page";

const html = renderErrorPage();

describe("renderErrorPage", () => {
  it("is a complete document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("declares a charset and a viewport", () => {
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain("width=device-width");
  });

  it("says what happened in plain language", () => {
    expect(html).toContain("This page didn't load");
  });

  it("offers a way back", () => {
    expect(html).toContain("location.reload()");
    expect(html).toContain('href="/"');
  });

  it("references nothing external", () => {
    // A CDN font or stylesheet is blocked by default-src 'self', so the page would render
    // unstyled at best — on the one screen a user sees when everything else has failed.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<img\b/);
  });

  it("carries no <script> block", () => {
    // The CSP allows inline scripts only by hash, and those hashes are computed from the
    // client shell — not from this page. An inline <script> here would simply be refused.
    expect(html).not.toMatch(/<script\b/);
  });

  it("styles itself inline", () => {
    expect(html).toContain("<style>");
  });

  it("is deterministic", () => {
    // No timestamp or request id: the response is identical every time, so it can be
    // cached or diffed without noise.
    expect(renderErrorPage()).toBe(html);
  });
});
