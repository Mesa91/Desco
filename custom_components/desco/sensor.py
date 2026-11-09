"""Sensori: pranzo e cena di oggi, pranzo di domani."""
from __future__ import annotations

from datetime import timedelta

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_change

from .const import DOMAIN, NAME, VERSION
from .manager import DescoManager

SENSORI = [
    ("pranzo_oggi", "Pranzo di oggi", "pranzo", 0, "mdi:food-takeout-box"),
    ("cena_oggi", "Cena di oggi", "cena", 0, "mdi:silverware-fork-knife"),
    ("pranzo_domani", "Pranzo di domani", "pranzo", 1, "mdi:food-takeout-box-outline"),
    ("cena_domani", "Cena di domani", "cena", 1, "mdi:silverware-variant"),
]


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    mgr: DescoManager = entry.runtime_data
    entita = [PastoSensor(mgr, entry.entry_id, *s) for s in SENSORI] + [PromemoriaSensor(mgr, entry.entry_id)]
    async_add_entities(entita)

    @callback
    def _mezzanotte(_now) -> None:
        for e in entita:
            e.async_write_ha_state()

    entry.async_on_unload(async_track_time_change(hass, _mezzanotte, hour=0, minute=0, second=5))


class PastoSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, mgr: DescoManager, entry_id: str, chiave: str, nome: str, tipo: str, offset: int, icona: str) -> None:
        self._mgr = mgr
        self._tipo = tipo
        self._offset = offset
        self._attr_unique_id = f"{entry_id}_{chiave}"
        self._attr_name = nome
        self._attr_icon = icona
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)}, name=NAME, manufacturer="Mesa91",
            sw_version=VERSION, entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._mgr.async_add_listener(self.async_write_ha_state))

    def _pasto(self):
        return self._mgr.pasto_del(self._mgr.oggi() + timedelta(days=self._offset), self._tipo)

    @property
    def native_value(self) -> str:
        p = self._pasto()
        if not p:
            return "Nessun pasto"
        return p["titolo"][:250]

    @property
    def extra_state_attributes(self) -> dict:
        p = self._pasto()
        if not p:
            return {}
        return {
            "componenti": [c["nome"] for c in p["dettagli"] if c["id"]],
            "preparazione": {c["nome"]: c["prep"] for c in p["dettagli"] if c["id"]},
            "minuti": p["minuti"],
            "costo": "€" * p["costo"],
            "porzioni": p.get("porzioni"),
            "bloccato": p.get("bloccato", False),
        }


class PromemoriaSensor(PastoSensor):
    """Cosa preparare stasera per domani (cena doppia, freezer, preparazione in anticipo)."""

    def __init__(self, mgr: DescoManager, entry_id: str) -> None:
        super().__init__(mgr, entry_id, "promemoria_sera", "Promemoria di stasera", "pranzo", 1, "mdi:bell-ring-outline")

    @property
    def native_value(self) -> str:
        p = self._mgr.promemoria()
        return (p["breve"] if p else "Niente da preparare stasera")[:250]

    @property
    def extra_state_attributes(self) -> dict:
        p = self._mgr.promemoria()
        return {"testo": p["testo"], "titolo": p["titolo"]} if p else {}
