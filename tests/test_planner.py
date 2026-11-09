"""Test del motore dei pasti (Python puro, senza Home Assistant)."""
import importlib.util
import json
import random
from datetime import date
from pathlib import Path

import pytest

BASE = Path(__file__).resolve().parents[1] / "custom_components" / "desco"
spec = importlib.util.spec_from_file_location("desco_planner", BASE / "planner.py")
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

RICETTARIO = json.loads((BASE / "data" / "ricettario.json").read_text(encoding="utf-8"))["componenti"]
NOVEMBRE = date(2026, 11, 9)


def lib(**kw):
    return P.costruisci_libreria(RICETTARIO, [], [], **kw)


def test_ricettario_valido():
    ids = [c["id"] for c in RICETTARIO]
    assert len(ids) == len(set(ids)), "id duplicati"
    for c in RICETTARIO:
        assert c["cat"] in ("proteina", "carboidrato", "verdura", "unico")
        assert c["asporto"] in ("freddo", "caldo", "no")
        assert 1 <= c["costo"] <= 3
        for i in c["ingredienti"]:
            assert i.get("dispensa") or i.get("u") in ("g", "ml", "pz")


@pytest.mark.parametrize("seed", range(20))
def test_settimana_completa_e_varia(seed):
    L = lib()
    pasti, avvisi = P.genera_settimana(L, {}, NOVEMBRE, seed=seed, tentativi=20)
    assert len(pasti) == 10
    assert not avvisi
    for p in pasti:
        assert all(p["componenti"]), p
        cats = {L[c]["cat"] for c in p["componenti"]}
        assert cats == {"unico"} or cats == {"proteina", "carboidrato", "verdura"}
        if p["tipo"] == "pranzo":  # Linda se lo porta al lavoro (con microonde di default)
            assert all(P.asporto_ok(L[c], True) for c in p["componenti"])


@pytest.mark.parametrize("seed", range(10))
def test_proporzioni_esatte_quando_sommano_ai_pasti(seed):
    st = {"obiettivi": {"legumi": 3, "pesce": 2, "carne": 3, "uova": 1, "salumi_formaggi": 1}}
    pasti, _ = P.genera_settimana(lib(), st, NOVEMBRE, seed=seed, tentativi=30)
    assert P.conta_macro(pasti, lib()) == {"legumi": 3, "pesce": 2, "carne": 3, "uova": 1, "salumi_formaggi": 1}


def test_salumi_formaggi_ultima_scelta():
    ob = P.obiettivi_scalati({}, 10)  # default 3-3-3-1-2 = 12 su 10 pasti
    assert ob["salumi_formaggi"] == 0
    assert ob["legumi"] == ob["pesce"] == ob["carne"] == 3


def test_esclusioni_rispettate():
    L = lib()
    st = {"esclusi": ["ceci", "tonno", "pollo"]}
    for seed in range(10):
        pasti, _ = P.genera_settimana(L, st, NOVEMBRE, seed=seed, tentativi=10)
        for p in pasti:
            for c in p["componenti"]:
                testo = P.normalizza(L[c]["nome"] + " " + " ".join(i["nome"] for i in L[c]["ingredienti"]))
                assert "ceci" not in testo and "tonno" not in testo and "pollo" not in testo


def test_stagione():
    L = lib()
    for seed in range(10):
        pasti, _ = P.genera_settimana(L, {}, NOVEMBRE, seed=seed, tentativi=10)
        for p in pasti:
            for c in p["componenti"]:
                stg = L[c].get("stagione")
                assert not stg or 11 in stg, L[c]["nome"]


def test_voto_negativo_esclude():
    L = lib(voti={"hummus": -1})
    for seed in range(10):
        pasti, _ = P.genera_settimana(L, {}, NOVEMBRE, seed=seed, tentativi=10)
        assert all("hummus" not in p["componenti"] for p in pasti)


def test_cene_doppie_legano_cena_e_pranzo_dopo():
    trovati = 0
    for seed in range(20):
        pasti, _ = P.genera_settimana(lib(), {"cene_doppie": 2}, NOVEMBRE, seed=seed, tentativi=10)
        legami = P.legami_avanzi(pasti)
        assert sum(v == "avanzo" for v in legami.values()) <= 2
        for (i, pos), tipo in legami.items():
            if tipo == "avanzo":
                trovati += 1
                cid = pasti[i]["componenti"][pos]
                cena_prima = next(p for p in pasti if p["giorno"] == pasti[i]["giorno"] - 1 and p["tipo"] == "cena")
                assert cid in cena_prima["componenti"]
    assert trovati > 0
    pasti, _ = P.genera_settimana(lib(), {"cene_doppie": 0}, NOVEMBRE, seed=1, tentativi=10)
    assert not P.legami_avanzi(pasti)


def test_lista_spesa_reparti_e_dispensa():
    L = lib()
    pasti, _ = P.genera_settimana(L, {}, NOVEMBRE, seed=3, tentativi=10)
    voci = P.lista_spesa(pasti, L, dispensa=["ceci lessati"])
    ordine = [P.ORDINE_REPARTI.index(v["reparto"]) for v in voci]
    assert ordine == sorted(ordine)
    assert all(v["in_casa"] == ("ceci" in P.normalizza(v["nome"])) for v in voci)
    assert P.reparto_di("passata di pomodoro") == "Scaffale"
    assert P.reparto_di("filetti di merluzzo surgelati") == "Surgelati"
    assert P.reparto_di("gnocchi di patate") == "Banco frigo"


def test_rigenera_componente_cambia_solo_quello():
    L = lib()
    pasti, _ = P.genera_settimana(L, {"quota_piatti_unici": 0}, NOVEMBRE, seed=5, tentativi=10)
    random.seed(0)
    nuovi = P.rigenera_componente(L, {}, NOVEMBRE, pasti, 0, 2)
    assert nuovi[0]["componenti"][:2] == pasti[0]["componenti"][:2]
