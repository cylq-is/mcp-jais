import { describe, expect, it } from "vitest";
import { byTag, find, findAll, parseHtml, textOf } from "../src/html";

describe("parseHtml", () => {
  it("treats script and style content as text", () => {
    const doc = parseHtml(`<script>if (a < b) document.write("<h1>no</h1>")</script><style>p>a{}</style><h1>yes</h1>`);
    expect(findAll(doc, byTag("h1")).map(textOf)).toEqual(["yes"]);
  });

  it("reads quoted attributes containing > and decodes entities", () => {
    const doc = parseHtml(`<a title="x > y" href='/a?b=1&amp;c=2' data-on>Jón &amp; Gunna&#x27;s</a>`);
    const a = find(doc, byTag("a"))!;
    expect(a.attrs.get("title")).toBe("x > y");
    expect(a.attrs.get("href")).toBe("/a?b=1&c=2");
    expect(a.attrs.get("data-on")).toBe("");
    expect(textOf(a)).toBe("Jón & Gunna's");
  });

  it("does not nest into void, self-closing or stray end tags", () => {
    const doc = parseHtml(`<div><br><svg><path d="m"/></svg><img src=x>text</span></div><p>after</p><!-- <h1>c</h1> -->`);
    const div = find(doc, byTag("div"))!;
    expect(div.children.map((c) => (typeof c === "string" ? c : c.tag))).toEqual(["br", "svg", "img", "text"]);
    expect(find(doc, byTag("p"))!.children).toEqual(["after"]);
    expect(find(doc, byTag("h1"))).toBeNull();
  });
});
