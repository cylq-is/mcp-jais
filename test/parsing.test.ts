import { describe, expect, it } from "vitest";
import businessBranch from "./fixtures/business_branch.html?raw";
import businessCluster from "./fixtures/business_cluster.html?raw";
import { searchHash } from "../src/client";
import { parseBusinesses, parseEntity, parsePeople } from "../src/parsing";

describe("parsing", () => {
  it("signs searches like the frontend", () => {
    // Known-good value produced by the frontend hashing algorithm
    expect(searchHash("jon")).toBe("fa348eb27e6d7dcb126344f22ee61d20");
  });

  it("pages people", () => {
    const section = parsePeople({
      meta: { first_item: 1, last_item: 16, total_items: 375 },
      items: [
        { name: "Jón   Jónsson", occupation: "", address: "Gata 1", postal_station: "101 Reykjavík", hashid: "abc12" },
      ],
    });
    expect(section.next_start).toBe(17);
    const person = section.items[0];
    expect(person.name).toBe("Jón Jónsson");
    expect(person.occupation).toBeNull();
    expect(person.detail_path).toBe("/people/abc12");
  });

  it("stops paging on the last page and addresses branches by hashid", () => {
    const section = parseBusinesses({
      meta: { first_item: 13, last_item: 32, total_items: 32 },
      items: [
        { name: "Main", cluster_key: "acme", hashid: "A1", is_branch: false, company_type: ["x"] },
        { name: "Branch", cluster_key: "acme", hashid: "B2", is_branch: true },
      ],
    });
    expect(section.next_start).toBeNull();
    expect(section.items.map((b) => b.detail_path)).toEqual(["/businesses/acme", "/businesses/acme/B2"]);
  });

  it("parses a business branch page", async () => {
    const entity = (await parseEntity(businessBranch, "business", "9XMkg", "https://ja.is/dominos/9XMkg/"))!;
    expect(entity.name).toBe("Domino's Pizza");
    expect(entity.address).toBe("Ánanaustum 15");
    expect(entity.postal_station).toBe("101 Reykjavík");
    expect(entity.phones.map((p) => [p.label, p.number, p.display])).toEqual([["Sími", "5812345", "581 2345"]]);
    expect(entity.website).toBe("https://www.dominos.is/");
    expect(entity.kennitala).toBe("480293-2669");
    expect(entity.social_media).toContain("https://www.facebook.com/Dominos.is");
    expect(entity.location).not.toBeNull();
    expect(entity.opening_hours).toHaveLength(7);
    expect(entity.opening_hours[0].hours).toBeTruthy();
  });

  it("lists branches on a business cluster page", async () => {
    const entity = (await parseEntity(businessCluster, "business", "dominos", "https://ja.is/dominos/"))!;
    expect(entity.phones[0].number).toBe("5812345");
    expect(entity.branches.length).toBeGreaterThan(5);
    const branch = entity.branches[0];
    expect(branch.detail_path).toBe("/businesses/dominos/9XMkg");
    expect(branch.address).toBe("Ánanaustum 15, 101 Reykjavík");
    expect(branch.phones).toEqual(["581 2345"]);
  });

  it("reads a person's occupation and marketing ban", async () => {
    const html = `
    <h1 class="bold"> Jón   Jónsson <span class="occupation">smiður</span></h1>
    <ul class="result-basic-info-list">
      <li class="result-basic-info-list-item"><div class="result-basic-info-list-item-data">
        <h3> Sími </h3><a class=" no-margin" href="tel:5551234">555 1234</a></div></li>
      <li class="result-basic-info-list-item"><div class="result-basic-info-list-item-data">
        <h3> Sími </h3><a class="banned no-margin" href="tel:8881234">888 1234</a></div></li>
    </ul>
    `;
    const entity = (await parseEntity(html, "person", "abc12", "https://ja.is/e/abc12/"))!;
    expect(entity.name).toBe("Jón Jónsson");
    expect(entity.occupation).toBe("smiður");
    expect(entity.phones.map((p) => [p.number, p.marketing_ban])).toEqual([
      ["5551234", false],
      ["8881234", true],
    ]);
  });

  it("returns null for a page without a heading", async () => {
    expect(await parseEntity("<html><body></body></html>", "person", "x", "u")).toBeNull();
  });
});
