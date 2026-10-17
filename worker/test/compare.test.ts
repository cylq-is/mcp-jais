import { expect, it } from "vitest";
import branch from "../../tests/fixtures/business_branch.html?raw";
import cluster from "../../tests/fixtures/business_cluster.html?raw";
import expected from "./python-expected.json";
import { parseEntity } from "../src/parsing";

// python-expected.json is the Python parser's output for the same fixtures. Regenerate it
// from the repo root after changing either parser:
//   uv run python -c "import json; from pathlib import Path; from jaapi.parsing import parse_entity; \
//     print(json.dumps({n: parse_entity(Path(f'tests/fixtures/{n}.html').read_text(), 'business', i, u).model_dump() \
//     for n, i, u in [('business_branch', '9XMkg', 'https://ja.is/dominos/9XMkg/'), \
//     ('business_cluster', 'dominos', 'https://ja.is/dominos/')]}, ensure_ascii=False))" > worker/test/python-expected.json
it("matches the Python parser", async () => {
  expect(await parseEntity(branch, "business", "9XMkg", "https://ja.is/dominos/9XMkg/")).toEqual(expected.business_branch);
  expect(await parseEntity(cluster, "business", "dominos", "https://ja.is/dominos/")).toEqual(expected.business_cluster);
});
