"""Suggerimenti opzionali di nuovi piatti tramite Google Gemini (piano gratuito)."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

GRUPPI = {
    "proteina": ["legumi", "pesce", "carne_bianca", "carne_rossa", "uova", "latticini", "salumi"],
    "carboidrato": ["pasta", "riso", "cereali", "pane", "patate"],
    "verdura": ["cruda", "cotta"],
}
NOMI_CAT = {
    "proteina": "una fonte proteica (secondo)",
    "carboidrato": "un contorno di carboidrati (pasta, riso, cereali, pane, patate)",
    "verdura": "un contorno di verdura",
    "unico": "un piatto unico che contiene già proteina, carboidrato e verdura",
}


class GeminiError(Exception):
    """Errore nella chiamata a Gemini."""


def _slug(testo: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", testo.lower()).strip("_")
    return s[:40] or "piatto"


def _prompt(cat: str, quanti: int, settings: dict, mese: int, esistenti: list[str], per_asporto: bool) -> str:
    esclusi = ", ".join(settings.get("esclusi", [])) or "nessuno"
    budget = {"economico": "molto economico", "normale": "economico", "libero": "qualsiasi"}.get(
        settings.get("budget", "economico"), "economico")
    gruppi = GRUPPI.get(cat, GRUPPI["proteina"])
    asporto = (
        "Devono essere adatti a un pranzo da portare al lavoro in un contenitore "
        + ("(c'è il microonde)." if settings.get("microonde", True) else "(NON c'è il microonde: solo cose buone fredde).")
        if per_asporto else "Sono per la cena a casa."
    )
    return f"""Sei un cuoco italiano pratico. Proponi {quanti} idee NUOVE di {NOMI_CAT.get(cat, cat)} per pasti di tutti i giorni.
Vincoli:
- facili e veloci: al massimo {settings.get('max_minuti', 30)} minuti di preparazione;
- costo {budget}, ingredienti da supermercato italiano;
- di stagione nel mese numero {mese};
- non usare mai questi alimenti: {esclusi};
- {asporto}
- diversi da questi piatti già presenti: {', '.join(esistenti[:150])}.
Quantità degli ingredienti PER UNA PERSONA, in g, ml o pz. Olio, sale, spezie ed erbe vanno marcati "dispensa": true senza quantità.
Rispondi SOLO con un array JSON di oggetti con questi campi:
{{"nome": str, "gruppo": uno tra {gruppi}{', "gruppo_carbo": uno tra ' + str(GRUPPI['carboidrato']) if cat == 'unico' else ''},
 "minuti": int, "costo": 1|2|3, "asporto": "freddo"|"caldo"|"no",
 "ingredienti": [{{"nome": str, "q": number, "u": "g"|"ml"|"pz"}} oppure {{"nome": str, "dispensa": true}}],
 "prep": "istruzioni in 1-2 frasi"}}"""


def _pulisci(raw: Any, cat: str) -> dict | None:
    if not isinstance(raw, dict) or not str(raw.get("nome", "")).strip():
        return None
    gruppi = GRUPPI.get("proteina" if cat == "unico" else cat, [])
    gruppo = raw.get("gruppo") if raw.get("gruppo") in gruppi else (gruppi[0] if gruppi else None)
    ingr = []
    for i in raw.get("ingredienti", []) or []:
        if not isinstance(i, dict) or not str(i.get("nome", "")).strip():
            continue
        if i.get("dispensa"):
            ingr.append({"nome": str(i["nome"]).strip().lower(), "dispensa": True})
            continue
        try:
            q = float(i.get("q", 0))
        except (TypeError, ValueError):
            q = 0
        u = i.get("u") if i.get("u") in ("g", "ml", "pz") else "g"
        ingr.append({"nome": str(i["nome"]).strip().lower(), "q": round(q, 2), "u": u})
    nome = str(raw["nome"]).strip()
    comp = {
        "id": "g_" + _slug(nome),
        "nome": nome[:80],
        "cat": cat,
        "gruppo": gruppo,
        "minuti": max(0, min(120, int(raw.get("minuti", 15) or 15))),
        "costo": max(1, min(3, int(raw.get("costo", 1) or 1))),
        "asporto": raw.get("asporto") if raw.get("asporto") in ("freddo", "caldo", "no") else "no",
        "ingredienti": ingr,
        "prep": str(raw.get("prep", ""))[:500],
        "origine": "gemini",
    }
    if cat == "unico":
        comp["gruppo_carbo"] = raw.get("gruppo_carbo") if raw.get("gruppo_carbo") in GRUPPI["carboidrato"] else "cereali"
    return comp


async def suggerisci(session: aiohttp.ClientSession, api_key: str, model: str, cat: str, quanti: int,
                     settings: dict, mese: int, esistenti: list[str], per_asporto: bool) -> list[dict]:
    if not api_key:
        raise GeminiError("Chiave API di Gemini non configurata (Impostazioni → Integrazioni → Desco → Configura).")
    body = {
        "contents": [{"role": "user", "parts": [{"text": _prompt(cat, quanti, settings, mese, esistenti, per_asporto)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.9},
    }
    try:
        async with session.post(
            API_URL.format(model=model),
            params={"key": api_key},
            json=body,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status != 200:
                msg = (data or {}).get("error", {}).get("message", f"HTTP {resp.status}")
                raise GeminiError(f"Gemini: {msg}")
    except aiohttp.ClientError as err:
        raise GeminiError(f"Gemini non raggiungibile: {err}") from err
    try:
        testo = data["candidates"][0]["content"]["parts"][0]["text"]
        lista = json.loads(testo)
    except (KeyError, IndexError, ValueError, TypeError) as err:
        _LOGGER.debug("Risposta Gemini non valida: %s", data)
        raise GeminiError("Risposta di Gemini non leggibile, riprova.") from err
    if isinstance(lista, dict):
        lista = lista.get("piatti") or lista.get("items") or [lista]
    out = [c for c in (_pulisci(x, cat) for x in lista) if c]
    return out[:quanti]


def _prompt_ricetta(dettagli: list[dict], porzioni: int, per_asporto: bool, microonde: bool, avanzi: list[str]) -> str:
    righe = []
    for d in dettagli:
        ingr = ", ".join(
            i["nome"] if i.get("dispensa") else f"{i['nome']} {round(float(i.get('q', 0)) * porzioni, 1):g} {i.get('u', '')}"
            for i in d.get("ingredienti", [])
        )
        righe.append(f"- {d['nome']}: {ingr}. Note: {d.get('prep', '')}")
    contesto = (
        "È il pranzo di una persona da portare al lavoro in un contenitore"
        + (" (al lavoro c'è il microonde)." if microonde else " (niente microonde: va mangiato freddo).")
        if per_asporto else f"È la cena a casa per {porzioni} persone."
    )
    extra = f"\nQueste parti sono avanzi già cucinati la sera prima, vanno solo porzionati: {', '.join(avanzi)}." if avanzi else ""
    return f"""Sei un cuoco italiano pratico. Scrivi UNA ricetta unica e completa per questo pasto, per {porzioni} porzione/i.
{contesto}{extra}
Componenti del pasto:
{chr(10).join(righe)}
Organizza il lavoro per finire prima possibile: indica cosa avviare per primo e cosa fare in parallelo.
Rispondi SOLO con un oggetto JSON:
{{"tempo_totale": minuti (int),
 "ingredienti": ["quantità + ingrediente", ...],
 "passaggi": ["passaggio 1", "passaggio 2", ...],
 "contenitore": "come sistemare il pasto nel contenitore e come scaldarlo" oppure null se è la cena,
 "consigli": "un consiglio breve"}}"""


async def ricetta_pasto(session: aiohttp.ClientSession, api_key: str, model: str, dettagli: list[dict],
                       porzioni: int, per_asporto: bool, microonde: bool, avanzi: list[str]) -> dict:
    if not api_key:
        raise GeminiError("Chiave API di Gemini non configurata (Impostazioni → Dispositivi e servizi → Desco → Configura).")
    body = {
        "contents": [{"role": "user", "parts": [{"text": _prompt_ricetta(dettagli, porzioni, per_asporto, microonde, avanzi)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.4},
    }
    try:
        async with session.post(API_URL.format(model=model), params={"key": api_key}, json=body,
                                timeout=aiohttp.ClientTimeout(total=90)) as resp:
            data = await resp.json(content_type=None)
            if resp.status != 200:
                raise GeminiError(f"Gemini: {(data or {}).get('error', {}).get('message', f'HTTP {resp.status}')}")
    except aiohttp.ClientError as err:
        raise GeminiError(f"Gemini non raggiungibile: {err}") from err
    try:
        r = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
        if isinstance(r, list):
            r = r[0]
    except (KeyError, IndexError, ValueError, TypeError) as err:
        raise GeminiError("Risposta di Gemini non leggibile, riprova.") from err
    testo = lambda x: str(x).strip()[:600]  # noqa: E731
    return {
        "tempo_totale": int(r.get("tempo_totale") or 0) if str(r.get("tempo_totale", "")).isdigit() else None,
        "ingredienti": [testo(i) for i in (r.get("ingredienti") or [])][:30],
        "passaggi": [testo(p) for p in (r.get("passaggi") or [])][:20],
        "contenitore": testo(r["contenitore"]) if r.get("contenitore") else None,
        "consigli": testo(r.get("consigli") or ""),
    }
