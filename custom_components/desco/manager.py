"""Stato e operazioni di Desco."""
from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import gemini, planner
from .const import (
    CONF_GEMINI_KEY,
    CONF_GEMINI_MODEL,
    CONF_TODO_ENTITY,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_TODO_ENTITY,
    EVENT_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

CAMPI_IMPOSTAZIONI = set(planner.DEFAULT_SETTINGS)
ORDINE_CAT = {"proteina": 0, "carboidrato": 1, "verdura": 2, "unico": 3}
MAX_ARCHIVIO = 104  # settimane conservate nello storico (2 anni)


class DescoManager:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = {}
        self.builtin: list[dict] = []
        self.lib: dict[str, dict] = {}
        self._listeners: list[Callable[[], None]] = []

    # ------------------------------------------------------------------ opzioni

    def opt(self, key: str, default: Any = None) -> Any:
        return self.entry.options.get(key, self.entry.data.get(key, default))

    @property
    def gemini_attivo(self) -> bool:
        return bool(self.opt(CONF_GEMINI_KEY))

    @property
    def todo_entity(self) -> str:
        return self.opt(CONF_TODO_ENTITY) or DEFAULT_TODO_ENTITY

    @property
    def settings(self) -> dict:
        return planner.unisci_impostazioni(self.data.get("settings"))

    # ------------------------------------------------------------------ persistenza

    async def async_load(self) -> None:
        path = Path(__file__).parent / "data" / "ricettario.json"
        raw = await self.hass.async_add_executor_job(path.read_text, "utf-8")
        self.builtin = json.loads(raw)["componenti"]
        self.data = await self._store.async_load() or {}
        self.data.setdefault("settings", dict(planner.DEFAULT_SETTINGS))
        self.data.setdefault("custom", [])
        self.data.setdefault("disabilitati", [])
        self.data.setdefault("piano", None)
        self.data.setdefault("storico", [])
        self.data.setdefault("spesa_inviata", [])
        self.data.setdefault("archivio", [])
        self._ricostruisci()

    def _ricostruisci(self) -> None:
        self.lib = planner.costruisci_libreria(self.builtin, self.data["custom"], self.data["disabilitati"])

    async def _salva(self, piano_cambiato: bool = False) -> None:
        await self._store.async_save(self.data)
        if piano_cambiato:
            self.hass.bus.async_fire(EVENT_UPDATED, {"settimana": (self.data.get("piano") or {}).get("settimana")})
        for cb in list(self._listeners):
            cb()

    @callback
    def async_add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb)

    # ------------------------------------------------------------------ viste

    def _settimana(self) -> date | None:
        piano = self.data.get("piano")
        return date.fromisoformat(piano["settimana"]) if piano else None

    def _pasti(self) -> list[dict]:
        return (self.data.get("piano") or {}).get("pasti", [])

    def stato(self) -> dict:
        piano = self.data.get("piano")
        pasti_info = []
        if piano:
            lun = date.fromisoformat(piano["settimana"])
            for idx, p in enumerate(piano["pasti"]):
                g = lun + timedelta(days=p["giorno"])
                info = planner.info_pasto(p, self.lib)
                non_trasp = []
                if p["tipo"] == "pranzo":
                    non_trasp = [d["nome"] for d in info["dettagli"]
                                 if d["id"] and not planner.asporto_ok(self.lib[d["id"]], self.settings["microonde"])]
                pasti_info.append({
                    **p,
                    "idx": idx,
                    "data": g.isoformat(),
                    "nome_giorno": planner.GIORNI[p["giorno"]],
                    "non_trasportabile": non_trasp,
                    **info,
                })
        oggi = dt_util.now().date()
        return {
            "settings": self.settings,
            "piano": {**piano, "pasti": pasti_info} if piano else None,
            "settimana_predefinita": planner.settimana_predefinita(oggi).isoformat(),
            "oggi": oggi.isoformat(),
            "ricettario": sorted(self.lib.values(), key=lambda c: (ORDINE_CAT.get(c["cat"], 9), planner.normalizza(c["nome"]))),
            "gemini": self.gemini_attivo,
            "todo_entity": self.todo_entity,
            "todo_ok": self.hass.states.get(self.todo_entity) is not None,
            "liste_todo": sorted(self.hass.states.async_entity_ids("todo")),
            "spesa": planner.lista_spesa(self._pasti(), self.lib) if piano else [],
            "conteggi": planner.conta_macro(self._pasti(), self.lib) if piano else {},
            "obiettivi_scalati": planner.obiettivi_scalati(self.settings, len(self._pasti()) or 10),
            "archivio": self.data["archivio"],
        }

    def pasto_del(self, giorno: date, tipo: str) -> dict | None:
        piano = self.data.get("piano")
        if not piano:
            return None
        lun = date.fromisoformat(piano["settimana"])
        delta = (giorno - lun).days
        for p in piano["pasti"]:
            if p["giorno"] == delta and p["tipo"] == tipo:
                return {**p, **planner.info_pasto(p, self.lib)}
        return None

    # ------------------------------------------------------------------ piano

    async def genera(self, settimana: str | None = None) -> None:
        oggi = dt_util.now().date()
        if settimana in (None, "", "auto"):
            lun = planner.settimana_predefinita(oggi)
        elif settimana == "corrente":
            lun = planner.lunedi_di(oggi)
        elif settimana == "prossima":
            lun = planner.lunedi_di(oggi) + timedelta(days=7)
        else:
            lun = planner.lunedi_di(date.fromisoformat(settimana))
        precedente = self.data.get("piano")
        bloccati = []
        if precedente and precedente.get("settimana") == lun.isoformat():
            # rigenerando la stessa settimana si tengono i pasti bloccati
            bloccati = [p for p in precedente["pasti"] if p.get("bloccato")]
        elif precedente:
            self.data["storico"] = [c for p in precedente["pasti"] for c in p.get("componenti", []) if c]
            self._archivia(precedente)
        pasti, avvisi = await self.hass.async_add_executor_job(
            planner.genera_settimana, self.lib, self.settings, lun, self.data["storico"], bloccati
        )
        self.data["piano"] = {
            "settimana": lun.isoformat(),
            "pasti": pasti,
            "avvisi": avvisi,
            "generato": dt_util.now().isoformat(),
        }
        await self._salva(piano_cambiato=True)

    def _richiedi_piano(self, idx: int) -> None:
        if not self.data.get("piano"):
            raise HomeAssistantError("Nessun menu: genera prima la settimana")
        if not 0 <= idx < len(self._pasti()):
            raise HomeAssistantError("Pasto non trovato")

    async def rigenera_pasto(self, idx: int) -> None:
        self._richiedi_piano(idx)
        self.data["piano"]["pasti"] = planner.rigenera_pasto(
            self.lib, self.settings, self._settimana(), self._pasti(), idx, self.data["storico"])
        await self._salva(piano_cambiato=True)

    async def rigenera_componente(self, idx: int, pos: int) -> None:
        self._richiedi_piano(idx)
        self.data["piano"]["pasti"] = planner.rigenera_componente(
            self.lib, self.settings, self._settimana(), self._pasti(), idx, pos, self.data["storico"])
        await self._salva(piano_cambiato=True)

    async def imposta_componente(self, idx: int, pos: int, comp_id: str) -> None:
        """Scelta manuale di un componente da parte dell'utente."""
        self._richiedi_piano(idx)
        if comp_id not in self.lib:
            raise HomeAssistantError("Piatto sconosciuto")
        pasto = self._pasti()[idx]
        if self.lib[comp_id]["cat"] == "unico":
            pasto["componenti"] = [comp_id]
        else:
            comps = list(pasto.get("componenti", []))
            if len(comps) == 1 and self.lib.get(comps[0], {}).get("cat") == "unico":
                comps = [None, None, None]
            pos = planner.CATEGORIE.index(self.lib[comp_id]["cat"])
            while len(comps) < 3:
                comps.append(None)
            comps[pos] = comp_id
            pasto["componenti"] = comps
        await self._salva(piano_cambiato=True)

    async def sposta(self, da: int, a: int) -> None:
        """Scambia due pasti (trascinamento): i piatti si spostano, le porzioni restano dello slot."""
        self._richiedi_piano(da)
        self._richiedi_piano(a)
        if da == a:
            return
        pasti = self._pasti()
        for campo in ("componenti", "bloccato"):
            pasti[da][campo], pasti[a][campo] = pasti[a].get(campo), pasti[da].get(campo)
        await self._salva(piano_cambiato=True)

    # ------------------------------------------------------------------ storico

    def _istantanea(self, piano: dict) -> dict:
        """Copia leggibile di una settimana: conserva i nomi anche se un piatto viene poi eliminato."""
        pasti = []
        for p in piano.get("pasti", []):
            info = planner.info_pasto(p, self.lib)
            pasti.append({
                "giorno": p["giorno"], "tipo": p["tipo"], "porzioni": p.get("porzioni", 1),
                "componenti": p.get("componenti", []),
                "titolo": info["titolo"], "minuti": info["minuti"], "costo": info["costo"],
                "dettagli": [{"id": d["id"], "nome": d["nome"], "cat": d["cat"]} for d in info["dettagli"]],
            })
        return {
            "settimana": piano["settimana"],
            "pasti": pasti,
            "conteggi": planner.conta_macro(piano.get("pasti", []), self.lib),
            "archiviato": dt_util.now().isoformat(),
        }

    def _archivia(self, piano: dict | None) -> None:
        if not piano or not piano.get("pasti"):
            return
        foto = self._istantanea(piano)
        arch = [w for w in self.data["archivio"] if w["settimana"] != foto["settimana"]]
        arch.insert(0, foto)
        arch.sort(key=lambda w: w["settimana"], reverse=True)
        self.data["archivio"] = arch[:MAX_ARCHIVIO]

    async def riusa(self, settimana_archivio: str) -> None:
        """Ripropone una settimana dello storico come menu della prossima settimana da cucinare."""
        vecchia = next((w for w in self.data["archivio"] if w["settimana"] == settimana_archivio), None)
        if not vecchia:
            raise HomeAssistantError("Settimana non trovata nello storico")
        lun = planner.settimana_predefinita(dt_util.now().date())
        attuale = self.data.get("piano")
        if attuale and attuale.get("settimana") != lun.isoformat():
            self._archivia(attuale)
        slots = planner.slot_settimana(self.settings)
        per_slot = {(p["giorno"], p["tipo"]): p for p in vecchia["pasti"]}
        pasti = []
        for sl in slots:
            src = per_slot.get((sl["giorno"], sl["tipo"]))
            comps = [c if c in self.lib else None for c in (src or {}).get("componenti", [])]
            pasti.append({**sl, "componenti": comps or [None, None, None], "bloccato": False})
        self.data["piano"] = {
            "settimana": lun.isoformat(), "pasti": pasti, "avvisi": [],
            "generato": dt_util.now().isoformat(), "da_storico": settimana_archivio,
        }
        await self._salva(piano_cambiato=True)

    async def elimina_archivio(self, settimana: str) -> None:
        self.data["archivio"] = [w for w in self.data["archivio"] if w["settimana"] != settimana]
        await self._salva()

    async def blocca(self, idx: int, bloccato: bool) -> None:
        self._richiedi_piano(idx)
        self._pasti()[idx]["bloccato"] = bool(bloccato)
        await self._salva()

    async def svuota(self) -> None:
        self.data["piano"] = None
        await self._salva(piano_cambiato=True)

    # ------------------------------------------------------------------ impostazioni e ricettario

    async def salva_impostazioni(self, nuove: dict) -> None:
        s = self.settings
        for k, v in nuove.items():
            if k in CAMPI_IMPOSTAZIONI:
                s[k] = v
        s["esclusi"] = sorted({str(e).strip().lower() for e in s.get("esclusi", []) if str(e).strip()})
        s["max_minuti"] = max(5, min(120, int(s["max_minuti"])))
        s["quota_piatti_unici"] = max(0.0, min(1.0, float(s["quota_piatti_unici"])))
        s["porzioni_pranzo"] = max(1, min(8, int(s["porzioni_pranzo"])))
        s["porzioni_cena"] = max(1, min(8, int(s["porzioni_cena"])))
        if s["budget"] not in planner.PESO_COSTO:
            s["budget"] = "economico"
        s["obiettivi"] = {k: max(0, min(10, int(round(float(v)))))
                          for k, v in {**planner.OBIETTIVI_DEFAULT, **(s.get("obiettivi") or {})}.items()
                          if k in planner.OBIETTIVI_DEFAULT}
        if not sum(s["obiettivi"].values()):
            s["obiettivi"] = dict(planner.OBIETTIVI_DEFAULT)
        s["giorni"] = sorted({int(g) for g in s.get("giorni", []) if 0 <= int(g) <= 6}) or [0, 1, 2, 3, 4]
        self.data["settings"] = s
        await self._salva()

    async def salva_componente(self, comp: dict) -> dict:
        nome = str(comp.get("nome", "")).strip()
        cat = comp.get("cat")
        if not nome or cat not in ("proteina", "carboidrato", "verdura", "unico"):
            raise HomeAssistantError("Servono almeno nome e categoria")
        cid = comp.get("id") or "p_" + (re.sub(r"[^a-z0-9]+", "_", planner.normalizza(nome)).strip("_")[:40] or "piatto")
        base, n = cid, 2
        if not comp.get("id"):
            while cid in self.lib:
                cid, n = f"{base}_{n}", n + 1
        pulito = {
            "id": cid,
            "nome": nome[:80],
            "cat": cat,
            "gruppo": comp.get("gruppo") or None,
            "minuti": max(0, min(180, int(comp.get("minuti") or 0))),
            "costo": max(1, min(3, int(comp.get("costo") or 1))),
            "asporto": comp.get("asporto") if comp.get("asporto") in ("freddo", "caldo", "no") else "no",
            "ingredienti": [
                ({"nome": str(i["nome"]).strip(), "dispensa": True} if i.get("dispensa") else
                 {"nome": str(i["nome"]).strip(), "q": float(i.get("q") or 0), "u": i.get("u") or "g"})
                for i in comp.get("ingredienti", []) if str(i.get("nome", "")).strip()
            ],
            "prep": str(comp.get("prep", ""))[:1000],
            "origine": comp.get("origine") if comp.get("origine") in ("gemini", "personale") else "personale",
        }
        if cat == "unico":
            pulito["gruppo_carbo"] = comp.get("gruppo_carbo") or "cereali"
        if comp.get("stagione"):
            pulito["stagione"] = sorted({int(m) for m in comp["stagione"] if 1 <= int(m) <= 12})
        self.data["custom"] = [c for c in self.data["custom"] if c["id"] != cid] + [pulito]
        self._ricostruisci()
        await self._salva()
        return pulito

    async def elimina_componente(self, cid: str) -> None:
        self.data["custom"] = [c for c in self.data["custom"] if c["id"] != cid]
        self._ricostruisci()
        await self._salva()

    async def attiva_componente(self, cid: str, attivo: bool) -> None:
        off = set(self.data["disabilitati"])
        (off.discard if attivo else off.add)(cid)
        self.data["disabilitati"] = sorted(off)
        self._ricostruisci()
        await self._salva()

    # ------------------------------------------------------------------ Gemini

    async def suggerisci(self, cat: str, quanti: int, per_asporto: bool) -> list[dict]:
        sett = self._settimana() or planner.settimana_predefinita(dt_util.now().date())
        try:
            return await gemini.suggerisci(
                async_get_clientsession(self.hass),
                self.opt(CONF_GEMINI_KEY, ""),
                self.opt(CONF_GEMINI_MODEL) or DEFAULT_GEMINI_MODEL,
                cat,
                max(1, min(8, int(quanti))),
                self.settings,
                (sett + timedelta(days=2)).month,
                [c["nome"] for c in self.lib.values()],
                per_asporto,
            )
        except gemini.GeminiError as err:
            raise HomeAssistantError(str(err)) from err

    # ------------------------------------------------------------------ lista della spesa

    async def invia_spesa(self) -> dict:
        if not self.data.get("piano"):
            raise HomeAssistantError("Nessun menu: genera prima la settimana")
        entity = self.todo_entity
        if self.hass.states.get(entity) is None:
            raise HomeAssistantError(
                f"La lista {entity} non esiste. Scegline una in Impostazioni → Dispositivi e servizi → "
                "Desco → Configura, oppure aggiungi l'integrazione «Lista della spesa».")
        voci = [v["testo"] for v in planner.lista_spesa(self._pasti(), self.lib)]

        resp = await self.hass.services.async_call(
            "todo", "get_items", {"status": ["needs_action"]},
            target={"entity_id": entity}, blocking=True, return_response=True,
        )
        presenti = {i.get("summary") for i in (resp or {}).get(entity, {}).get("items", [])}

        # toglie le voci inviate la volta precedente e non ancora spuntate
        vecchie = [v for v in self.data.get("spesa_inviata", []) if v in presenti and v not in voci]
        if vecchie:
            try:
                await self.hass.services.async_call(
                    "todo", "remove_item", {"item": vecchie}, target={"entity_id": entity}, blocking=True)
            except Exception as err:  # noqa: BLE001 - la lista potrebbe non supportarlo
                _LOGGER.debug("Rimozione voci precedenti non riuscita: %s", err)

        aggiunte = 0
        for voce in voci:
            if voce in presenti:
                continue
            await self.hass.services.async_call(
                "todo", "add_item", {"item": voce}, target={"entity_id": entity}, blocking=True)
            aggiunte += 1
        self.data["spesa_inviata"] = voci
        await self._salva()
        return {"aggiunte": aggiunte, "rimosse": len(vecchie), "totale": len(voci), "entity": entity}

    # ------------------------------------------------------------------ utilità per i sensori

    def oggi(self) -> date:
        return dt_util.now().date()

    @staticmethod
    def ora() -> datetime:
        return dt_util.now()
