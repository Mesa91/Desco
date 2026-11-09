"""API websocket usate dal pannello."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN


def _mgr(hass: HomeAssistant):
    mgr = hass.data.get(DOMAIN)
    if mgr is None:
        raise HomeAssistantError("Desco non è configurato")
    return mgr


def _comando(schema: dict, azione):
    """Crea un comando che esegue `azione(mgr, msg)` e risponde con lo stato aggiornato."""

    @websocket_api.websocket_command(schema)
    @websocket_api.async_response
    async def handler(hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        try:
            mgr = _mgr(hass)
            extra = await azione(mgr, msg)
            risposta = mgr.stato()
            if extra is not None:
                risposta["risultato"] = extra
            conn.send_result(msg["id"], risposta)
        except HomeAssistantError as err:
            conn.send_error(msg["id"], "desco_error", str(err))

    return handler


async def _niente(mgr, msg):
    return None


COMANDI = [
    ({vol.Required("type"): "desco/stato"}, _niente),
    ({vol.Required("type"): "desco/genera", vol.Optional("settimana"): str},
     lambda m, msg: m.genera(msg.get("settimana"))),
    ({vol.Required("type"): "desco/rigenera_pasto", vol.Required("idx"): int},
     lambda m, msg: m.rigenera_pasto(msg["idx"])),
    ({vol.Required("type"): "desco/rigenera_componente", vol.Required("idx"): int, vol.Required("pos"): int},
     lambda m, msg: m.rigenera_componente(msg["idx"], msg["pos"])),
    ({vol.Required("type"): "desco/imposta_componente", vol.Required("idx"): int, vol.Required("pos"): int,
      vol.Required("comp_id"): str},
     lambda m, msg: m.imposta_componente(msg["idx"], msg["pos"], msg["comp_id"])),
    ({vol.Required("type"): "desco/blocca", vol.Required("idx"): int, vol.Required("bloccato"): bool},
     lambda m, msg: m.blocca(msg["idx"], msg["bloccato"])),
    ({vol.Required("type"): "desco/svuota"}, lambda m, msg: m.svuota()),
    ({vol.Required("type"): "desco/sposta", vol.Required("da"): int, vol.Required("a"): int},
     lambda m, msg: m.sposta(msg["da"], msg["a"])),
    ({vol.Required("type"): "desco/riusa", vol.Required("settimana"): str},
     lambda m, msg: m.riusa(msg["settimana"])),
    ({vol.Required("type"): "desco/elimina_archivio", vol.Required("settimana"): str},
     lambda m, msg: m.elimina_archivio(msg["settimana"])),
    ({vol.Required("type"): "desco/impostazioni", vol.Required("settings"): dict},
     lambda m, msg: m.salva_impostazioni(msg["settings"])),
    ({vol.Required("type"): "desco/salva_componente", vol.Required("componente"): dict},
     lambda m, msg: m.salva_componente(msg["componente"])),
    ({vol.Required("type"): "desco/elimina_componente", vol.Required("comp_id"): str},
     lambda m, msg: m.elimina_componente(msg["comp_id"])),
    ({vol.Required("type"): "desco/attiva_componente", vol.Required("comp_id"): str, vol.Required("attivo"): bool},
     lambda m, msg: m.attiva_componente(msg["comp_id"], msg["attivo"])),
    ({vol.Required("type"): "desco/suggerisci", vol.Required("cat"): str, vol.Optional("quanti", default=3): int,
      vol.Optional("asporto", default=False): bool},
     lambda m, msg: m.suggerisci(msg["cat"], msg["quanti"], msg["asporto"])),
    ({vol.Required("type"): "desco/invia_spesa"}, lambda m, msg: m.invia_spesa()),
]


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    if hass.data.get(f"{DOMAIN}_ws"):
        return
    for schema, azione in COMANDI:
        websocket_api.async_register_command(hass, _comando(schema, azione))
    hass.data[f"{DOMAIN}_ws"] = True
