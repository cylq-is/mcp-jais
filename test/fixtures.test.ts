import { expect, it } from "vitest";
import expected from "./expected.json";
import branch from "./fixtures/business_branch.html?raw";
import cluster from "./fixtures/business_cluster.html?raw";
import { parseEntity } from "../src/parsing";

// expected.json is the complete parse of both fixtures, originally produced by the
// BeautifulSoup parser this project started with. If the fixtures are refreshed
// from ja.is, check the new output by hand before updating it.
it("parses the fixture pages completely", () => {
  expect(parseEntity(branch, "business", "9XMkg", "https://ja.is/dominos/9XMkg/")).toEqual(expected.business_branch);
  expect(parseEntity(cluster, "business", "dominos", "https://ja.is/dominos/")).toEqual(expected.business_cluster);
});
