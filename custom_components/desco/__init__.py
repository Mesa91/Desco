"""Desco: menu settimanale equilibrato per Home Assistant."""
from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers.event import async_track_time_change

from .const import (
    CONF_NOTIFY,
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
    STATIC_URL,
    VERSION,
)
from .manager import DescoManager
from .websocket import async_register_websocket

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]

type DescoConfigEntry = ConfigEntry[DescoManager]


async def _registra_pannello(hass: HomeAssistant) -> None:
    if not hass.data.get(f"{DOMAIN}_static"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), cache_headers=False)]
        )
        hass.data[f"{DOMAIN}_static"] = True
    if not hass.data.get(f"{DOMAIN}_card"):
        # scheda per le dashboard (type: custom:desco-card), caricata in automatico
        frontend.add_extra_js_url(hass, f"{STATIC_URL}/desco-card.js?v={VERSION}")
        hass.data[f"{DOMAIN}_card"] = True
    if PANEL_URL in hass.data.get(frontend.DATA_PANELS, {}):
        return
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/desco-panel.js?v={VERSION}",
        require_admin=False,
        config={},
    )


SCORCIATOIA_URL = "desco-marketplace"


async def aggiorna_scorciatoia(hass: HomeAssistant, attiva: bool) -> None:
    """Voce «Marketplace» nella barra laterale (il Marketplace integrato non ne ha una propria)."""
    presente = SCORCIATOIA_URL in hass.data.get(frontend.DATA_PANELS, {})
    if attiva and not presente:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=SCORCIATOIA_URL,
            webcomponent_name="desco-scorciatoia",
            sidebar_title="Marketplace",
            sidebar_icon="mdi:store",
            module_url=f"{STATIC_URL}/desco-scorciatoia.js?v={VERSION}",
            require_admin=True,
            config={"destinazione": "/marketplace"},
        )
    elif not attiva and presente:
        frontend.async_remove_panel(hass, SCORCIATOIA_URL)


async def async_setup_entry(hass: HomeAssistant, entry: DescoConfigEntry) -> bool:
    manager = DescoManager(hass, entry)
    await manager.async_load()
    entry.runtime_data = manager
    hass.data[DOMAIN] = manager

    async_register_websocket(hass)
    await _registra_pannello(hass)
    await aggiorna_scorciatoia(hass, bool(manager.settings.get("scorciatoia_marketplace")))
    manager.su_impostazioni = lambda s: aggiorna_scorciatoia(hass, bool(s.get("scorciatoia_marketplace")))

    async def _genera(call: ServiceCall) -> None:
        await manager.genera(call.data.get("settimana", "auto"))

    async def _spesa(call: ServiceCall) -> ServiceResponse:
        return await manager.invia_spesa()

    hass.services.async_register(
        DOMAIN, "genera_settimana", _genera,
        schema=vol.Schema({vol.Optional("settimana", default="auto"): vol.In(["auto", "corrente", "prossima"])}),
    )
    hass.services.async_register(
        DOMAIN, "invia_lista_spesa", _spesa, supports_response=SupportsResponse.OPTIONAL)

    async def _promemoria(call: ServiceCall) -> ServiceResponse:
        return await manager.invia_promemoria(forza=True)

    hass.services.async_register(
        DOMAIN, "invia_promemoria", _promemoria, supports_response=SupportsResponse.OPTIONAL)

    if manager.opt(CONF_NOTIFY):
        ora, minuto = manager.orario_promemoria()

        async def _sera(_now) -> None:
            try:
                await manager.invia_promemoria()
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Promemoria Desco non inviato: %s", err)

        entry.async_on_unload(async_track_time_change(hass, _sera, hour=ora, minute=minuto, second=0))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_ricarica))
    return True


async def _ricarica(hass: HomeAssistant, entry: DescoConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: DescoConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.services.async_remove(DOMAIN, "genera_settimana")
        hass.services.async_remove(DOMAIN, "invia_lista_spesa")
        hass.services.async_remove(DOMAIN, "invia_promemoria")
        frontend.async_remove_panel(hass, PANEL_URL)
        if SCORCIATOIA_URL in hass.data.get(frontend.DATA_PANELS, {}):
            frontend.async_remove_panel(hass, SCORCIATOIA_URL)
        hass.data.pop(DOMAIN, None)
    return ok
