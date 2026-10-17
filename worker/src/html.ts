/**
 * A small HTML parser for reading ja.is pages.
 *
 * Workers have no DOM. HTMLRewriter parses natively, but every element and text
 * chunk it hands to JavaScript costs tens of microseconds, which put a ja.is
 * page with many branches over the free plan's 10 ms CPU budget. Tokenizing
 * the page in JavaScript with one regex is several times cheaper.
 *
 * The tree is built the way BeautifulSoup's "html.parser" builder (used by the
 * Python version) builds it: no implied end tags, void elements never take
 * children, and an end tag closes the nearest open element of that name or is
 * ignored when there is none.
 */

export interface Node {
  tag: string;
  attrs: Map<string, string>;
  children: (Node | string)[];
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

// Their content is raw text, not markup.
const RAW_TEXT_TAGS = new Set(["script", "style"]);

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

// Comments, doctypes and processing instructions | tags | text | a stray "<".
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>?|<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
const ATTR = /([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return attrs;
}

export function parseHtml(html: string): Node {
  const root: Node = { tag: "#document", attrs: new Map(), children: [] };
  const stack: Node[] = [root];
  const token = new RegExp(TOKEN);

  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    const [text, closing, rawName, attrSource] = m;
    const parent = stack[stack.length - 1];
    if (!rawName) {
      // Text or a stray "<"; comments and doctypes start with "<" too and are dropped.
      if (text[0] !== "<" || text === "<") parent.children.push(decodeEntities(text));
      continue;
    }

    const tag = rawName.toLowerCase();
    if (closing) {
      const idx = stack.findLastIndex((n) => n.tag === tag);
      if (idx > 0) stack.length = idx;
      continue;
    }

    const node: Node = { tag, attrs: parseAttrs(attrSource), children: [] };
    parent.children.push(node);
    if (VOID_TAGS.has(tag) || attrSource.trimEnd().endsWith("/")) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      const end = html.slice(token.lastIndex).search(new RegExp(`</${tag}`, "i"));
      const stop = end < 0 ? html.length : token.lastIndex + end;
      node.children.push(html.slice(token.lastIndex, stop));
      token.lastIndex = stop;
      continue;
    }
    stack.push(node);
  }
  return root;
}

export function textOf(node: Node): string {
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

export function hasClass(node: Node, name: string): boolean {
  return (node.attrs.get("class") ?? "").split(/\s+/).includes(name);
}

/** Descendants matching `match`, in document order. */
export function findAll(node: Node, match: (n: Node) => boolean): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (const child of n.children) {
      if (typeof child === "string") continue;
      if (match(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export function find(node: Node, match: (n: Node) => boolean): Node | null {
  return findAll(node, match)[0] ?? null;
}

export const byTag = (...tags: string[]) => (n: Node) => tags.includes(n.tag);
export const byClass = (...names: string[]) => (n: Node) => names.some((name) => hasClass(n, name));
