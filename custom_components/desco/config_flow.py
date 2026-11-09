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
    CONF_TODO_ENTITY,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_TODO_ENTITY,
    DOMAIN,
    NAME,
)


def _lista_predefinita(hass, valori: dict[str, Any]) -> str | None:
    """Una lista To-do che esiste davvero: quella salvata, la Lista della spesa di HA o la prima trovata."""
    for eid in (valori.get(CONF_TODO_ENTITY), DEFAULT_TODO_ENTITY):
        if eid and hass.states.get(eid):
            return eid
    liste = hass.states.async_entity_ids("todo")
    return sorted(liste)[0] if liste else None


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
    })


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
