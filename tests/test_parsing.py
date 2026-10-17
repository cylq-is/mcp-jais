from pathlib import Path

from jaapi.client import search_hash
from jaapi.parsing import parse_businesses, parse_entity, parse_people

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_search_hash_matches_frontend():
    # Known-good value produced by the frontend hashing algorithm
    assert search_hash("jon") == "fa348eb27e6d7dcb126344f22ee61d20"


def test_parse_people_paging():
    section = parse_people(
        {
            "meta": {"first_item": 1, "last_item": 16, "total_items": 375},
            "items": [
                {"name": "Jón   Jónsson", "occupation": "", "address": "Gata 1",
                 "postal_station": "101 Reykjavík", "hashid": "abc12"},
            ],
        }
    )
    assert section.next_start == 17
    person = section.items[0]
    assert person.name == "Jón Jónsson"
    assert person.occupation is None
    assert person.detail_path == "/people/abc12"


def test_parse_businesses_last_page_and_branch_path():
    section = parse_businesses(
        {
            "meta": {"first_item": 13, "last_item": 32, "total_items": 32},
            "items": [
                {"name": "Main", "cluster_key": "acme", "hashid": "A1", "is_branch": False, "company_type": ["x"]},
                {"name": "Branch", "cluster_key": "acme", "hashid": "B2", "is_branch": True},
            ],
        }
    )
    assert section.next_start is None
    assert [b.detail_path for b in section.items] == ["/businesses/acme", "/businesses/acme/B2"]


def test_parse_business_branch_page():
    entity = parse_entity(load("business_branch.html"), "business", "9XMkg", "https://ja.is/dominos/9XMkg/")
    assert entity.name == "Domino's Pizza"
    assert entity.address == "Ánanaustum 15"
    assert entity.postal_station == "101 Reykjavík"
    assert [(p.label, p.number, p.display) for p in entity.phones] == [("Sími", "5812345", "581 2345")]
    assert entity.website == "https://www.dominos.is/"
    assert entity.kennitala == "480293-2669"
    assert "https://www.facebook.com/Dominos.is" in entity.social_media
    assert entity.location is not None
    assert len(entity.opening_hours) == 7
    assert entity.opening_hours[0].hours


def test_parse_business_cluster_page_lists_branches():
    entity = parse_entity(load("business_cluster.html"), "business", "dominos", "https://ja.is/dominos/")
    assert entity.phones[0].number == "5812345"
    assert len(entity.branches) > 5
    branch = entity.branches[0]
    assert branch.detail_path == "/businesses/dominos/9XMkg"
    assert branch.address == "Ánanaustum 15, 101 Reykjavík"
    assert branch.phones == ["581 2345"]


def test_parse_person_occupation_and_marketing_ban():
    html = """
    <h1 class="bold"> Jón   Jónsson <span class="occupation">smiður</span></h1>
    <ul class="result-basic-info-list">
      <li class="result-basic-info-list-item"><div class="result-basic-info-list-item-data">
        <h3> Sími </h3><a class=" no-margin" href="tel:5551234">555 1234</a></div></li>
      <li class="result-basic-info-list-item"><div class="result-basic-info-list-item-data">
        <h3> Sími </h3><a class="banned no-margin" href="tel:8881234">888 1234</a></div></li>
    </ul>
    """
    entity = parse_entity(html, "person", "abc12", "https://ja.is/e/abc12/")
    assert entity.name == "Jón Jónsson"
    assert entity.occupation == "smiður"
    assert [(p.number, p.marketing_ban) for p in entity.phones] == [("5551234", False), ("8881234", True)]


def test_parse_entity_without_heading_returns_none():
    assert parse_entity("<html><body></body></html>", "person", "x", "u") is None
