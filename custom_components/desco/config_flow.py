"""Configurazione di Desco."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_GEMINI_KEY,
    CONF_GEMINI_MODEL,
    CONF_NOTIFY,
    CONF_NOTIFY_TIME,
    CONF_TODO_ENTITY,
    DEFAULT_NOTIFY_TIME,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_TODO_ENTITY,
    DOMAIN,
    NAME,
    trova_lista_spesa,
)


def _lista_predefinita(hass, valori: dict[str, Any]) -> str | None:
    return trova_lista_spesa(hass, valori.get(CONF_TODO_ENTITY))


def _schema(hass, valori: dict[str, Any]) -> vol.Schema:
    predef = _lista_predefinita(hass, valori)
    chiave_todo = (vol.Required(CONF_TODO_ENTITY, default=predef) if predef
                   else vol.Required(CONF_TODO_ENTITY))
    return vol.Schema({
        chiave_todo:
            selector.EntitySelector(selector.EntitySelectorConfig(domain="todo")),
        vol.Optional(CONF_GEMINI_KEY, description={"suggested_value": valori.get(CONF_GEMINI_KEY, "")}):
            selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
        vol.Required(CONF_GEMINI_MODEL, default=valori.get(CONF_GEMINI_MODEL, DEFAULT_GEMINI_MODEL)):
            selector.TextSelector(),
        vol.Optional(CONF_NOTIFY, default=valori.get(CONF_NOTIFY, [])):
            selector.SelectSelector(selector.SelectSelectorConfig(
                options=_servizi_notifica(hass), multiple=True, custom_value=True,
                mode=selector.SelectSelectorMode.DROPDOWN)),
        vol.Required(CONF_NOTIFY_TIME, default=valori.get(CONF_NOTIFY_TIME, DEFAULT_NOTIFY_TIME)):
            selector.TimeSelector(),
    })


def _servizi_notifica(hass) -> list[str]:
    servizi = hass.services.async_services().get("notify", {})
    return sorted(f"notify.{s}" for s in servizi if s not in ("send_message", "persistent_notification"))


class DescoConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title=NAME, data=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema(self.hass, {}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DescoOptionsFlow()


class DescoOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        valori = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(step_id="init", data_schema=_schema(self.hass, valori))
