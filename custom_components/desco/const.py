"""Costanti di Desco."""
DOMAIN = "desco"
VERSION = "1.0.19"
NAME = "Desco"

STORAGE_KEY = "desco.data"
STORAGE_VERSION = 1

CONF_GEMINI_KEY = "gemini_api_key"
CONF_GEMINI_MODEL = "gemini_model"
CONF_TODO_ENTITY = "todo_entity"
CONF_NOTIFY = "notify_services"
CONF_NOTIFY_TIME = "notify_time"
DEFAULT_NOTIFY_TIME = "20:30:00"

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_TODO_ENTITY = "todo.shopping_list"


def trova_lista_spesa(hass, preferita: str | None = None) -> str | None:
    """Lista To-do da usare: quella scelta se esiste, altrimenti la Lista della spesa di HA
    (qualunque sia il suo ID, es. todo.lista_della_spesa), altrimenti la prima lista trovata."""
    from homeassistant.helpers import entity_registry as er

    if preferita and hass.states.get(preferita):
        return preferita
    reg = er.async_get(hass)
    for voce in reg.entities.values():
        if voce.domain == "todo" and voce.platform == "shopping_list" and hass.states.get(voce.entity_id):
            return voce.entity_id
    if hass.states.get(DEFAULT_TODO_ENTITY):
        return DEFAULT_TODO_ENTITY
    liste = sorted(hass.states.async_entity_ids("todo"))
    return liste[0] if liste else None

PANEL_URL = "desco"
PANEL_TITLE = "Desco"
PANEL_ICON = "mdi:silverware-fork-knife"
PANEL_COMPONENT = "desco-panel"
STATIC_URL = "/desco_static"

EVENT_UPDATED = "desco_piano_aggiornato"
