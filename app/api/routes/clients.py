from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, func, select

from app.api.deps import SessionDep, get_current_user
from app.core.security import utc_now
from app.models import Client, ClientAddress, LaborEntry, LedgerEntry, Project
from app.schemas import (
    ClientAddressCreate,
    ClientAddressRead,
    ClientAddressUpdate,
    ClientCreate,
    ClientRead,
    ClientUpdate,
)

router = APIRouter(prefix="/api/clients", tags=["clients"], dependencies=[Depends(get_current_user)])


def _set_default_address(session: Session, address: ClientAddress) -> None:
    if not address.is_default or address.client_id is None:
        return
    existing_addresses = session.exec(
        select(ClientAddress).where(ClientAddress.client_id == address.client_id, ClientAddress.id != address.id)
    ).all()
    for existing in existing_addresses:
        existing.is_default = False
        existing.updated_at = utc_now()
        session.add(existing)


@router.get("", response_model=dict)
def list_clients(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str | None = None,
) -> dict:
    stmt = select(Client)
    count_stmt = select(func.count(Client.id))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Client.name.like(like))
        count_stmt = count_stmt.where(Client.name.like(like))
    total = session.exec(count_stmt).one()
    items = session.exec(stmt.order_by(Client.name).offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "items": [ClientRead.model_validate(i).model_dump(mode="json") for i in items],
        "meta": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("", response_model=ClientRead, status_code=status.HTTP_201_CREATED)
def create_client(payload: ClientCreate, session: SessionDep) -> Client:
    now = utc_now()
    data = payload.model_dump()
    site_address = data.get("site_address")
    client = Client(**data, created_at=now, updated_at=now)
    session.add(client)
    session.commit()
    session.refresh(client)
    if site_address:
        session.add(
            ClientAddress(
                client_id=client.id or 0,
                label="Primary Site",
                address=site_address,
                is_default=True,
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()
    return client


@router.get("/{client_id}", response_model=ClientRead)
def read_client(client_id: int, session: SessionDep) -> Client:
    client = session.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.patch("/{client_id}", response_model=ClientRead)
def update_client(client_id: int, payload: ClientUpdate, session: SessionDep) -> Client:
    client = session.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(client, key, value)
    client.updated_at = utc_now()
    session.add(client)
    session.commit()
    session.refresh(client)

    site_address = data.get("site_address")
    if site_address:
        exists = session.exec(
            select(ClientAddress).where(ClientAddress.client_id == client.id, ClientAddress.address == site_address)
        ).first()
        if exists is None:
            session.add(
                ClientAddress(
                    client_id=client.id or 0,
                    label="Primary Site",
                    address=site_address,
                    is_default=True,
                    created_at=utc_now(),
                    updated_at=utc_now(),
                )
            )
            session.commit()
    return client


@router.delete("/{client_id}", response_model=dict)
def delete_client(client_id: int, session: SessionDep) -> dict[str, str]:
    client = session.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    has_projects = session.exec(select(func.count(Project.id)).where(Project.client_id == client_id)).one()
    has_ledger = session.exec(select(func.count(LedgerEntry.id)).where(LedgerEntry.client_id == client_id)).one()
    has_labor = session.exec(select(func.count(LaborEntry.id)).where(LaborEntry.client_id == client_id)).one()
    if has_projects or has_ledger or has_labor:
        raise HTTPException(
            status_code=400, detail="Client has projects, ledger entries, or labor entries. Archive it instead."
        )
    addresses = session.exec(select(ClientAddress).where(ClientAddress.client_id == client_id)).all()
    for address in addresses:
        session.delete(address)
    session.delete(client)
    session.commit()
    return {"message": "Client deleted"}


@router.get("/{client_id}/addresses", response_model=dict)
def list_client_addresses(client_id: int, session: SessionDep) -> dict:
    client = session.get(Client, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    addresses = session.exec(
        select(ClientAddress)
        .where(ClientAddress.client_id == client_id)
        .order_by(ClientAddress.is_default.desc(), ClientAddress.label)
    ).all()
    items = [ClientAddressRead.model_validate(i).model_dump(mode="json") for i in addresses]
    legacy_addresses: list[dict[str, object]] = []
    for label, value in (("Billing Address", client.billing_address), ("Primary Site", client.site_address)):
        if value and value not in {item["address"] for item in items}:
            legacy_addresses.append(
                {
                    "id": f"legacy-{label.lower().replace(' ', '-')}",
                    "client_id": client_id,
                    "label": label,
                    "address": value,
                    "is_default": label == "Primary Site",
                    "created_at": client.created_at.isoformat(),
                    "updated_at": client.updated_at.isoformat(),
                }
            )
    return {"items": legacy_addresses + items, "meta": {"total": len(legacy_addresses) + len(items)}}


@router.post("/{client_id}/addresses", response_model=ClientAddressRead, status_code=status.HTTP_201_CREATED)
def create_client_address(client_id: int, payload: ClientAddressCreate, session: SessionDep) -> ClientAddress:
    if client_id != payload.client_id:
        raise HTTPException(status_code=400, detail="Client ID mismatch")
    if session.get(Client, client_id) is None:
        raise HTTPException(status_code=404, detail="Client not found")
    now = utc_now()
    address = ClientAddress(**payload.model_dump(), created_at=now, updated_at=now)
    session.add(address)
    session.flush()
    _set_default_address(session, address)
    session.commit()
    session.refresh(address)
    return address


@router.patch("/{client_id}/addresses/{address_id}", response_model=ClientAddressRead)
def update_client_address(
    client_id: int, address_id: int, payload: ClientAddressUpdate, session: SessionDep
) -> ClientAddress:
    address = session.get(ClientAddress, address_id)
    if address is None or address.client_id != client_id:
        raise HTTPException(status_code=404, detail="Address not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(address, key, value)
    address.updated_at = utc_now()
    session.add(address)
    session.flush()
    _set_default_address(session, address)
    session.commit()
    session.refresh(address)
    return address


@router.delete("/{client_id}/addresses/{address_id}", response_model=dict)
def delete_client_address(client_id: int, address_id: int, session: SessionDep) -> dict[str, str]:
    address = session.get(ClientAddress, address_id)
    if address is None or address.client_id != client_id:
        raise HTTPException(status_code=404, detail="Address not found")
    session.delete(address)
    session.commit()
    return {"message": "Address deleted"}
