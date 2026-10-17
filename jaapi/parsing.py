"""Turn ja.is responses into the API's models."""

import re

from bs4 import BeautifulSoup, Tag

from .models import (
    Branch,
    BusinessHit,
    BusinessSection,
    Entity,
    Location,
    OpeningHour,
    PersonHit,
    PersonSection,
    Phone,
)


def clean(text: str | None) -> str | None:
    """Collapse whitespace; ja.is data has stray runs of spaces in names."""
    if text is None:
        return None
    text = " ".join(text.split())
    return text or None


def person_path(hashid: str) -> str:
    return f"/people/{hashid}"


def business_path(cluster_key: str, hashid: str | None = None) -> str:
    return f"/businesses/{cluster_key}/{hashid}" if hashid else f"/businesses/{cluster_key}"


# --- search -----------------------------------------------------------------


def _section_bounds(meta: dict) -> dict:
    total = meta.get("total_items") or 0
    last = meta.get("last_item")
    return {
        "total": total,
        "first_item": meta.get("first_item"),
        "last_item": last,
        "next_start": last + 1 if last and last < total else None,
    }


def parse_people(section: dict) -> PersonSection:
    items = [
        PersonHit(
            id=item["hashid"],
            name=clean(item.get("name")) or "",
            occupation=clean(item.get("occupation")),
            address=clean(item.get("address")),
            postal_station=clean(item.get("postal_station")),
            detail_path=person_path(item["hashid"]),
        )
        for item in section.get("items") or []
    ]
    return PersonSection(**_section_bounds(section.get("meta") or {}), items=items)


def parse_businesses(section: dict) -> BusinessSection:
    items = []
    for item in section.get("items") or []:
        is_branch = bool(item.get("is_branch"))
        items.append(
            BusinessHit(
                id=item["hashid"],
                cluster_key=item["cluster_key"],
                is_branch=is_branch,
                name=clean(item.get("name")) or "",
                occupation=clean(item.get("occupation")),
                company_types=item.get("company_type") or [],
                address=clean(item.get("address")),
                postal_station=clean(item.get("postal_station")),
                logo_url=item.get("logo_url"),
                # Mirrors the frontend: only branches are addressed by hashid.
                detail_path=business_path(item["cluster_key"], item["hashid"] if is_branch else None),
            )
        )
    return BusinessSection(**_section_bounds(section.get("meta") or {}), items=items)


# --- detail pages -----------------------------------------------------------

_SOCIAL_LABEL = "samfélagsmiðlar"


def _info_fields(soup: BeautifulSoup) -> list[tuple[str, list[Tag]]]:
    info = soup.select_one("ul.result-basic-info-list")
    if info is None:
        return []
    fields = []
    for data in info.select("li.result-basic-info-list-item .result-basic-info-list-item-data"):
        heading = data.find("h3")
        if heading is None:
            continue
        values = [el for el in data.find_all(["a", "p"], recursive=True) if el is not heading]
        fields.append((clean(heading.get_text()) or "", values))
    return fields


def _location(soup: BeautifulSoup) -> Location | None:
    el = soup.find(attrs={":lat": True, ":lon": True})
    if el is None:
        return None
    try:
        return Location(lat=float(el[":lat"]), lon=float(el[":lon"]))
    except ValueError:
        return None


def _opening_hours(soup: BeautifulSoup) -> list[OpeningHour]:
    hours = []
    for row in soup.select("#opening-hours-detail tr.opening-hour"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        day_spans = cells[0].find_all("span")
        time_spans = cells[1].find_all("span")
        notes = [clean(s.get_text()) for s in day_spans[1:] + time_spans[1:]]
        hours.append(
            OpeningHour(
                day=clean(day_spans[0].get_text()) if day_spans else "",
                hours=clean(time_spans[0].get_text()) if time_spans else "",
                note=" ".join(n for n in notes if n) or None,
            )
        )
    return hours


def _open_status(soup: BeautifulSoup) -> str | None:
    button = soup.select_one("#opening-hours-button")
    if button is None:
        return None
    return clean(" ".join(s.get_text() for s in button.find_all("span")))


_BRANCH_HREF = re.compile(r"^/([^/]+)/([^/]+)/$")


def _branches(soup: BeautifulSoup) -> list[Branch]:
    branches = []
    for link in soup.select("a.list-item.branch"):
        match = _BRANCH_HREF.match(link.get("href", ""))
        if not match:
            continue
        cluster_key, hashid = match.groups()
        name = link.select_one(".comany-result-name, .company-result-name")
        address = link.select_one(".company-result-address")
        status = link.select_one(".open-text")
        branches.append(
            Branch(
                id=hashid,
                name=clean(name.get_text()) if name else "",
                address=clean(address.get_text()) if address else None,
                phones=[clean(s.get_text()) for s in link.select(".other-registration-telephone li span")],
                open_status=clean(status.get_text()) if status else None,
                detail_path=business_path(cluster_key, hashid),
            )
        )
    return branches


def parse_entity(html: str, kind: str, entity_id: str, source_url: str) -> Entity | None:
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    if heading is None:
        return None
    occupation = heading.find(class_="occupation")
    if occupation is not None:
        occupation = clean(occupation.extract().get_text())

    entity = Entity(
        kind=kind,
        id=entity_id,
        name=clean(heading.get_text()) or "",
        occupation=occupation,
        location=_location(soup),
        open_status=_open_status(soup),
        opening_hours=_opening_hours(soup),
        branches=_branches(soup),
        source_url=source_url,
    )

    for label, values in _info_fields(soup):
        key = label.casefold()
        if key == _SOCIAL_LABEL:
            texts = [v["href"] for v in values if v.get("href")]
        else:
            texts = [t for t in (clean(v.get_text()) for v in values) if t]
        entity.fields.setdefault(label, []).extend(texts)
        if not texts:
            continue

        if key == _SOCIAL_LABEL:
            entity.social_media.extend(texts)
        elif "sími" in key:
            for value in values:
                text = clean(value.get_text())
                if text:
                    entity.phones.append(
                        Phone(
                            label=label,
                            number=re.sub(r"\D", "", text),
                            display=text,
                            marketing_ban="banned" in (value.get("class") or []),
                        )
                    )
        elif key == "heimilisfang":
            entity.address = texts[0]
        elif key == "staður":
            entity.postal_station = texts[0]
        elif key == "netfang":
            entity.email = texts[0]
        elif key == "vefsíða":
            href = next((v.get("href") for v in values if v.get("href", "").startswith("http")), None)
            entity.website = href or texts[0]
        elif key == "kennitala":
            entity.kennitala = texts[0]

    return entity
