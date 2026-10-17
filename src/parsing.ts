/** Turn ja.is responses into the API's models. */

import { byClass, byTag, find, findAll, hasClass, type Node, parseHtml, textOf } from "./html";
import type { Branch, BusinessHit, Entity, Location, OpeningHour, PersonHit, Section } from "./models";

/** Collapse whitespace; ja.is data has stray runs of spaces in names. */
export function clean(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.split(/\s+/).filter(Boolean).join(" ") || null;
}

export const personPath = (hashid: string) => `/people/${hashid}`;

export const businessPath = (clusterKey: string, hashid?: string | null) =>
  hashid ? `/businesses/${clusterKey}/${hashid}` : `/businesses/${clusterKey}`;

// --- search -----------------------------------------------------------------

// Shapes of the `/liveresult/` JSON, as far as this code reads it.
interface RawMeta {
  first_item?: number | null;
  last_item?: number | null;
  total_items?: number | null;
}

interface RawItem {
  hashid: string;
  cluster_key?: string;
  is_branch?: boolean;
  name?: string;
  occupation?: string;
  company_type?: string[];
  address?: string;
  postal_station?: string;
  logo_url?: string;
}

export interface RawSection {
  meta?: RawMeta;
  items?: RawItem[];
}

function sectionBounds(meta: RawMeta) {
  const total = meta.total_items || 0;
  const last = meta.last_item ?? null;
  return {
    total,
    first_item: meta.first_item ?? null,
    last_item: last,
    next_start: last && last < total ? last + 1 : null,
  };
}

export function parsePeople(section: RawSection): Section<PersonHit> {
  const items = (section.items ?? []).map((item) => ({
    id: item.hashid,
    name: clean(item.name) ?? "",
    occupation: clean(item.occupation),
    address: clean(item.address),
    postal_station: clean(item.postal_station),
    detail_path: personPath(item.hashid),
  }));
  return { ...sectionBounds(section.meta ?? {}), items };
}

export function parseBusinesses(section: RawSection): Section<BusinessHit> {
  const items = (section.items ?? []).map((item) => {
    const isBranch = Boolean(item.is_branch);
    const clusterKey = item.cluster_key ?? "";
    return {
      id: item.hashid,
      cluster_key: clusterKey,
      is_branch: isBranch,
      name: clean(item.name) ?? "",
      occupation: clean(item.occupation),
      company_types: item.company_type ?? [],
      address: clean(item.address),
      postal_station: clean(item.postal_station),
      logo_url: item.logo_url ?? null,
      // Mirrors the frontend: only branches are addressed by hashid.
      detail_path: businessPath(clusterKey, isBranch ? item.hashid : null),
    };
  });
  return { ...sectionBounds(section.meta ?? {}), items };
}

// --- detail pages -----------------------------------------------------------

const SOCIAL_LABEL = "samfélagsmiðlar";

function infoFields(info: Node | null): [string, Node[]][] {
  if (!info) return [];
  const fields: [string, Node[]][] = [];
  const items = findAll(info, (n) => n.tag === "li" && hasClass(n, "result-basic-info-list-item"));
  const datas = new Set(items.flatMap((li) => findAll(li, byClass("result-basic-info-list-item-data"))));
  for (const data of datas) {
    const heading = find(data, byTag("h3"));
    if (!heading) continue;
    fields.push([clean(textOf(heading)) ?? "", findAll(data, byTag("a", "p"))]);
  }
  return fields;
}

function location(el: Node | null): Location | null {
  if (!el) return null;
  const [lat, lon] = [el.attrs.get(":lat") ?? "", el.attrs.get(":lon") ?? ""].map((v) =>
    v.trim() === "" ? NaN : Number(v),
  );
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function openingHours(detail: Node | null): OpeningHour[] {
  if (!detail) return [];
  const hours: OpeningHour[] = [];
  for (const row of findAll(detail, (n) => n.tag === "tr" && hasClass(n, "opening-hour"))) {
    const cells = findAll(row, byTag("td"));
    if (cells.length < 2) continue;
    const daySpans = findAll(cells[0], byTag("span"));
    const timeSpans = findAll(cells[1], byTag("span"));
    const notes = [...daySpans.slice(1), ...timeSpans.slice(1)].map((s) => clean(textOf(s)));
    hours.push({
      day: daySpans.length ? (clean(textOf(daySpans[0])) ?? "") : "",
      hours: timeSpans.length ? (clean(textOf(timeSpans[0])) ?? "") : "",
      note: notes.filter(Boolean).join(" ") || null,
    });
  }
  return hours;
}

function openStatus(button: Node | null): string | null {
  if (!button) return null;
  return clean(findAll(button, byTag("span")).map(textOf).join(" "));
}

const BRANCH_HREF = /^\/([^/]+)\/([^/]+)\/$/;

function branches(doc: Node): Branch[] {
  const out: Branch[] = [];
  for (const link of findAll(doc, (n) => n.tag === "a" && hasClass(n, "list-item") && hasClass(n, "branch"))) {
    const match = BRANCH_HREF.exec(link.attrs.get("href") ?? "");
    if (!match) continue;
    const [, clusterKey, hashid] = match;
    const name = find(link, byClass("comany-result-name", "company-result-name"));
    const address = find(link, byClass("company-result-address"));
    const status = find(link, byClass("open-text"));
    const phoneSpans = new Set(
      findAll(link, byClass("other-registration-telephone"))
        .flatMap((list) => findAll(list, byTag("li")))
        .flatMap((li) => findAll(li, byTag("span"))),
    );
    out.push({
      id: hashid,
      name: name ? (clean(textOf(name)) ?? "") : "",
      address: address ? clean(textOf(address)) : null,
      phones: [...phoneSpans].map((s) => clean(textOf(s))).filter((p): p is string => p !== null),
      open_status: status ? clean(textOf(status)) : null,
      detail_path: businessPath(clusterKey, hashid),
    });
  }
  return out;
}

/** Remove the first descendant matching `match` from the tree and return it. */
function extract(node: Node, match: (n: Node) => boolean): Node | null {
  for (const [i, child] of node.children.entries()) {
    if (typeof child === "string") continue;
    if (match(child)) return node.children.splice(i, 1)[0] as Node;
    const found = extract(child, match);
    if (found) return found;
  }
  return null;
}

export function parseEntity(html: string, kind: Entity["kind"], entityId: string, sourceUrl: string): Entity | null {
  const doc = parseHtml(html);
  const byId = (id: string) => (n: Node) => n.attrs.get("id") === id;

  const heading = find(doc, byTag("h1"));
  if (!heading) return null;
  const occupationEl = extract(heading, byClass("occupation"));
  const occupation = occupationEl ? clean(textOf(occupationEl)) : null;

  const entity: Entity = {
    kind,
    id: entityId,
    name: clean(textOf(heading)) ?? "",
    occupation,
    address: null,
    postal_station: null,
    phones: [],
    email: null,
    website: null,
    kennitala: null,
    social_media: [],
    location: location(find(doc, (n) => n.attrs.has(":lat") && n.attrs.has(":lon"))),
    open_status: openStatus(find(doc, byId("opening-hours-button"))),
    opening_hours: openingHours(find(doc, byId("opening-hours-detail"))),
    branches: branches(doc),
    fields: {},
    source_url: sourceUrl,
  };

  for (const [label, values] of infoFields(find(doc, (n) => n.tag === "ul" && hasClass(n, "result-basic-info-list")))) {
    const key = label.toLowerCase();
    const texts =
      key === SOCIAL_LABEL
        ? values.map((v) => v.attrs.get("href")).filter((h): h is string => Boolean(h))
        : values.map((v) => clean(textOf(v))).filter((t): t is string => t !== null);
    (entity.fields[label] ??= []).push(...texts);
    if (!texts.length) continue;

    if (key === SOCIAL_LABEL) {
      entity.social_media.push(...texts);
    } else if (key.includes("sími")) {
      for (const value of values) {
        const text = clean(textOf(value));
        if (text) {
          entity.phones.push({
            label,
            number: text.replace(/\D/g, ""),
            display: text,
            marketing_ban: hasClass(value, "banned"),
          });
        }
      }
    } else if (key === "heimilisfang") {
      entity.address = texts[0];
    } else if (key === "staður") {
      entity.postal_station = texts[0];
    } else if (key === "netfang") {
      entity.email = texts[0];
    } else if (key === "vefsíða") {
      const href = values.map((v) => v.attrs.get("href") ?? "").find((h) => h.startsWith("http"));
      entity.website = href || texts[0];
    } else if (key === "kennitala") {
      entity.kennitala = texts[0];
    }
  }

  return entity;
}
