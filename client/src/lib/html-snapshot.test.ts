import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildSnapshotHtml, escapeHtml, snapshotFileName } from "./html-snapshot";

describe("snapshotFileName", () => {
  const takenAt = new Date("2026-11-25T12:00:00Z");

  test("slugs the project name and stamps the day", () => {
    assert.equal(snapshotFileName("RADuxtion", takenAt), "raduxtion-wrapped-snapshot-2026-11-25.html");
    assert.equal(snapshotFileName("  DaVinci On Iris! ", takenAt), "davinci-on-iris-wrapped-snapshot-2026-11-25.html");
  });

  test("falls back when the name has no usable characters", () => {
    assert.equal(snapshotFileName("***", takenAt), "project-wrapped-snapshot-2026-11-25.html");
  });
});

describe("escapeHtml", () => {
  test("escapes markup characters", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("buildSnapshotHtml", () => {
  const base = {
    projectName: "Team <Alpha>",
    takenAt: new Date("2026-11-25T12:00:00Z"),
    htmlAttributes: ' lang="en"',
    css: ".a{color:red}",
    externalStyleLinks: ['<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />'],
    bodyAttributes: "",
    bodyHtml: '<div data-testid="project-wrapped"><section data-testid="slide-intro">Hi</section></div>',
  };

  test("is a standalone document with the recap, styles and a not-live banner", () => {
    const html = buildSnapshotHtml(base);
    assert.ok(html.startsWith("<!DOCTYPE html>\n<html lang=\"en\">"));
    assert.ok(html.includes("<style>.a{color:red}</style>"));
    assert.ok(html.includes(base.externalStyleLinks[0]));
    assert.ok(html.includes(base.bodyHtml));
    assert.ok(html.includes("Static snapshot"));
    assert.ok(html.includes("Not live"));
    assert.ok(html.includes('content="2026-11-25T12:00:00.000Z"'));
  });

  test("escapes the project name in the title and banner", () => {
    const html = buildSnapshotHtml(base);
    assert.ok(html.includes("<title>Team &lt;Alpha&gt; · Project Wrapped (snapshot)</title>"));
    assert.ok(!html.includes("Team <Alpha>"));
  });

  test("inlined CSS cannot close its <style> element", () => {
    const html = buildSnapshotHtml({ ...base, css: "a{}</style><script>alert(1)</script>" });
    assert.ok(!html.includes("</style><script>alert(1)"));
  });

  test("fetches nothing: no external scripts", () => {
    const html = buildSnapshotHtml(base);
    assert.ok(!/<script[^>]+src=/i.test(html));
  });
});
