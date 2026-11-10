"""Motore di pianificazione dei pasti di Desco.

Python puro, senza dipendenze da Home Assistant: si può testare da solo.

Un pasto è fatto da una proteina + un carboidrato + una verdura,
oppure da un "piatto unico" che copre tutte e tre le cose.
"""
from __future__ import annotations

import math
import random
import unicodedata
from datetime import date, timedelta
from typing import Any

CATEGORIE = ("proteina", "carboidrato", "verdura")
GIORNI = ("Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica")

# Gruppi proteici "fini" (usati nel ricettario) -> macro-gruppi su cui si
# impostano le proporzioni settimanali.
MACRO = {
    "legumi": "legumi",
    "pesce": "pesce",
    "carne_bianca": "carne",
    "carne_rossa": "carne",
    "uova": "uova",
    "latticini": "salumi_formaggi",
    "salumi": "salumi_formaggi",
}
MACRO_ORDINE = ("legumi", "pesce", "carne", "uova", "salumi_formaggi")

# Pasti a settimana per ciascun macro-gruppo. Salumi e formaggi sono l'ultima
# scelta: prendono solo i posti che restano dopo gli altri gruppi.
OBIETTIVI_DEFAULT = {"legumi": 3, "pesce": 3, "carne": 3, "uova": 1, "salumi_formaggi": 2}
MAX_CARNE_ROSSA = 1  # dentro la "carne", al massimo una volta a settimana

PESO_COSTO = {
    "economico": {1: 1.0, 2: 0.35, 3: 0.0},
    "normale": {1: 1.0, 2: 0.75, 3: 0.25},
    "libero": {1: 1.0, 2: 1.0, 3: 0.8},
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "esclusi": [],
    "max_minuti": 30,
    "budget": "economico",
    "microonde": True,
    "quota_piatti_unici": 0.3,
    "solo_stagione": True,
    "porzioni_pranzo": 1,
    "porzioni_cena": 2,
    "giorni": [0, 1, 2, 3, 4],
    "obiettivi": dict(OBIETTIVI_DEFAULT),
    "cene_doppie": 2,  # volte a settimana in cui la cena fa anche il pranzo del giorno dopo
    "pranzo_solo_tonno": True,  # a pranzo, come pesce, solo tonno in scatola
    "pranzo_niente_brodi": True,  # a pranzo niente zuppe, minestre e piatti brodosi
    "auto_genera": True,  # genera da solo il menu della settimana dopo
    "auto_giorno": 4,  # 0 = lunedì … 4 = venerdì
    "auto_ora": "21:00",
}


# --------------------------------------------------------------------------- utilità

def normalizza(testo: str) -> str:
    """Minuscolo e senza accenti, per confronti tolleranti."""
    testo = unicodedata.normalize("NFKD", str(testo or "")).encode("ascii", "ignore").decode()
    return " ".join(testo.lower().split())


def lunedi_di(giorno: date) -> date:
    return giorno - timedelta(days=giorno.weekday())


def settimana_predefinita(oggi: date) -> date:
    """Da lunedì a venerdì: settimana in corso. Sabato e domenica: la prossima."""
    if oggi.weekday() >= 5:
        return lunedi_di(oggi) + timedelta(days=7)
    return lunedi_di(oggi)


def unisci_impostazioni(settings: dict | None) -> dict:
    out = dict(DEFAULT_SETTINGS)
    out.update({k: v for k, v in (settings or {}).items() if v is not None})
    ob = dict(OBIETTIVI_DEFAULT)
    ob.update({k: max(0.0, float(v)) for k, v in (out.get("obiettivi") or {}).items() if k in OBIETTIVI_DEFAULT})
    out["obiettivi"] = ob
    return out


def macro_di(gruppo: str | None) -> str | None:
    return MACRO.get(gruppo, gruppo) if gruppo else None


ULTIMA_SCELTA = ("salumi_formaggi",)


def obiettivi_scalati(settings: dict, n_pasti: int) -> dict[str, float]:
    """Obiettivi adattati al numero di pasti.

    Prima si assegnano i gruppi principali (scalati in proporzione solo se da
    soli superano i pasti disponibili), poi salumi e formaggi ricevono i posti
    rimasti, fino al loro obiettivo.
    """
    ob = unisci_impostazioni(settings)["obiettivi"]
    principali = {k: v for k, v in ob.items() if k not in ULTIMA_SCELTA}
    tot = sum(principali.values())
    fattore = min(1.0, n_pasti / tot) if tot else 1.0
    out = {k: v * fattore for k, v in principali.items()}
    resto = max(0.0, n_pasti - sum(out.values()))
    for k in ULTIMA_SCELTA:
        out[k] = min(float(ob.get(k, 0)), resto)
        resto -= out[k]
    return out


# --------------------------------------------------------------------------- ricettario

REPARTI = [
    ("Frutta e verdura", ("insalata", "carot", "cipoll", "finocch", "cavol", "broccol", "verza", "radicch", "zucca",
                          "bieta", "carciof", "zucchin", "melanzan", "peperon", "pomodor", "cetriol", "rucola",
                          "limon", "aranc", "porri", "patat", "asparag", "spinacini")),
    ("Pane", ("pane", "piadin")),
    ("Carne e pesce", ("pollo", "tacchino", "manzo", "macinat", "hamburger", "salmone", "straccetti")),
    ("Banco frigo", ("uova", "mozzarell", "ricotta", "feta", "parmigian", "grana", "scamorz", "stracchin", "yogurt",
                     "prosciutt", "bresaol", "speck", "tofu", "gnocchi")),
    ("Surgelati", ("surgelat", "minestrone")),
]
ORDINE_REPARTI = ["Frutta e verdura", "Pane", "Carne e pesce", "Banco frigo", "Surgelati", "Scaffale"]
_PRIORITA = ("Banco frigo", "Carne e pesce", "Pane", "Frutta e verdura", "Surgelati")  # ordine di riconoscimento


def reparto_di(nome: str) -> str:
    n = normalizza(nome)
    if "surgelat" in n:
        return "Surgelati"
    if any(k in n for k in ("passata", "pelati", "in scatola", "olive", "salsa", "lessat", "pangrattato")):
        return "Scaffale"
    chiavi_di = dict(REPARTI)
    for rep in _PRIORITA:
        if any(k in n for k in chiavi_di[rep]):
            return rep
    return "Scaffale"


def in_dispensa(nome: str, dispensa: list[str] | None) -> bool:
    """Un ingrediente è in casa se il suo nome contiene una voce della dispensa (o viceversa)."""
    n = normalizza(nome)
    return any(d and (d in n or n in d) for d in (normalizza(x) for x in (dispensa or [])))


def costruisci_libreria(builtin: list[dict], custom: list[dict], disabilitati: list[str],
                        voti: dict[str, int] | None = None, dispensa: list[str] | None = None) -> dict[str, dict]:
    """Unisce componenti integrati e personali; i personali sovrascrivono a parità di id."""
    lib: dict[str, dict] = {}
    for comp in builtin:
        lib[comp["id"]] = {**comp, "origine": "integrato"}
    for comp in custom:
        lib[comp["id"]] = {**comp, "origine": comp.get("origine", "personale")}
    off = set(disabilitati or [])
    voti = voti or {}
    for cid, comp in lib.items():
        comp["attivo"] = cid not in off
        comp["voto"] = int(voti.get(cid, 0))
        comp["usa_dispensa"] = bool(dispensa) and any(
            in_dispensa(i.get("nome", ""), dispensa) for i in comp.get("ingredienti", []) if not i.get("dispensa"))
    return lib


def _contiene_escluso(comp: dict, esclusi_norm: list[str]) -> bool:
    if not esclusi_norm:
        return False
    testi = [normalizza(comp.get("nome", ""))]
    testi += [normalizza(i.get("nome", "")) for i in comp.get("ingredienti", [])]
    return any(term and term in t for term in esclusi_norm for t in testi)


def copre(comp: dict) -> tuple[str, ...]:
    return CATEGORIE if comp.get("cat") == "unico" else (comp.get("cat"),)


def gruppo_proteico(comp: dict) -> str | None:
    if comp.get("cat") in ("proteina", "unico"):
        return comp.get("gruppo")
    return None


def gruppo_carboidrato(comp: dict) -> str | None:
    if comp.get("cat") == "carboidrato":
        return comp.get("gruppo")
    if comp.get("cat") == "unico":
        return comp.get("gruppo_carbo")
    return None


def pesce_ok_a_pranzo(comp: dict, settings: dict | None) -> bool:
    """Regole extra per il pranzo da portare: niente brodi e, come pesce, solo tonno."""
    st = unisci_impostazioni(settings)
    if comp.get("brodoso") and st.get("pranzo_niente_brodi", True):
        return False
    if not st.get("pranzo_solo_tonno", True):
        return True
    if gruppo_proteico(comp) != "pesce":
        return True
    return any("tonno" in normalizza(i.get("nome", "")) for i in comp.get("ingredienti", []))


def asporto_ok(comp: dict, microonde: bool) -> bool:
    modo = comp.get("asporto", "no")
    return modo == "freddo" or (modo == "caldo" and microonde)


def filtro_base(lib: dict[str, dict], settings: dict, mese: int, rilassa_stagione: bool = False) -> dict[str, dict]:
    """Componenti utilizzabili in assoluto (prima dei vincoli del singolo pasto)."""
    esclusi = [normalizza(e) for e in settings.get("esclusi", []) if str(e).strip()]
    max_min = int(settings.get("max_minuti") or 999)
    pesi = PESO_COSTO.get(settings.get("budget", "economico"), PESO_COSTO["normale"])
    out = {}
    for cid, comp in lib.items():
        if not comp.get("attivo", True) or comp.get("voto", 0) < 0:
            continue
        if _contiene_escluso(comp, esclusi):
            continue
        if int(comp.get("minuti", 0)) > max_min:
            continue
        if pesi.get(int(comp.get("costo", 1)), 0) <= 0:
            continue
        stagione = comp.get("stagione")
        if stagione and settings.get("solo_stagione", True) and not rilassa_stagione and mese not in stagione:
            continue
        out[cid] = comp
    return out


# --------------------------------------------------------------------------- piano

def slot_settimana(settings: dict) -> list[dict]:
    slots = []
    for g in sorted(settings.get("giorni", [0, 1, 2, 3, 4])):
        slots.append({"giorno": g, "tipo": "pranzo", "porzioni": int(settings.get("porzioni_pranzo", 1))})
        slots.append({"giorno": g, "tipo": "cena", "porzioni": int(settings.get("porzioni_cena", 2))})
    return slots


class Pianificatore:
    def __init__(self, lib: dict[str, dict], settings: dict | None, settimana: date,
                 storico: list[str] | None = None, rng: random.Random | None = None) -> None:
        self.lib = lib
        self.settings = unisci_impostazioni(settings)
        self.settimana = settimana
        # verdure di stagione: si guarda il mercoledì della settimana
        self.mese = (settimana + timedelta(days=2)).month
        self.storico = set(storico or [])
        self.rng = rng or random.Random()
        self.base = filtro_base(lib, self.settings, self.mese)
        self.base_fuori_stagione = filtro_base(lib, self.settings, self.mese, rilassa_stagione=True)
        self.pesi_costo = PESO_COSTO.get(self.settings.get("budget", "economico"), PESO_COSTO["normale"])
        self.avvisi: list[str] = []
        self.obiettivi = obiettivi_scalati(self.settings, len(slot_settimana(self.settings)))

    # ---- stato derivato dal piano

    def _usati(self, pasti: list[dict], escludi_idx: int | None = None) -> list[str]:
        out = []
        for i, p in enumerate(pasti):
            if i == escludi_idx or not p:
                continue
            out += [c for c in p.get("componenti", []) if c]
        return out

    def _gruppi_proteici(self, pasti: list[dict], escludi_idx: int | None = None) -> dict[str, int]:
        cont: dict[str, int] = {}
        for i, p in enumerate(pasti):
            if i == escludi_idx or not p:
                continue
            for cid in p.get("componenti", []):
                g = gruppo_proteico(self.lib.get(cid, {}))
                if g:
                    m = macro_di(g)
                    cont[m] = cont.get(m, 0) + 1
                    if g == "carne_rossa":
                        cont["_carne_rossa"] = cont.get("_carne_rossa", 0) + 1
        return cont

    def _gruppi_del_pasto(self, pasto: dict | None) -> tuple[set, set]:
        prot, carb = set(), set()
        if not pasto:
            return prot, carb
        for cid in pasto.get("componenti", []):
            comp = self.lib.get(cid, {})
            if gruppo_proteico(comp):
                prot.add(macro_di(gruppo_proteico(comp)))
            if gruppo_carboidrato(comp):
                carb.add(gruppo_carboidrato(comp))
        return prot, carb

    def _vicini(self, pasti: list[dict], idx: int) -> list[dict]:
        """Pasti dello stesso giorno + cena del giorno prima/dopo (per variare)."""
        me = pasti[idx]
        out = []
        for i, p in enumerate(pasti):
            if i == idx or not p:
                continue
            if p["giorno"] == me["giorno"]:
                out.append(p)
            elif abs(p["giorno"] - me["giorno"]) == 1 and p["tipo"] == me["tipo"]:
                out.append(p)
        return out

    # ---- scelta

    def _peso(self, comp: dict, gruppi_prot: dict[str, int], n_slot: int, usati: list[str]) -> float:
        peso = self.pesi_costo.get(int(comp.get("costo", 1)), 0.5)
        g = gruppo_proteico(comp)
        if g:
            m = macro_di(g)
            obiettivo = self.obiettivi.get(m, 0.0)
            residuo = obiettivo - gruppi_prot.get(m, 0)
            # forte preferenza per i gruppi ancora "sotto obiettivo"
            peso *= max(0.03, residuo) ** 1.5 + 0.02
            if g == "carne_rossa" and gruppi_prot.get("_carne_rossa", 0) >= MAX_CARNE_ROSSA:
                peso *= 0.02
        if comp.get("voto", 0) > 0:
            peso *= 2.0
        if comp.get("usa_dispensa"):
            peso *= 1.8  # usa quello che c'è già in casa
        # di stagione: preferiti rispetto a quelli "tutto l'anno" (spesso surgelati)
        stagione = comp.get("stagione")
        if stagione and self.mese in stagione and self.settings.get("solo_stagione", True):
            peso *= 2.5
        if comp["id"] in self.storico:
            peso *= 0.45
        if comp["id"] in usati:
            peso *= 0.05
        # leggera preferenza per le cose più veloci
        peso *= 1.0 + max(0, 30 - int(comp.get("minuti", 0))) / 60.0
        return peso

    def _scegli(self, candidati: list[dict], pesi: list[float]) -> dict | None:
        tot = sum(pesi)
        if not candidati or tot <= 0:
            return None
        return self.rng.choices(candidati, weights=pesi, k=1)[0]

    def _candidati(self, cat: str | None, slot: dict, pasti: list[dict], idx: int,
                   gia_nel_pasto: list[str], livello: int) -> list[dict]:
        """livello 0 = vincoli pieni; 1 = ammette ripetizioni; 2 = ammette stessi gruppi; 3 = fuori stagione."""
        sorgente = self.base_fuori_stagione if livello >= 3 else self.base
        usati = self._usati(pasti, idx)
        vietati_prot, vietati_carb = set(), set()
        if livello < 2:
            for v in self._vicini(pasti, idx):
                stesso_giorno = v["giorno"] == slot["giorno"]
                p, c = self._gruppi_del_pasto(v)
                vietati_prot |= p
                if stesso_giorno:
                    vietati_carb |= c
        out = []
        for comp in sorgente.values():
            if cat == "unico":
                if comp.get("cat") != "unico":
                    continue
            elif comp.get("cat") != cat:
                continue
            if comp["id"] in gia_nel_pasto:
                continue
            if slot["tipo"] == "pranzo" and not asporto_ok(comp, bool(self.settings.get("microonde", True))):
                continue
            if slot["tipo"] == "pranzo" and not pesce_ok_a_pranzo(comp, self.settings):
                continue
            if livello < 1 and comp["id"] in usati:
                continue
            if macro_di(gruppo_proteico(comp)) in vietati_prot:
                continue
            if gruppo_carboidrato(comp) in vietati_carb:
                continue
            out.append(comp)
        return out

    def scegli_componente(self, cat: str, pasti: list[dict], idx: int, gia_nel_pasto: list[str],
                          escludi_ids: list[str] | None = None) -> dict | None:
        slot = pasti[idx]
        n_slot = len(pasti)
        for livello in range(4):
            cand = [c for c in self._candidati(cat, slot, pasti, idx, gia_nel_pasto, livello)
                    if c["id"] not in (escludi_ids or [])]
            if not cand:
                continue
            gruppi = self._gruppi_proteici(pasti, idx)
            usati = self._usati(pasti, idx)
            scelta = self._scegli(cand, [self._peso(c, gruppi, n_slot, usati) for c in cand])
            if scelta:
                return scelta
        return None

    def componi_pasto(self, pasti: list[dict], idx: int) -> dict:
        slot = pasti[idx]
        provvisorio = {**slot, "componenti": []}
        pasti[idx] = provvisorio
        quota = float(self.settings.get("quota_piatti_unici", 0.3))
        if self.rng.random() < quota:
            unico = self.scegli_componente("unico", pasti, idx, [])
            if unico:
                provvisorio["componenti"] = [unico["id"]]
                return provvisorio
        for cat in CATEGORIE:
            comp = self.scegli_componente(cat, pasti, idx, provvisorio["componenti"])
            if comp:
                provvisorio["componenti"].append(comp["id"])
            else:
                provvisorio["componenti"].append(None)
                self.avvisi.append(
                    f"{GIORNI[slot['giorno']]} {slot['tipo']}: nessun/a {cat} compatibile con le preferenze"
                )
        return provvisorio

    def genera(self, bloccati: list[dict] | None = None) -> list[dict]:
        slots = slot_settimana(self.settings)
        pasti: list[dict | None] = [None] * len(slots)
        bloccati_map = {(b["giorno"], b["tipo"]): b for b in (bloccati or []) if b.get("bloccato")}
        for i, s in enumerate(slots):
            b = bloccati_map.get((s["giorno"], s["tipo"]))
            if b:
                pasti[i] = {**s, "componenti": list(b.get("componenti", [])), "bloccato": True}
        # ordine casuale dei pasti da riempire: evita che il lunedì prenda sempre il meglio
        da_fare = [i for i, p in enumerate(pasti) if p is None]
        # i pranzi hanno più vincoli (asporto): prima loro
        self.rng.shuffle(da_fare)
        da_fare.sort(key=lambda i: 0 if slots[i]["tipo"] == "pranzo" else 1)
        for i in da_fare:
            pasti[i] = {**slots[i], "componenti": []}
        for i in da_fare:
            self.componi_pasto(pasti, i)
            pasti[i]["bloccato"] = False
        return pasti  # type: ignore[return-value]


def conta_macro(pasti: list[dict], lib: dict[str, dict]) -> dict[str, int]:
    cont: dict[str, int] = {}
    for p in pasti:
        for cid in p.get("componenti", []):
            g = gruppo_proteico(lib.get(cid, {})) if cid else None
            if g:
                m = macro_di(g)
                cont[m] = cont.get(m, 0) + 1
    return cont


def punteggio_piano(pasti: list[dict], lib: dict[str, dict], settings: dict | None = None) -> float:
    """Più basso è meglio: penalizza ripetizioni e scostamenti dalle proporzioni."""
    pen = 0.0
    visti: dict[str, int] = {}
    rosse = 0
    for p in pasti:
        for cid in p.get("componenti", []):
            if cid is None:
                pen += 50
                continue
            visti[cid] = visti.get(cid, 0) + 1
            if gruppo_proteico(lib.get(cid, {})) == "carne_rossa":
                rosse += 1
    pen += sum((n - 1) * 8 for n in visti.values() if n > 1)
    cont = conta_macro(pasti, lib)
    for m, obiettivo in obiettivi_scalati(settings or {}, len(pasti)).items():
        pen += abs(cont.get(m, 0) - obiettivo) * 4
    pen += max(0, rosse - MAX_CARNE_ROSSA) * 10
    return pen


def genera_settimana(lib: dict[str, dict], settings: dict | None, settimana: date,
                     storico: list[str] | None = None, bloccati: list[dict] | None = None,
                     tentativi: int = 40, seed: int | None = None) -> tuple[list[dict], list[str]]:
    """Genera più piani e tiene il migliore. Ritorna (pasti, avvisi)."""
    rng = random.Random(seed)
    migliore, avvisi_m, pen_m = None, [], math.inf
    for _ in range(tentativi):
        pian = Pianificatore(lib, settings, settimana, storico, random.Random(rng.random()))
        pasti = pian.genera(bloccati)
        pen = punteggio_piano(pasti, lib, settings)
        if pen < pen_m:
            migliore, avvisi_m, pen_m = pasti, pian.avvisi, pen
    pasti = applica_cene_doppie(migliore or [], lib, settings)
    return pasti, sorted(set(avvisi_m))


def rigenera_pasto(lib: dict[str, dict], settings: dict | None, settimana: date, pasti: list[dict],
                   idx: int, storico: list[str] | None = None) -> list[dict]:
    pasti = [dict(p) for p in pasti]
    vecchi = list(pasti[idx].get("componenti", []))
    pian = Pianificatore(lib, settings, settimana, storico)
    for _ in range(6):
        pian.componi_pasto(pasti, idx)
        if pasti[idx]["componenti"] != vecchi:
            break
    pasti[idx]["bloccato"] = False
    return pasti


def rigenera_componente(lib: dict[str, dict], settings: dict | None, settimana: date, pasti: list[dict],
                        idx: int, pos: int, storico: list[str] | None = None) -> list[dict]:
    """Sostituisce un solo componente (es. solo la verdura) lasciando gli altri."""
    pasti = [dict(p) for p in pasti]
    pasto = pasti[idx]
    comps = list(pasto.get("componenti", []))
    attuale = lib.get(comps[pos]) if 0 <= pos < len(comps) and comps[pos] else None
    if attuale and attuale.get("cat") == "unico":
        return rigenera_pasto(lib, settings, settimana, pasti, idx, storico)
    cat = attuale.get("cat") if attuale else CATEGORIE[pos] if pos < 3 else "verdura"
    pian = Pianificatore(lib, settings, settimana, storico)
    altri = [c for j, c in enumerate(comps) if j != pos and c]
    tmp = {**pasto, "componenti": altri}
    pasti[idx] = tmp
    nuovo = pian.scegli_componente(cat, pasti, idx, altri, escludi_ids=[comps[pos]] if attuale else None)
    comps[pos] = nuovo["id"] if nuovo else comps[pos]
    pasti[idx] = {**pasto, "componenti": comps}
    return pasti


# --------------------------------------------------------------------------- cucinare una volta, mangiare due

def _per_slot(pasti: list[dict]) -> dict[tuple[int, str], dict]:
    return {(p["giorno"], p["tipo"]): p for p in pasti}


def applica_cene_doppie(pasti: list[dict], lib: dict[str, dict], settings: dict | None) -> list[dict]:
    """Fa coincidere un contorno (carboidrato o verdura) della cena con il pranzo del giorno dopo.

    Si cucina il doppio a cena e una porzione va nel contenitore di Linda.
    Le proteine non si toccano, così le proporzioni settimanali restano uguali.
    """
    st = unisci_impostazioni(settings)
    massimo = int(st.get("cene_doppie", 2) or 0)
    if massimo <= 0:
        return pasti
    pasti = [dict(p, componenti=list(p.get("componenti", []))) for p in pasti]
    slot = _per_slot(pasti)
    fatte = 0
    for g in sorted({p["giorno"] for p in pasti}):
        if fatte >= massimo:
            break
        cena, pranzo, cena_dopo = slot.get((g, "cena")), slot.get((g + 1, "pranzo")), slot.get((g + 1, "cena"))
        if not cena or not pranzo or pranzo.get("bloccato"):
            continue
        if any(lib.get(c, {}).get("cat") == "unico" for c in cena["componenti"] + pranzo["componenti"] if c):
            continue
        if len(pranzo["componenti"]) != 3:
            continue
        carb_dopo = {gruppo_carboidrato(lib.get(c, {})) for c in (cena_dopo or {}).get("componenti", []) if c}
        for cat in ("carboidrato", "verdura"):
            pos = CATEGORIE.index(cat)
            src = next((lib[c] for c in cena["componenti"] if c and lib.get(c, {}).get("cat") == cat), None)
            if (not src or not src.get("anticipo") or not asporto_ok(src, bool(st.get("microonde", True)))
                    or not pesce_ok_a_pranzo(src, st)):
                continue
            if cat == "carboidrato" and gruppo_carboidrato(src) in carb_dopo:
                continue
            if pranzo["componenti"][pos] == src["id"]:
                break
            pranzo["componenti"][pos] = src["id"]
            fatte += 1
            break
    return pasti


def legami_avanzi(pasti: list[dict]) -> dict[tuple[int, int], str]:
    """Per ogni (idx pasto, posizione) indica "doppio" (cena da cucinare doppia) o "avanzo" (pranzo dal giorno prima)."""
    out: dict[tuple[int, int], str] = {}
    idx = {(p["giorno"], p["tipo"]): i for i, p in enumerate(pasti)}
    for i, p in enumerate(pasti):
        if p["tipo"] != "pranzo":
            continue
        j = idx.get((p["giorno"] - 1, "cena"))
        if j is None:
            continue
        cena = pasti[j].get("componenti", [])
        for pos, cid in enumerate(p.get("componenti", [])):
            if cid and cid in cena:
                out[(i, pos)] = "avanzo"
                out[(j, cena.index(cid))] = "doppio"
    return out


def preparazioni(pasti: list[dict], lib: dict[str, dict]) -> list[dict]:
    """Cosa si può preparare in anticipo: domenica per lun-mer, mercoledì sera per gio-ven."""
    legami = legami_avanzi(pasti)
    voci: dict[tuple[str, str], dict] = {}
    for i, p in enumerate(pasti):
        sessione = "domenica" if p["giorno"] <= 2 else "mercoledi"
        for pos, cid in enumerate(p.get("componenti", [])):
            comp = lib.get(cid) if cid else None
            if not comp or not comp.get("anticipo") or int(comp.get("minuti", 0)) < 10:
                continue
            if legami.get((i, pos)):
                continue  # si cucina doppio a cena per il pranzo del giorno dopo
            porz = int(p.get("porzioni", 1))
            v = voci.setdefault((sessione, cid), {"id": cid, "nome": comp["nome"], "cat": comp.get("cat"), "sessione": sessione,
                                                 "porzioni": 0, "pasti": [], "minuti": comp.get("minuti", 0)})
            v["porzioni"] += porz
            v["pasti"].append(f"{GIORNI[p['giorno']][:3]} {p['tipo']}")
    return sorted(voci.values(), key=lambda v: (v["sessione"] != "domenica", -v["minuti"]))




def info_pasto(pasto: dict, lib: dict[str, dict]) -> dict:
    """Dettagli leggibili di un pasto; "dettagli" è allineato a "componenti" (posizioni)."""
    dettagli = []
    for i, cid in enumerate(pasto.get("componenti", [])):
        comp = lib.get(cid) if cid else None
        if comp:
            dettagli.append({"id": comp["id"], "nome": comp["nome"], "cat": comp["cat"],
                             "minuti": comp.get("minuti", 0), "costo": comp.get("costo", 1),
                             "asporto": comp.get("asporto", "no"), "prep": comp.get("prep", ""),
                             "ingredienti": comp.get("ingredienti", [])})
        else:
            dettagli.append({"id": None, "nome": "Da scegliere", "cat": CATEGORIE[i] if i < 3 else "verdura",
                             "minuti": 0, "costo": 1, "prep": "", "ingredienti": []})
    validi = [d for d in dettagli if d["id"]]
    return {
        "titolo": " · ".join(d["nome"] for d in validi) or "—",
        "minuti": max([int(d["minuti"]) for d in validi] or [0]),
        "costo": max([int(d["costo"]) for d in validi] or [1]),
        "dettagli": dettagli,
    }


def _fmt_quantita(q: float, u: str) -> str:
    if u == "g" and q >= 1000:
        return f"{q / 1000:.1f}".replace(".", ",").replace(",0", "") + " kg"
    if u == "ml" and q >= 1000:
        return f"{q / 1000:.1f}".replace(".", ",").replace(",0", "") + " l"
    if u == "pz":
        n = math.ceil(q - 1e-9)
        return f"{n} pz"
    if u in ("g", "ml"):
        # arrotonda a 10 g per numeri leggibili
        return f"{int(math.ceil(q / 10.0) * 10)} {u}"
    return f"{q:g} {u}".strip()


def lista_spesa(pasti: list[dict], lib: dict[str, dict], esclusi_dispensa: bool = True,
                dispensa: list[str] | None = None) -> list[dict]:
    tot: dict[tuple[str, str], dict] = {}
    for p in pasti:
        porz = int(p.get("porzioni", 1))
        for cid in p.get("componenti", []):
            comp = lib.get(cid) if cid else None
            if not comp:
                continue
            for ing in comp.get("ingredienti", []):
                if ing.get("dispensa") and esclusi_dispensa:
                    continue
                nome = str(ing.get("nome", "")).strip()
                if not nome:
                    continue
                u = ing.get("u", "")
                chiave = (normalizza(nome), u)
                voce = tot.setdefault(chiave, {"nome": nome, "u": u, "q": 0.0})
                voce["q"] += float(ing.get("q", 0) or 0) * porz
    out = []
    for voce in tot.values():
        q = _fmt_quantita(voce["q"], voce["u"]) if voce["q"] else ""
        nome = voce["nome"][:1].upper() + voce["nome"][1:]
        rep = reparto_di(voce["nome"])
        out.append({"nome": nome, "quantita": q, "testo": f"{nome} ({q})" if q else nome,
                    "reparto": rep, "in_casa": in_dispensa(voce["nome"], dispensa)})
    out.sort(key=lambda v: (ORDINE_REPARTI.index(v["reparto"]), normalizza(v["nome"])))
    return out
