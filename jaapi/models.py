from typing import Literal

from pydantic import BaseModel


class PersonHit(BaseModel):
    id: str
    name: str
    occupation: str | None = None
    address: str | None = None
    postal_station: str | None = None
    detail_path: str


class BusinessHit(BaseModel):
    id: str
    cluster_key: str
    is_branch: bool
    name: str
    occupation: str | None = None
    company_types: list[str] = []
    address: str | None = None
    postal_station: str | None = None
    logo_url: str | None = None
    detail_path: str


class PersonSection(BaseModel):
    total: int
    first_item: int | None
    last_item: int | None
    next_start: int | None
    items: list[PersonHit]


class BusinessSection(BaseModel):
    total: int
    first_item: int | None
    last_item: int | None
    next_start: int | None
    items: list[BusinessHit]


class SearchResponse(BaseModel):
    query: str
    people: PersonSection | None = None
    businesses: BusinessSection | None = None


class Phone(BaseModel):
    label: str
    number: str
    display: str
    # Bannmerking: the owner has opted out of marketing calls to this number.
    marketing_ban: bool = False


class Location(BaseModel):
    lat: float
    lon: float


class OpeningHour(BaseModel):
    day: str
    hours: str
    note: str | None = None


class Branch(BaseModel):
    id: str
    name: str
    address: str | None = None
    phones: list[str] = []
    open_status: str | None = None
    detail_path: str


class Entity(BaseModel):
    kind: Literal["person", "business"]
    id: str
    name: str
    occupation: str | None = None
    address: str | None = None
    postal_station: str | None = None
    phones: list[Phone] = []
    email: str | None = None
    website: str | None = None
    kennitala: str | None = None
    social_media: list[str] = []
    location: Location | None = None
    open_status: str | None = None
    opening_hours: list[OpeningHour] = []
    branches: list[Branch] = []
    # Every label/value pair from the info box, untouched, for fields not mapped above.
    fields: dict[str, list[str]] = {}
    source_url: str
