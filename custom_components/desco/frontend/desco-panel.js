/* Desco — pannello Home Assistant per il menu settimanale. Nessuna dipendenza esterna. */

const CAT = {
  proteina: { label: "Proteina", color: "#ff8a65", icon: "mdi:food-drumstick" },
  carboidrato: { label: "Carboidrato", color: "#ffcc66", icon: "mdi:barley" },
  verdura: { label: "Verdura", color: "#6ee7a8", icon: "mdi:leaf" },
  unico: { label: "Piatto unico", color: "#b49cff", icon: "mdi:bowl-mix" },
};
const GRUPPI = {
  legumi: "Legumi", pesce: "Pesce", carne_bianca: "Carne bianca", carne_rossa: "Carne rossa",
  uova: "Uova", latticini: "Latticini", salumi: "Salumi", pasta: "Pasta", riso: "Riso", cereali: "Cereali",
  pane: "Pane", patate: "Patate", cruda: "Cruda", cotta: "Cotta",
};
const GRUPPI_CAT = {
  proteina: ["legumi", "pesce", "carne_bianca", "carne_rossa", "uova", "latticini", "salumi"],
  carboidrato: ["pasta", "riso", "cereali", "pane", "patate"],
  verdura: ["cruda", "cotta"],
  unico: ["legumi", "pesce", "carne_bianca", "carne_rossa", "uova", "latticini", "salumi"],
};
const MACRO = [
  ["legumi", "Legumi", "mdi:seed-outline", "#ff8a65"],
  ["pesce", "Pesce", "mdi:fish", "#4fc3f7"],
  ["carne", "Carne", "mdi:food-steak", "#ff6f91"],
  ["uova", "Uova", "mdi:egg-outline", "#ffcc66"],
  ["salumi_formaggi", "Salumi e formaggi", "mdi:cheese", "#c4d3df"],
];
const TABS = [
  ["settimana", "Settimana", "mdi:calendar-week"],
  ["spesa", "Spesa", "mdi:cart-outline"],
  ["storico", "Storico", "mdi:history"],
  ["ricettario", "Ricettario", "mdi:book-open-variant"],
  ["preferenze", "Preferenze", "mdi:tune-variant"],
];
/* titolo di sezione come nella dashboard: icona, maiuscolo, linea che sfuma */
const sez = (icon, testo, extra = "") => `<div class="sez"><ha-icon icon="${icon}"></ha-icon><h2>${testo}</h2><span class="sez-linea"></span>${extra}</div>`;
const pillBtn = (act, icon, testo, attrs = "", primario = false) =>
  `<button class="pbtn ${primario ? "primario" : ""}" data-act="${act}" ${attrs}><span class="badge-ic"><ha-icon icon="${icon}"></ha-icon></span>${testo}</button>`;
const ASPORTO = {
  freddo: { label: "Buono freddo", icon: "mdi:snowflake" },
  caldo: { label: "Da scaldare", icon: "mdi:microwave" },
  no: { label: "Solo a casa", icon: "mdi:home-outline" },
};
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmtData = (iso, opt = { day: "numeric", month: "short" }) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", opt);
const euro = (n) => "€".repeat(n || 1);

class DescoPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.s = null;
    this.tab = "settimana";
    this.busy = false;
    this.aperti = new Set();
    this.filtroCat = "tutti";
    this.cerca = "";
    this.modal = null;
    this.suggeriti = [];
    this.bozzaEsclusi = null;
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this.shadowRoot.addEventListener("input", (e) => this._input(e));
    this.shadowRoot.addEventListener("keydown", (e) => this._keydown(e));
    this.shadowRoot.addEventListener("pointerdown", (e) => this._iniziaTrascina(e));
    this.shadowRoot.addEventListener("change", (e) => { if (e.target.id === "p-cat") this._cambiaCat(e.target.value); });
  }

  set hass(h) {
    this._hass = h;
    const mb = this.shadowRoot.querySelector("ha-menu-button");
    if (mb) mb.hass = h;
    if (!this._caricato) {
      this._caricato = true;
      this._ws("desco/stato");
    }
  }
  set narrow(n) {
    this._narrow = n;
    const mb = this.shadowRoot.querySelector("ha-menu-button");
    if (mb) mb.narrow = n;
  }
  set panel(p) { this._panel = p; }

  /* ------------------------------------------------------------------ dati */

  /* ricettario e storico sono pesanti: si chiedono al server solo quando servono */
  _servono() {
    const con = [];
    if (this.tab === "ricettario" || this.modal?.tipo === "scegli" || this.modal?.tipo === "piatto") con.push("ricettario");
    if (this.tab === "storico") con.push("archivio");
    return con;
  }

  async _ws(type, payload = {}, { messaggio, annullabile } = {}) {
    if (!this._hass) return null;
    this.busy = true;
    this._render();
    try {
      const r = await this._hass.callWS({ type, ...payload, con: this._servono() });
      if (r.ricettario) this.ric = r.ricettario;
      else if (type !== "desco/stato" && this.ric && /vota|attiva|componente|elimina|dispensa/.test(type)) this.ric = null;
      if (r.archivio) this.arch = r.archivio;
      this.s = r;
      if (messaggio || annullabile) {
        const t = messaggio ? (typeof messaggio === "function" ? messaggio(r.risultato) : messaggio) : "Menu cambiato";
        this._toast(t, false, !!annullabile);
      }
      return r;
    } catch (err) {
      this._toast(err?.message || String(err), true);
      return null;
    } finally {
      this.busy = false;
      this._render();
    }
  }

  _toast(testo, errore = false, annulla = false) {
    this.toast = { testo, errore, annulla };
    clearTimeout(this._tt);
    this._tt = setTimeout(() => { this.toast = null; this._render(); }, errore ? 6000 : annulla ? 8000 : 3500);
    this._render();
  }

  /* ------------------------------------------------------------------ eventi */

  _click(e) {
    const el = e.target.closest("[data-act]");
    if (!el) {
      if (e.target.classList?.contains("velo")) { this.modal = null; this._render(); }
      return;
    }
    const a = el.dataset.act;
    const idx = el.dataset.idx !== undefined ? Number(el.dataset.idx) : null;
    const pos = el.dataset.pos !== undefined ? Number(el.dataset.pos) : null;
    const id = el.dataset.id;
    switch (a) {
      case "tab":
        this.tab = el.dataset.tab; this.modal = null;
        if ((this.tab === "ricettario" && !this.ric) || this.tab === "storico") this._ws("desco/stato");
        else this._render();
        break;
      case "annulla": this.toast = null; this._ws("desco/annulla", {}, { messaggio: "Annullato: menu com'era prima" }); break;
      case "in-casa": this._ws("desco/dispensa", { azione: el.dataset.val === "1" ? "aggiungi" : "togli", nome: el.dataset.nome }); break;
      case "togli-dispensa": this._ws("desco/dispensa", { azione: "togli", nome: el.dataset.nome }); break;
      case "svuota-dispensa": if (confirm("Svuotare la dispensa?")) this._ws("desco/dispensa", { azione: "svuota" }); break;
      case "genera": {
        const piano = this.s.piano;
        if (piano && el.dataset.sett === piano.settimana) {
          const liberi = piano.pasti.filter((m) => !m.bloccato).length;
          const bloccati = piano.pasti.length - liberi;
          if (!liberi) { this._toast("Tutti i pasti sono bloccati: sblocca quelli da cambiare", true); break; }
          const msg = `Rigenerare ${liberi} pasti della settimana?` +
            (bloccati ? `\n${bloccati} ${bloccati === 1 ? "pasto bloccato resta" : "pasti bloccati restano"} uguali.` : "\nPer tenerne qualcuno, bloccalo prima con il lucchetto.");
          if (!confirm(msg)) break;
        }
        this._ws("desco/genera", { settimana: el.dataset.sett }, { messaggio: "Menu generato", annullabile: true });
        break;
      }
      case "rigenera": this._ws("desco/rigenera_pasto", { idx }, { messaggio: "Pasto cambiato", annullabile: true }); break;
      case "cambia": this._ws("desco/rigenera_componente", { idx, pos }, { messaggio: "Piatto cambiato", annullabile: true }); break;
      case "blocca": this._ws("desco/blocca", { idx, bloccato: el.dataset.val === "1" }); break;
      case "apri": {
        const k = el.dataset.key;
        this.aperti.has(k) ? this.aperti.delete(k) : this.aperti.add(k);
        this._render();
        break;
      }
      case "scegli": {
        const pasto = this.s.piano.pasti[idx];
        this.modal = { tipo: "scegli", idx, pos, cat: pasto.dettagli[pos]?.cat || "proteina", pranzo: pasto.tipo === "pranzo", q: "" };
        if (!this.ric) this._ws("desco/stato"); else this._render();
        break;
      }
      case "scelto": {
        const { idx: mi, pos: mp } = this.modal;
        this.modal = null;
        this._ws("desco/imposta_componente", { idx: mi, pos: mp, comp_id: id }, { messaggio: "Piatto scelto", annullabile: true });
        break;
      }
      case "chiudi": this.modal = null; this._render(); break;
      case "spesa":
        this._ws("desco/invia_spesa", {}, {
          messaggio: (r) => r ? `Lista spesa aggiornata: ${r.aggiunte} voci aggiunte${r.rimosse ? `, ${r.rimosse} vecchie tolte` : ""}` : "Fatto",
        });
        break;
      case "filtro": this.filtroCat = el.dataset.cat; this._render(); break;
      case "attiva": this._ws("desco/attiva_componente", { comp_id: id, attivo: el.dataset.val === "1" }); break;
      case "nuovo": this.modal = { tipo: "piatto", comp: { cat: this.filtroCat !== "tutti" ? this.filtroCat : "proteina", costo: 1, minuti: 15, asporto: "freddo", ingredienti: [] } }; this._render(); break;
      case "modifica": this.modal = { tipo: "piatto", comp: JSON.parse(JSON.stringify(this._comp(id))) }; this._render(); break;
      case "duplica": {
        const c = JSON.parse(JSON.stringify(this._comp(id)));
        delete c.id; c.nome = c.nome + " (mia versione)";
        this.modal = { tipo: "piatto", comp: c };
        this._render();
        break;
      }
      case "elimina":
        if (confirm("Eliminare questo piatto dal ricettario?")) this._ws("desco/elimina_componente", { comp_id: id }, { messaggio: "Piatto eliminato" });
        break;
      case "salva-piatto": this._salvaPiatto(); break;
      case "suggerisci": this._suggerisci(); break;
      case "aggiungi-sugg": {
        const c = this.suggeriti.find((x) => x.id === id);
        this.suggeriti = this.suggeriti.filter((x) => x.id !== id);
        if (c) this._ws("desco/salva_componente", { componente: c }, { messaggio: `«${c.nome}» aggiunto al ricettario` });
        break;
      }
      case "scarta-sugg": this.suggeriti = this.suggeriti.filter((x) => x.id !== id); this._render(); break;
      case "togli-escluso":
        this._bozza().splice(Number(el.dataset.i), 1);
        this._render();
        break;
      case "budget": this._bozzaSet("budget", el.dataset.val); break;
      case "salva-pref": this._salvaPreferenze(); break;
      case "riusa":
        if (confirm(`Riproporre questa settimana come menu del ${fmtData(this.s.settimana_predefinita)}? Il menu attuale di quella settimana verrà sostituito.`)) {
          this._ws("desco/riusa", { settimana: el.dataset.sett }, { messaggio: "Settimana riproposta", annullabile: true }).then((r) => { if (r) { this.tab = "settimana"; this._render(); } });
        }
        break;
      case "elimina-arch":
        if (confirm("Eliminare questa settimana dallo storico?")) this._ws("desco/elimina_archivio", { settimana: el.dataset.sett });
        break;
      case "vota": {
        const v = Number(el.dataset.val);
        this._ws("desco/vota", { comp_id: id, voto: v }, {
          messaggio: v > 0 ? "👍 Lo proporrò più spesso" : v < 0 ? "👎 Non lo proporrò più (cambialo con ⇄ se è nel menu)" : "Voto tolto",
        });
        break;
      }
      case "ricetta": this._apriRicetta(idx, false); break;
      case "rifai-ricetta": this._apriRicetta(this.modal?.idx, true); break;
      case "prova-notifica": this._ws("desco/prova_promemoria", {}, { messaggio: "Promemoria inviato" }); break;
      case "svuota":
        if (confirm("Cancellare il menu della settimana?")) this._ws("desco/svuota", {}, { messaggio: "Menu cancellato", annullabile: true });
        break;
    }
  }

  get modalIdx() { return this.modal?.idx; }
  get modalPos() { return this.modal?.pos; }

  _input(e) {
    const t = e.target;
    if (t.id === "cerca") { this.cerca = t.value; this._renderLista(); }
    if (t.id === "cerca-scegli" && this.modal) { this.modal.q = t.value; this._renderScegli(); }
    if (t.dataset.out) {
      const o = this.shadowRoot.getElementById(t.dataset.out);
      if (o) o.textContent = t.dataset.fmt === "pct" ? `${Math.round(t.value * 100)}%` : t.dataset.fmt === "num" ? t.value : `${t.value} min`;
    }
  }

  _keydown(e) {
    if (e.target.id === "nuova-dispensa" && e.key === "Enter") {
      const v = e.target.value.trim();
      if (v) { this._focus = "nuova-dispensa"; this._ws("desco/dispensa", { azione: "aggiungi", nome: v }); }
      return;
    }
    if (e.target.id === "nuovo-escluso" && e.key === "Enter") {
      const v = e.target.value.trim().toLowerCase();
      if (v) {
        v.split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!this._bozza().includes(x)) this._bozza().push(x); });
      }
      this._focus = "nuovo-escluso";
      this._render();
    }
  }

  _comp(id) { return (this.ric || []).find((c) => c.id === id); }

  _bozza() {
    if (!this.bozzaEsclusi) this.bozzaEsclusi = [...(this.s?.settings?.esclusi || [])];
    return this.bozzaEsclusi;
  }

  _bozzaSet(k, v) {
    this.bozzaPref = { ...(this.bozzaPref || {}), [k]: v };
    this._render();
  }

  async _salvaPreferenze() {
    const q = (id) => this.shadowRoot.getElementById(id);
    const pendente = q("nuovo-escluso")?.value.trim().toLowerCase();
    if (pendente) pendente.split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!this._bozza().includes(x)) this._bozza().push(x); });
    const settings = {
      esclusi: this._bozza(),
      max_minuti: Number(q("max_minuti").value),
      budget: this.bozzaPref?.budget || this.s.settings.budget,
      microonde: q("microonde").checked,
      solo_stagione: q("solo_stagione").checked,
      pranzo_solo_tonno: q("pranzo_solo_tonno").checked,
      pranzo_niente_brodi: q("pranzo_niente_brodi").checked,
      quota_piatti_unici: Number(q("quota").value),
      porzioni_pranzo: Number(q("porz_pranzo").value),
      porzioni_cena: Number(q("porz_cena").value),
      cene_doppie: Number(q("cene_doppie").value),
      obiettivi: Object.fromEntries(MACRO.map(([k]) => [k, Number(q(`ob-${k}`).value) || 0])),
    };
    const r = await this._ws("desco/impostazioni", { settings }, { messaggio: "Preferenze salvate: valgono dalla prossima generazione" });
    if (r) { this.bozzaEsclusi = null; this.bozzaPref = null; this._render(); }
  }

  async _suggerisci() {
    const q = (id) => this.shadowRoot.getElementById(id);
    const cat = q("g-cat").value;
    const quanti = Number(q("g-n").value);
    const asporto = q("g-asporto").checked;
    this.geminiInCorso = true;
    this._render();
    const r = await this._ws("desco/suggerisci", { cat, quanti, asporto });
    this.geminiInCorso = false;
    if (r?.risultato) {
      this.suggeriti = [...r.risultato, ...this.suggeriti];
      if (!r.risultato.length) this._toast("Gemini non ha proposto nulla di nuovo, riprova", true);
    }
    this._render();
  }

  _salvaPiatto() {
    const q = (id) => this.shadowRoot.getElementById(id);
    const comp = { ...this.modal.comp };
    comp.nome = q("p-nome").value.trim();
    comp.cat = q("p-cat").value;
    comp.gruppo = q("p-gruppo").value || null;
    if (comp.cat === "unico") comp.gruppo_carbo = q("p-gruppo-carbo").value;
    comp.minuti = Number(q("p-minuti").value);
    comp.costo = Number(q("p-costo").value);
    comp.asporto = q("p-asporto").value;
    comp.prep = q("p-prep").value;
    comp.anticipo = q("p-anticipo").checked;
    comp.brodoso = q("p-brodoso").checked;
    comp.scongela = q("p-scongela").checked ? (typeof comp.scongela === "string" ? comp.scongela : comp.nome || true) : false;
    comp.stagione = [...this.shadowRoot.querySelectorAll(".mese input:checked")].map((x) => Number(x.value));
    if (comp.stagione.length === 12) comp.stagione = [];
    comp.ingredienti = q("p-ingr").value.split("\n").map((r) => r.trim()).filter(Boolean).map((r) => {
      const [nome, qq, u] = r.split(";").map((x) => (x || "").trim());
      if (!qq || /^dispensa$/i.test(qq)) return { nome, dispensa: true };
      return { nome, q: Number(qq.replace(",", ".")) || 0, u: u || "g" };
    });
    if (!comp.nome) { this._toast("Dai un nome al piatto", true); return; }
    if (comp.origine === "integrato") { delete comp.id; comp.origine = "personale"; }
    this.modal = null;
    this._ws("desco/salva_componente", { componente: comp }, { messaggio: "Piatto salvato" });
  }

  /* ------------------------------------------------------------------ render */

  _render() {
    if (this.drag) { this._renderDopo = true; return; }
    const r = this.shadowRoot;
    const scroll = r.querySelector(".contenuto")?.scrollTop || 0;
    r.innerHTML = `<style>${STILE}${STILE_A}</style>
      <div class="app">
        <header class="toolbar">
          <ha-menu-button></ha-menu-button>
          <div class="logo"><span>Desco</span></div>
          ${this.busy ? `<div class="loader"></div>` : ""}
        </header>
        <main class="contenuto">${this.s ? this._vista() : `<div class="vuoto"><div class="loader grande"></div></div>`}</main>
        <nav class="dock" aria-label="Sezioni di Desco">${TABS.map(([k, l, i]) => `<button class="dock-b ${this.tab === k ? "on" : ""}" data-act="tab" data-tab="${k}" title="${l}" aria-label="${l}"><ha-icon icon="${i}"></ha-icon></button>`).join("")}</nav>
        ${this.modal ? this._modal() : ""}
        ${this.toast ? `<div class="toast ${this.toast.errore ? "err" : ""}"><span>${esc(this.toast.testo)}</span>${this.toast.annulla ? `<button class="toast-btn" data-act="annulla"><ha-icon icon="mdi:undo-variant"></ha-icon>Annulla</button>` : ""}</div>` : ""}
      </div>`;
    const mb = r.querySelector("ha-menu-button");
    if (mb) { mb.hass = this._hass; mb.narrow = this._narrow; }
    const c = r.querySelector(".contenuto");
    if (c) c.scrollTop = scroll;
    if (this._focus) { r.getElementById(this._focus)?.focus(); this._focus = null; }
  }

  _vista() {
    switch (this.tab) {
      case "spesa": return this._vistaSpesa();
      case "storico": return this._vistaStorico();
      case "ricettario": return this._vistaRicettario();
      case "preferenze": return this._vistaPreferenze();
      default: return this._vistaSettimana();
    }
  }

  /* ---------- settimana */

  _vistaSettimana() {
    const p = this.s.piano;
    const pred = this.s.settimana_predefinita;
    if (!p) {
      return `<section class="hero">
        <ha-icon icon="mdi:chef-hat"></ha-icon>
        <h1>Che si mangia questa settimana?</h1>
        <p>Desco prepara pranzi da portare al lavoro e cene per due, da lunedì a venerdì: sempre una proteina, un carboidrato e una verdura, veloci ed economici.</p>
        <div class="row center">
          <button class="btn primario" data-act="genera" data-sett="auto"><ha-icon icon="mdi:auto-fix"></ha-icon>Genera la settimana del ${fmtData(pred)}</button>
        </div>
      </section>`;
    }
    const lun = p.settimana;
    const ven = new Date(new Date(lun + "T12:00:00").getTime() + 4 * 864e5).toISOString().slice(0, 10);
    const perGiorno = {};
    p.pasti.forEach((m) => { (perGiorno[m.giorno] ||= []).push(m); });
    const giorni = Object.keys(perGiorno).map(Number).sort();
    const prossima = pred !== lun;
    const settimana = `${fmtData(lun, { day: "numeric" })} – ${fmtData(ven, { day: "numeric", month: "short" })}`;
    return `
      ${this._chipsStato(settimana)}
      ${sez("mdi:silverware-fork-knife", "Menu della settimana", `<div class="sez-azioni">
        ${pillBtn("genera", "mdi:shuffle-variant", "Rigenera", `data-sett="${lun}" title="Rigenera tutto tranne i pasti bloccati"`)}
        ${prossima ? pillBtn("genera", "mdi:calendar-arrow-right", `Settimana del ${fmtData(pred)}`, `data-sett="${pred}"`) : ""}
        ${pillBtn("spesa", "mdi:cart-outline", `Lista spesa · ${(this.s.spesa || []).length}`, "", true)}
      </div>`)}
      ${p.avvisi?.length ? `<div class="avviso"><ha-icon icon="mdi:alert-outline"></ha-icon><div>${p.avvisi.map(esc).join("<br>")}<br><small>Prova ad allargare il tempo massimo o a riattivare qualche piatto.</small></div></div>` : ""}
      <div class="nota suggerimento"><ha-icon icon="mdi:gesture-swipe"></ha-icon>Trascina un pasto dalla maniglia <ha-icon icon="mdi:drag"></ha-icon> sopra un altro per scambiarli, anche tra pranzo e cena.</div>
      <section class="griglia">${giorni.map((g) => this._giorno(perGiorno[g])).join("")}</section>
      ${this._preparazioni()}
      <div class="piede"><button class="link" data-act="svuota">Cancella menu</button></div>`;
  }

  _chipsStato(settimana) {
    const cont = this.s.conteggi || {};
    const ob = this.s.settings.obiettivi || {};
    const chip = (col, label, val, title = "") => `<span class="chip-s" title="${esc(title)}"><span class="chip-ic" style="--cc:${col}"><span></span></span><span><small>${label}</small><b>${val}</b></span></span>`;
    const prom = this.s.promemoria;
    return `<div class="chips-stato">
      <span class="chip-s"><span class="chip-ic ic"><ha-icon icon="mdi:calendar-week"></ha-icon></span><span><small>Settimana</small><b>${settimana}</b></span></span>
      ${MACRO.filter(([k]) => (ob[k] || 0) > 0 || cont[k]).map(([k, l, , col]) => chip(col, l, `${cont[k] || 0} / ${ob[k] ?? 0}`, `Obiettivo: ${ob[k] ?? 0} a settimana`)).join("")}
      ${prom && prom.breve && !/^Niente/.test(prom.breve) ? chip("#8fdcff", "Stasera", esc(prom.breve.replace(/^Stasera: /, "")), prom.testo) : ""}
    </div>`;
  }

  _giorno(pasti) {
    const d = pasti[0];
    const oggi = d.data === this.s.oggi;
    pasti.sort((a, b) => (a.tipo === "pranzo" ? -1 : 1));
    return `<article class="giorno ${oggi ? "oggi" : ""}">
      <div class="g-testa"><span class="g-nome">${esc(d.nome_giorno)}</span><span class="g-data">${fmtData(d.data)}</span>${oggi ? `<span class="badge-oggi">oggi</span>` : ""}</div>
      ${pasti.map((m) => this._pasto(m)).join("")}
    </article>`;
  }

  _pasto(m) {
    const pranzo = m.tipo === "pranzo";
    const sotto = pranzo ? `Linda · asporto` : `per ${m.porzioni}`;
    return `<div class="pasto ${m.bloccato ? "bloccato" : ""}" data-pasto="${m.idx}">
      <div class="p-testa">
        <span class="maniglia" data-drag="${m.idx}" title="Trascina per spostare"><ha-icon icon="mdi:drag"></ha-icon></span>
        <span class="badge-ic"><ha-icon icon="${pranzo ? "mdi:food-takeout-box-outline" : "mdi:silverware-fork-knife"}"></ha-icon></span>
        <div class="p-tit"><b>${pranzo ? "Pranzo" : "Cena"}</b><span>${sotto}</span></div>
        <div class="p-meta"><span title="Tempo di preparazione"><ha-icon icon="mdi:timer-outline"></ha-icon>${m.minuti}′</span><b class="costo" title="Costo">${euro(m.costo)}</b></div>
      </div>
      ${m.non_trasportabile?.length ? `<div class="avviso-mini"><ha-icon icon="mdi:alert-outline"></ha-icon>Non adatto al pranzo di Linda: ${m.non_trasportabile.map(esc).join(", ")}</div>` : ""}
      <ul class="comp">${m.dettagli.map((c, pos) => this._componente(m, c, pos)).join("")}</ul>
      <div class="p-azioni">
        <button class="ico ${m.bloccato ? "on" : ""}" data-act="blocca" data-idx="${m.idx}" data-val="${m.bloccato ? 0 : 1}" title="${m.bloccato ? "Sblocca" : "Blocca: resta uguale se rigeneri"}"><ha-icon icon="${m.bloccato ? "mdi:lock" : "mdi:lock-open-variant-outline"}"></ha-icon></button>
        <button class="ico" data-act="rigenera" data-idx="${m.idx}" title="Cambia tutto il pasto" ${m.bloccato ? "disabled" : ""}><ha-icon icon="mdi:refresh"></ha-icon></button>
        ${this.s.gemini ? `<button class="ico ${m.ricetta ? "on" : ""}" data-act="ricetta" data-idx="${m.idx}" title="Ricetta completa${m.ricetta ? "" : " (Gemini)"}"><ha-icon icon="mdi:chef-hat"></ha-icon></button>` : ""}
      </div>
    </div>`;
  }

  _componente(m, c, pos) {
    const k = `${m.idx}-${pos}`;
    const aperto = this.aperti.has(k);
    const info = CAT[c.cat] || CAT.verdura;
    const ingr = (c.ingredienti || []).filter((i) => !i.dispensa).map((i) => `${esc(i.nome)} ${i.q ? `<span class="q">${+(i.q * m.porzioni).toFixed(2)} ${esc(i.u)}</span>` : ""}`).join(", ");
    return `<li class="c ${c.id ? "" : "manca"}" style="--cc:${info.color}">
      <div class="c-riga">
        <span class="punto" title="${info.label}"></span>
        <button class="c-nome" data-act="apri" data-key="${k}">${esc(c.nome)}${c.legame === "doppio" ? ` <span class="legame" title="Cucinane ${m.porzioni + 1} porzioni: una va nel pranzo di domani">×${m.porzioni + 1}</span>` : ""}${c.legame === "avanzo" ? ` <span class="legame avanzo" title="Cucinato ieri sera insieme alla cena">da ieri sera</span>` : ""}${c.scongela ? ` <span class="legame gelo" title="Da scongelare la sera prima">🧊</span>` : ""}${c.voto > 0 ? ` <span class="cuore" title="Vi piace">👍</span>` : ""}</button>
        ${m.bloccato ? "" : `<span class="c-azioni">
          <button class="mini" data-act="cambia" data-idx="${m.idx}" data-pos="${pos}" title="Un'altra ${info.label.toLowerCase()}"><ha-icon icon="mdi:swap-horizontal"></ha-icon></button>
          <button class="mini" data-act="scegli" data-idx="${m.idx}" data-pos="${pos}" title="Scegli tu"><ha-icon icon="mdi:pencil-outline"></ha-icon></button>
        </span>`}
      </div>
      ${aperto && c.id ? `<div class="c-dett">
        ${ingr ? `<div class="ingr"><ha-icon icon="mdi:basket-outline"></ha-icon><span>${ingr}</span></div>` : ""}
        <p>${esc(c.prep)}</p>
        ${c.legame === "doppio" ? `<p class="evid">🍲 Cucinane ${m.porzioni + 1} porzioni: una va nel contenitore per il pranzo di domani.</p>` : ""}
        ${c.legame === "avanzo" ? `<p class="evid">🍲 Avanzato dalla cena di ieri sera: solo da mettere nel contenitore.</p>` : ""}
        ${c.scongela ? `<p class="evid">🧊 Sposta ${esc(c.scongela)} dal freezer al frigo la sera prima.</p>` : ""}
        <div class="voti">Vi piace?
          <button class="mini ${c.voto > 0 ? "on" : ""}" data-act="vota" data-id="${esc(c.id)}" data-val="${c.voto > 0 ? 0 : 1}" title="Sì, proponilo più spesso">👍</button>
          <button class="mini" data-act="vota" data-id="${esc(c.id)}" data-val="-1" title="No, non proporlo più">👎</button>
        </div>
      </div>` : ""}
    </li>`;
  }

  /* ---------- ricetta completa (Gemini) */

  async _apriRicetta(idx, rifai) {
    this.modal = { tipo: "ricetta", idx, carica: true };
    this._render();
    const pasto = this.s.piano.pasti[idx];
    if (!pasto.ricetta || rifai) {
      const r = await this._ws("desco/ricetta", { idx, rifai });
      if (!r) { this.modal = null; this._render(); return; }
    }
    if (this.modal?.tipo === "ricetta") { this.modal.carica = false; this._render(); }
  }

  _modalRicetta() {
    const m = this.s.piano.pasti[this.modal.idx];
    const r = m.ricetta;
    const testa = `<div class="d-testa"><b><ha-icon icon="mdi:chef-hat"></ha-icon> ${esc(m.nome_giorno)} · ${m.tipo === "pranzo" ? "pranzo da portare" : `cena per ${m.porzioni}`}</b><button class="ico" data-act="chiudi"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
    if (this.modal.carica || !r) {
      return `<div class="velo"><div class="dialogo largo">${testa}<div class="vuoto piccolo"><div class="loader grande"></div><p class="nota">Gemini sta scrivendo la ricetta…</p></div></div></div>`;
    }
    return `<div class="velo"><div class="dialogo largo ric-modal">${testa}
      <div class="r-titolo">${esc(m.titolo)}</div>
      ${r.tempo_totale ? `<div class="nota"><ha-icon icon="mdi:timer-outline"></ha-icon> circa ${r.tempo_totale} minuti in tutto</div>` : ""}
      <h3>Ingredienti</h3><ul class="r-ingr">${r.ingredienti.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      <h3>Procedimento</h3><ol class="r-passi">${r.passaggi.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
      ${r.contenitore ? `<div class="r-box"><ha-icon icon="mdi:food-takeout-box-outline"></ha-icon><div><b>Nel contenitore</b><br>${esc(r.contenitore)}</div></div>` : ""}
      ${r.consigli ? `<div class="r-box tip"><ha-icon icon="mdi:lightbulb-on-outline"></ha-icon><div>${esc(r.consigli)}</div></div>` : ""}
      <div class="row fine"><button class="btn piccolo" data-act="rifai-ricetta"><ha-icon icon="mdi:refresh"></ha-icon>Riscrivi</button><button class="btn piccolo primario" data-act="chiudi">Chiudi</button></div>
    </div></div>`;
  }

  /* ---------- preparazione in anticipo */

  _preparazioni() {
    const prep = this.s.preparazioni || [];
    if (!prep.length) return "";
    const nomi = { domenica: "Domenica", mercoledi: "Mercoledì sera" };
    const colore = (v) => (CAT[v.cat] || CAT.verdura).color;
    return `${sez("mdi:pot-steam-outline", "Preparazione in anticipo")}
      <div class="prep-griglia">${prep.map((v) => `<div class="prep-pill">
        <span class="badge-ic"><span class="glow" style="--cc:${colore(v)}"></span></span>
        <div class="prep-t"><b>${esc(v.nome)}</b><small>${nomi[v.sessione] || ""} · per ${v.pasti.map(esc).join(", ").toLowerCase()}</small></div>
        <span class="prep-q">${v.porzioni} porz.</span>
      </div>`).join("")}</div>
      <p class="nota">Si conservano in frigo 3-4 giorni. I contorni con «×» non sono in elenco: si cucinano doppi a cena la sera prima.</p>`;
  }

  /* ---------- trascinamento (mouse e touch) */

  _iniziaTrascina(e) {
    const h = e.target.closest("[data-drag]");
    if (!h || e.button > 0) return;
    const card = h.closest(".pasto");
    if (!card) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("fantasma");
    Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    this.shadowRoot.querySelector(".app").appendChild(ghost);
    card.classList.add("origine");
    this.drag = { da: Number(h.dataset.drag), card, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, target: null };
    this._muovi = (ev) => this._trascina(ev);
    this._fine = (ev) => this._fineTrascina(ev);
    window.addEventListener("pointermove", this._muovi, { passive: false });
    window.addEventListener("pointerup", this._fine);
    window.addEventListener("pointercancel", this._fine);
  }

  _trascina(e) {
    const d = this.drag;
    if (!d) return;
    e.preventDefault();
    d.ghost.style.left = `${e.clientX - d.dx}px`;
    d.ghost.style.top = `${e.clientY - d.dy}px`;
    const el = this.shadowRoot.elementFromPoint?.(e.clientX, e.clientY) || null;
    const t = el?.closest?.(".pasto[data-pasto]");
    const idx = t ? Number(t.dataset.pasto) : null;
    if (d.target !== idx) {
      this.shadowRoot.querySelectorAll(".pasto.bersaglio").forEach((x) => x.classList.remove("bersaglio"));
      if (t && idx !== d.da) t.classList.add("bersaglio");
      d.target = idx;
    }
    // scorrimento automatico vicino ai bordi
    const c = this.shadowRoot.querySelector(".contenuto");
    const cr = c.getBoundingClientRect();
    if (e.clientY < cr.top + 60) c.scrollTop -= 12;
    else if (e.clientY > cr.bottom - 60) c.scrollTop += 12;
  }

  _fineTrascina() {
    const d = this.drag;
    window.removeEventListener("pointermove", this._muovi);
    window.removeEventListener("pointerup", this._fine);
    window.removeEventListener("pointercancel", this._fine);
    if (!d) return;
    d.ghost.remove();
    d.card.classList.remove("origine");
    this.shadowRoot.querySelectorAll(".pasto.bersaglio").forEach((x) => x.classList.remove("bersaglio"));
    this.drag = null;
    if (d.target !== null && d.target !== d.da) {
      const a = this.s.piano.pasti[d.da], b = this.s.piano.pasti[d.target];
      this._ws("desco/sposta", { da: d.da, a: d.target }, {
        messaggio: `${a.nome_giorno} ${a.tipo} ⇄ ${b.nome_giorno} ${b.tipo}`, annullabile: true,
      });
    } else if (this._renderDopo) {
      this._renderDopo = false;
      this._render();
    }
  }

  /* ---------- storico */

  _vistaStorico() {
    if (!this.arch && this.s.n_archivio) return `<div class="vuoto"><div class="loader grande"></div></div>`;
    const arch = this.arch || [];
    const corrente = this.s.piano;
    if (!arch.length) {
      return `<section class="hero piccolo"><ha-icon icon="mdi:history"></ha-icon><h1>Ancora niente storico</h1>
        <p>Quando generi il menu di una nuova settimana, quella precedente finisce qui e puoi riconsultarla o riproporla.</p></section>`;
    }
    const perMese = {};
    arch.forEach((w) => { (perMese[w.settimana.slice(0, 7)] ||= []).push(w); });
    return `<section class="intesta"><div><div class="sopra">${arch.length} settimane</div><h1>Storico</h1>
        <div class="nota">Tocca una settimana per vedere cosa avete mangiato. «Riproponi» la rimette come menu da cucinare.</div></div></section>
      ${corrente ? `<div class="nota">Settimana in corso nel menu: ${fmtData(corrente.settimana, { day: "numeric", month: "long" })} (finisce nello storico alla prossima generazione).</div>` : ""}
      ${Object.entries(perMese).map(([mese, settimane]) => `
        <h2 class="mese-tit">${new Date(mese + "-15T12:00:00").toLocaleDateString("it-IT", { month: "long", year: "numeric" })}</h2>
        <div class="settimane">${settimane.map((w) => this._settimanaArchivio(w)).join("")}</div>`).join("")}`;
  }

  _settimanaArchivio(w) {
    const aperta = this.aperti.has("w" + w.settimana);
    const fine = new Date(new Date(w.settimana + "T12:00:00").getTime() + 4 * 864e5).toISOString().slice(0, 10);
    const perGiorno = {};
    w.pasti.forEach((m) => { (perGiorno[m.giorno] ||= {})[m.tipo] = m; });
    const giorni = Object.keys(perGiorno).map(Number).sort();
    const nomi = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
    return `<article class="card arch ${aperta ? "aperta" : ""}">
      <button class="arch-testa" data-act="apri" data-key="w${esc(w.settimana)}">
        <ha-icon icon="${aperta ? "mdi:chevron-down" : "mdi:chevron-right"}"></ha-icon>
        <b>${fmtData(w.settimana, { day: "numeric" })} – ${fmtData(fine, { day: "numeric", month: "short" })}</b>
        <span class="pillole">${MACRO.filter(([k]) => w.conteggi?.[k]).map(([k, l]) => `<span class="pill">${l} <b>${w.conteggi[k]}</b></span>`).join("")}</span>
      </button>
      ${aperta ? `<div class="arch-corpo">
        <table><thead><tr><th></th><th><ha-icon icon="mdi:food-takeout-box-outline"></ha-icon> Pranzo</th><th><ha-icon icon="mdi:silverware-variant"></ha-icon> Cena</th></tr></thead>
        <tbody>${giorni.map((g) => `<tr><th>${nomi[g]}</th>${["pranzo", "cena"].map((t) => {
          const m = perGiorno[g][t];
          return `<td>${m ? m.dettagli.filter((d) => d.id).map((d) => `<span class="arch-c" style="--cc:${(CAT[d.cat] || CAT.verdura).color}"><span class="punto"></span>${esc(d.nome)}</span>`).join("") : "—"}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table>
        <div class="row fine">
          <button class="btn piccolo" data-act="elimina-arch" data-sett="${esc(w.settimana)}"><ha-icon icon="mdi:delete-outline"></ha-icon>Elimina</button>
          <button class="btn piccolo primario" data-act="riusa" data-sett="${esc(w.settimana)}"><ha-icon icon="mdi:restore"></ha-icon>Riproponi</button>
        </div>
      </div>` : ""}
    </article>`;
  }

  /* ---------- spesa */

  _vistaSpesa() {
    const voci = this.s.spesa || [];
    if (!this.s.piano) return `<section class="hero piccolo"><ha-icon icon="mdi:cart-outline"></ha-icon><p>Genera prima il menu della settimana.</p></section>`;
    return `<section class="intesta">
        <div><div class="sopra">Per la settimana del ${fmtData(this.s.piano.settimana)}</div><h1>Lista della spesa</h1>
        <div class="nota">${voci.length} prodotti · olio, sale, spezie ed erbe sono considerati in dispensa</div></div>
        <div class="azioni"><button class="btn primario" data-act="spesa" ${this.s.todo_ok ? "" : "disabled"}><ha-icon icon="mdi:playlist-plus"></ha-icon>Invia a ${esc(this._nomeEntita(this.s.todo_entity))}</button></div>
      </section>
      ${this.s.todo_ok ? "" : `<div class="avviso"><ha-icon icon="mdi:alert-outline"></ha-icon><div>
        <b>La lista «${esc(this.s.todo_entity)}» non esiste in Home Assistant.</b><br>
        ${this.s.liste_todo?.length
          ? `Scegli una delle tue liste (${this.s.liste_todo.map((e) => esc(this._nomeEntita(e))).join(", ")}) in <a href="/config/integrations/integration/desco">Impostazioni → Dispositivi e servizi → Desco → Configura</a>.`
          : `Non hai ancora liste To-do: aggiungi l'integrazione <a href="/config/integrations/dashboard/add?domain=shopping_list">Lista della spesa</a> e Desco la userà subito.`}
      </div></div>`}
      ${this._listaPerReparto(voci)}
      ${this._dispensa()}`;
  }

  _listaPerReparto(voci) {
    const reparti = [];
    voci.forEach((v) => { let r = reparti.find((x) => x.nome === v.reparto); if (!r) reparti.push(r = { nome: v.reparto, voci: [] }); r.voci.push(v); });
    const icone = { "Frutta e verdura": "mdi:carrot", "Pane": "mdi:baguette", "Carne e pesce": "mdi:food-steak", "Banco frigo": "mdi:fridge-outline", "Surgelati": "mdi:snowflake", "Scaffale": "mdi:package-variant-closed" };
    const daComprare = voci.filter((v) => !v.in_casa).length;
    return `${sez("mdi:cart-outline", `Da comprare · ${daComprare}`)}
      <div class="reparti">${reparti.map((r) => `<section class="card reparto">
        <div class="rep-testa"><span class="badge-ic"><ha-icon icon="${icone[r.nome] || "mdi:shopping-outline"}"></ha-icon></span><b>${esc(r.nome)}</b></div>
        ${r.voci.map((v) => `<div class="voce ${v.in_casa ? "in-casa" : ""}">
          <span class="v-nome">${esc(v.nome)}</span><span class="q">${esc(v.quantita)}</span>
          <button class="casa-btn ${v.in_casa ? "on" : ""}" data-act="in-casa" data-nome="${esc(v.nome)}" data-val="${v.in_casa ? 0 : 1}" title="${v.in_casa ? "Non ce l'ho più" : "Ce l'ho già in casa"}"><ha-icon icon="${v.in_casa ? "mdi:home-check" : "mdi:home-plus-outline"}"></ha-icon></button>
        </div>`).join("")}
      </section>`).join("")}</div>
      <p class="nota">Tocca <ha-icon icon="mdi:home-plus-outline"></ha-icon> sulle cose che hai già: non vengono inviate alla lista e finiscono nella dispensa. Se rigeneri e reinvii, le voci della volta prima non ancora spuntate vengono sostituite.</p>`;
  }

  _dispensa() {
    const d = this.s.dispensa || [];
    return `${sez("mdi:fridge-outline", "Dispensa e freezer", d.length ? `<button class="link" data-act="svuota-dispensa">Svuota</button>` : "")}
      <section class="card dispensa">
        <div class="nota">Quello che avete già in casa: Desco lo toglie dalla spesa e, quando genera il menu, preferisce i piatti che lo usano.</div>
        <div class="chips">${d.map((v) => `<span class="chip on dispo">${esc(v)}<button data-act="togli-dispensa" data-nome="${esc(v)}" aria-label="Togli ${esc(v)}"><ha-icon icon="mdi:close"></ha-icon></button></span>`).join("")}
          <input id="nuova-dispensa" class="inline" placeholder="Aggiungi (es. ceci lessati, merluzzo surgelato) e Invio">
        </div>
      </section>`;
  }

  _nomeEntita(eid) {
    return this._hass?.states?.[eid]?.attributes?.friendly_name || eid;
  }

  /* ---------- ricettario */

  _vistaRicettario() {
    if (!this.ric) return `<div class="vuoto"><div class="loader grande"></div></div>`;
    const n = (cat) => this.ric.filter((c) => cat === "tutti" || c.cat === cat).length;
    return `<section class="intesta">
        <div><div class="sopra">${this.ric.length} piatti</div><h1>Ricettario</h1>
        <div class="nota">Disattiva quello che non vi piace, aggiungi i vostri piatti o fatti suggerire idee da Gemini.</div></div>
        <div class="azioni"><button class="btn primario" data-act="nuovo"><ha-icon icon="mdi:plus"></ha-icon>Nuovo piatto</button></div>
      </section>
      ${this._gemini()}
      <div class="filtri">
        <div class="chips">${["tutti", "proteina", "carboidrato", "verdura", "unico"].map((k) =>
          `<button class="chip ${this.filtroCat === k ? "on" : ""}" data-act="filtro" data-cat="${k}" style="--cc:${CAT[k]?.color || "var(--primary-color)"}">${k === "tutti" ? "Tutti" : CAT[k].label} <small>${n(k)}</small></button>`).join("")}</div>
        <div class="cerca"><ha-icon icon="mdi:magnify"></ha-icon><input id="cerca" placeholder="Cerca piatto o ingrediente" value="${esc(this.cerca)}"></div>
      </div>
      <section id="lista" class="ricette">${this._listaHtml()}</section>`;
  }

  _renderLista() {
    const l = this.shadowRoot.getElementById("lista");
    if (l) l.innerHTML = this._listaHtml();
  }

  _filtraRicette(cat, q, soloAsporto = false) {
    const t = norm(q);
    return (this.ric || []).filter((c) =>
      (cat === "tutti" || c.cat === cat) &&
      (!soloAsporto || c.asporto === "freddo" || (c.asporto === "caldo" && this.s.settings.microonde)) &&
      (!soloAsporto || !this.s.settings.pranzo_solo_tonno || c.gruppo !== "pesce" || (c.ingredienti || []).some((i) => norm(i.nome).includes("tonno"))) &&
      (!soloAsporto || !c.brodoso || this.s.settings.pranzo_niente_brodi === false) &&
      (!t || norm(c.nome).includes(t) || (c.ingredienti || []).some((i) => norm(i.nome).includes(t))));
  }

  _listaHtml() {
    const lista = this._filtraRicette(this.filtroCat, this.cerca);
    if (!lista.length) return `<p class="nota">Nessun piatto trovato.</p>`;
    const esclusi = (this.s.settings.esclusi || []).map(norm);
    return lista.map((c) => {
      const info = CAT[c.cat];
      const bloccatoDa = esclusi.find((e) => norm(c.nome).includes(e) || (c.ingredienti || []).some((i) => norm(i.nome).includes(e)));
      const mio = c.origine !== "integrato";
      return `<div class="ricetta ${c.attivo && c.voto >= 0 ? "" : "spento"}" style="--cc:${info.color}">
        <div class="r-testa">
          <span class="r-cat"><ha-icon icon="${info.icon}"></ha-icon>${info.label}${c.gruppo ? ` · ${GRUPPI[c.gruppo] || esc(c.gruppo)}` : ""}</span>
          <label class="switch" title="${c.attivo ? "Attivo" : "Disattivato"}"><input type="checkbox" ${c.attivo ? "checked" : ""} data-act="attiva" data-id="${esc(c.id)}" data-val="${c.attivo ? 0 : 1}"><span></span></label>
        </div>
        <div class="r-nome">${esc(c.nome)}${c.origine === "gemini" ? ` <span class="tag ai">Gemini</span>` : mio ? ` <span class="tag">mio</span>` : ""}</div>
        <div class="r-meta">
          <span><ha-icon icon="mdi:timer-outline"></ha-icon>${c.minuti}′</span>
          <span class="costo">${euro(c.costo)}</span>
          <span title="${ASPORTO[c.asporto]?.label}"><ha-icon icon="${ASPORTO[c.asporto]?.icon}"></ha-icon>${ASPORTO[c.asporto]?.label}</span>
          ${c.stagione?.length ? `<span><ha-icon icon="mdi:calendar-blank-outline"></ha-icon>${this._stagione(c.stagione)}</span>` : ""}
          ${c.anticipo ? `<span title="Si può preparare in anticipo"><ha-icon icon="mdi:pot-steam-outline"></ha-icon>Anticipabile</span>` : ""}
          ${c.brodoso ? `<span title="Zuppa o piatto brodoso: solo a cena"><ha-icon icon="mdi:bowl-outline"></ha-icon>Brodoso</span>` : ""}
          ${c.scongela ? `<span title="Da scongelare la sera prima">🧊 Scongelare</span>` : ""}
        </div>
        ${bloccatoDa ? `<div class="r-escl"><ha-icon icon="mdi:cancel"></ha-icon>Escluso: contiene «${esc(bloccatoDa)}»</div>` : ""}
        ${c.voto < 0 ? `<div class="r-escl"><ha-icon icon="mdi:thumb-down-outline"></ha-icon>Bocciato: non viene più proposto</div>` : ""}
        <div class="r-azioni">
          <button class="mini ${c.voto > 0 ? "on" : ""}" data-act="vota" data-id="${esc(c.id)}" data-val="${c.voto > 0 ? 0 : 1}" title="Vi piace: proponilo più spesso">👍</button>
          <button class="mini ${c.voto < 0 ? "on" : ""}" data-act="vota" data-id="${esc(c.id)}" data-val="${c.voto < 0 ? 0 : -1}" title="${c.voto < 0 ? "Togli il voto negativo" : "Non vi piace: non proporlo più"}">👎</button>
          <span class="spazio"></span>
          ${mio ? `<button class="mini" data-act="modifica" data-id="${esc(c.id)}" title="Modifica"><ha-icon icon="mdi:pencil-outline"></ha-icon></button>
                   <button class="mini" data-act="elimina" data-id="${esc(c.id)}" title="Elimina"><ha-icon icon="mdi:delete-outline"></ha-icon></button>`
                : `<button class="mini" data-act="duplica" data-id="${esc(c.id)}" title="Crea una tua versione"><ha-icon icon="mdi:content-copy"></ha-icon></button>`}
        </div>
      </div>`;
    }).join("");
  }

  _stagione(m) {
    if (!m?.length) return "tutto l'anno";
    // intervalli consecutivi (anche a cavallo d'anno)
    const set = new Set(m);
    const inizio = m.find((x) => !set.has(x === 1 ? 12 : x - 1)) ?? m[0];
    let fine = inizio;
    while (set.has(fine === 12 ? 1 : fine + 1) && (fine === 12 ? 1 : fine + 1) !== inizio) fine = fine === 12 ? 1 : fine + 1;
    return `${MESI[inizio - 1]}–${MESI[fine - 1]}`;
  }

  _gemini() {
    if (!this.s.gemini) {
      return `<div class="card gemini spento"><ha-icon icon="mdi:creation-outline"></ha-icon><div><b>Idee con Gemini</b><br><small>Aggiungi la chiave API gratuita di Google AI Studio in Impostazioni → Dispositivi e servizi → Desco → Configura.</small></div></div>`;
    }
    return `<div class="card gemini">
      <div class="g-form">
        <ha-icon icon="mdi:creation"></ha-icon><b>Idee con Gemini</b>
        <select id="g-cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
        <select id="g-n">${[2, 3, 4, 5].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select>
        <label class="check"><input type="checkbox" id="g-asporto" checked> per il pranzo da asporto</label>
        <button class="btn" data-act="suggerisci" ${this.geminiInCorso ? "disabled" : ""}>${this.geminiInCorso ? "Penso…" : "Suggerisci"}</button>
      </div>
      ${this.suggeriti.length ? `<div class="sugg">${this.suggeriti.map((c) => `
        <div class="s-item" style="--cc:${CAT[c.cat].color}">
          <div class="r-nome">${esc(c.nome)}</div>
          <div class="r-meta"><span><ha-icon icon="mdi:timer-outline"></ha-icon>${c.minuti}′</span><span class="costo">${euro(c.costo)}</span><span>${ASPORTO[c.asporto]?.label}</span></div>
          <div class="nota">${esc((c.ingredienti || []).map((i) => i.nome).join(", "))}</div>
          <p>${esc(c.prep)}</p>
          <div class="row"><button class="btn piccolo primario" data-act="aggiungi-sugg" data-id="${esc(c.id)}">Aggiungi</button><button class="btn piccolo" data-act="scarta-sugg" data-id="${esc(c.id)}">Scarta</button></div>
        </div>`).join("")}</div>` : ""}
    </div>`;
  }

  /* ---------- preferenze */

  _vistaPreferenze() {
    const s = this.s.settings;
    const budget = this.bozzaPref?.budget || s.budget;
    const esclusi = this._bozza();
    return `<section class="intesta"><div><div class="sopra">Come generare il menu</div><h1>Preferenze</h1></div></section>
      <section class="card pref">
        <div class="campo">
          <label>Alimenti da non usare</label>
          <div class="nota">Basta una parola: «funghi» esclude ogni piatto che contiene funghi. Invio per aggiungere.</div>
          <div class="chips">${esclusi.map((e, i) => `<span class="chip on escl">${esc(e)}<button data-act="togli-escluso" data-i="${i}" title="Togli"><ha-icon icon="mdi:close"></ha-icon></button></span>`).join("")}
            <input id="nuovo-escluso" class="inline" placeholder="es. peperoni, salmone">
          </div>
        </div>
        <div class="campo">
          <label>Proporzioni settimanali</label>
          <div class="nota">Quanti pasti con ciascuna fonte di proteine su ${this.s.piano?.pasti?.length || 10} pasti a settimana. Salumi e formaggi sono l'ultima scelta: usano solo i posti che restano (o quando nient'altro è compatibile). La carne rossa resta al massimo una volta.</div>
          <div class="proporzioni">${MACRO.map(([k, l, i]) => `<label class="prop"><ha-icon icon="${i}"></ha-icon><span>${l}</span><input type="number" min="0" max="10" id="ob-${k}" value="${s.obiettivi?.[k] ?? 0}"></label>`).join("")}</div>
        </div>
        <div class="campo">
          <label>Tempo massimo per piatto <output id="o-min">${s.max_minuti} min</output></label>
          <input type="range" id="max_minuti" min="5" max="60" step="5" value="${s.max_minuti}" data-out="o-min">
        </div>
        <div class="campo">
          <label>Budget</label>
          <div class="segmenti">${[["economico", "Economico", "€"], ["normale", "Normale", "€€"], ["libero", "Libero", "€€€"]].map(([k, l, e]) =>
            `<button class="${budget === k ? "on" : ""}" data-act="budget" data-val="${k}"><b>${e}</b>${l}</button>`).join("")}</div>
          <div class="nota">Economico esclude i piatti €€€ e preferisce quelli da €.</div>
        </div>
        <div class="campo riga">
          <div><label>Microonde al lavoro</label><div class="nota">Se no, a pranzo solo piatti buoni freddi.</div></div>
          <label class="switch"><input type="checkbox" id="microonde" ${s.microonde ? "checked" : ""}><span></span></label>
        </div>
        <div class="campo riga">
          <div><label>A pranzo niente zuppe e minestre</label><div class="nota">Minestrone, vellutate, pasta e fagioli: scomodi nel contenitore, solo a cena.</div></div>
          <label class="switch"><input type="checkbox" id="pranzo_niente_brodi" ${s.pranzo_niente_brodi !== false ? "checked" : ""}><span></span></label>
        </div>
        <div class="campo riga">
          <div><label>A pranzo, come pesce solo tonno in scatola</label><div class="nota">Merluzzo, sgombro, salmone e gamberi solo a cena.</div></div>
          <label class="switch"><input type="checkbox" id="pranzo_solo_tonno" ${s.pranzo_solo_tonno !== false ? "checked" : ""}><span></span></label>
        </div>
        <div class="campo riga">
          <div><label>Solo verdure di stagione</label><div class="nota">Costano meno e sono più buone.</div></div>
          <label class="switch"><input type="checkbox" id="solo_stagione" ${s.solo_stagione ? "checked" : ""}><span></span></label>
        </div>
        <div class="campo">
          <label>Piatti unici <output id="o-quota">${Math.round(s.quota_piatti_unici * 100)}%</output></label>
          <div class="nota">Quanto spesso proporre un piatto unico (es. pasta e lenticchie) al posto di tre componenti.</div>
          <input type="range" id="quota" min="0" max="0.8" step="0.1" value="${s.quota_piatti_unici}" data-out="o-quota" data-fmt="pct">
        </div>
        <div class="campo">
          <label>Cene doppie a settimana <output id="o-doppie">${s.cene_doppie ?? 2}</output></label>
          <div class="nota">Quante volte un contorno della cena (cereali, verdure cotte) si cucina doppio per diventare il pranzo del giorno dopo. 0 = mai.</div>
          <input type="range" id="cene_doppie" min="0" max="4" step="1" value="${s.cene_doppie ?? 2}" data-out="o-doppie" data-fmt="num">
        </div>
        <div class="campo riga">
          <div><label>Promemoria serale</label><div class="nota">${this.s.notifiche
            ? "Ogni sera arriva sul telefono cosa preparare per domani: pranzo, cene doppie, cosa scongelare e la preparazione in anticipo."
            : "Per ricevere ogni sera cosa preparare per domani, scegli i telefoni in Impostazioni → Dispositivi e servizi → Desco → Configura."}</div></div>
          ${this.s.notifiche ? `<button class="btn piccolo" data-act="prova-notifica"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>Prova</button>` : ""}
        </div>
        <div class="campo due">
          <div><label>Porzioni a pranzo</label><input type="number" id="porz_pranzo" min="1" max="8" value="${s.porzioni_pranzo}"></div>
          <div><label>Porzioni a cena</label><input type="number" id="porz_cena" min="1" max="8" value="${s.porzioni_cena}"></div>
        </div>
        <div class="row fine"><button class="btn primario" data-act="salva-pref"><ha-icon icon="mdi:content-save-outline"></ha-icon>Salva preferenze</button></div>
      </section>`;
  }

  /* ---------- modali */

  _modal() {
    if (this.modal.tipo === "ricetta") return this._modalRicetta();
    if (this.modal.tipo === "scegli") {
      const m = this.modal;
      return `<div class="velo"><div class="dialogo">
        <div class="d-testa"><b>Scegli ${m.cat === "unico" ? "un piatto unico" : CAT[m.cat].label.toLowerCase()}</b><button class="ico" data-act="chiudi"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="cerca"><ha-icon icon="mdi:magnify"></ha-icon><input id="cerca-scegli" placeholder="Cerca" value="${esc(m.q)}"></div>
        <div class="nota">${m.pranzo ? "Solo piatti trasportabili. " : ""}Puoi scegliere anche un piatto unico al posto dei tre componenti.</div>
        <div id="scegli-lista" class="scegli-lista">${this._scegliHtml()}</div>
      </div></div>`;
    }
    const c = this.modal.comp;
    const cat = c.cat || "proteina";
    const ingr = (c.ingredienti || []).map((i) => i.dispensa ? `${i.nome}; dispensa` : `${i.nome}; ${i.q}; ${i.u}`).join("\n");
    const st = new Set(c.stagione?.length ? c.stagione : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    return `<div class="velo"><div class="dialogo largo">
      <div class="d-testa"><b>${c.id ? "Modifica piatto" : "Nuovo piatto"}</b><button class="ico" data-act="chiudi"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="form">
        <label class="full">Nome<input id="p-nome" value="${esc(c.nome || "")}" placeholder="es. Polpette di lenticchie"></label>
        <label>Categoria<select id="p-cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${k === cat ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <label>${cat === "unico" ? "Proteina" : "Tipo"}<select id="p-gruppo">${GRUPPI_CAT[cat].map((g) => `<option value="${g}" ${g === c.gruppo ? "selected" : ""}>${GRUPPI[g]}</option>`).join("")}</select></label>
        ${cat === "unico" ? `<label>Carboidrato<select id="p-gruppo-carbo">${GRUPPI_CAT.carboidrato.map((g) => `<option value="${g}" ${g === c.gruppo_carbo ? "selected" : ""}>${GRUPPI[g]}</option>`).join("")}</select></label>` : ""}
        <label>Minuti<input id="p-minuti" type="number" min="0" max="180" value="${c.minuti ?? 15}"></label>
        <label>Costo<select id="p-costo">${[1, 2, 3].map((n) => `<option value="${n}" ${n === c.costo ? "selected" : ""}>${euro(n)}</option>`).join("")}</select></label>
        <label>Asporto<select id="p-asporto">${Object.entries(ASPORTO).map(([k, v]) => `<option value="${k}" ${k === c.asporto ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <div class="full"><span class="lab">Stagione</span><div class="mesi">${MESI.map((m, i) => `<label class="mese"><input type="checkbox" value="${i + 1}" ${st.has(i + 1) ? "checked" : ""}><span>${m}</span></label>`).join("")}</div></div>
        <div class="full flags">
          <label class="check"><input type="checkbox" id="p-anticipo" ${c.anticipo ? "checked" : ""}> Si può preparare in anticipo (si conserva 3-4 giorni in frigo)</label>
          <label class="check"><input type="checkbox" id="p-scongela" ${c.scongela ? "checked" : ""}> Va scongelato la sera prima</label>
          <label class="check"><input type="checkbox" id="p-brodoso" ${c.brodoso ? "checked" : ""}> È una zuppa o un piatto brodoso (non per il pranzo da portare)</label>
        </div>
        <label class="full">Ingredienti per 1 persona <small>— una riga per ingrediente: <code>nome; quantità; unità</code> (g, ml, pz) oppure <code>nome; dispensa</code></small>
          <textarea id="p-ingr" rows="5" placeholder="ceci lessati; 120; g&#10;olio extravergine; dispensa">${esc(ingr)}</textarea></label>
        <label class="full">Preparazione<textarea id="p-prep" rows="3">${esc(c.prep || "")}</textarea></label>
      </div>
      <div class="row fine"><button class="btn" data-act="chiudi">Annulla</button><button class="btn primario" data-act="salva-piatto">Salva</button></div>
    </div></div>`;
  }

  _cambiaCat(cat) {
    // conserva quanto scritto e ridisegna i campi che dipendono dalla categoria
    const q = (id) => this.shadowRoot.getElementById(id);
    Object.assign(this.modal.comp, {
      anticipo: q("p-anticipo").checked, brodoso: q("p-brodoso").checked, scongela: q("p-scongela").checked ? (this.modal.comp.scongela || true) : false,
      nome: q("p-nome").value, cat, gruppo: null, minuti: Number(q("p-minuti").value),
      costo: Number(q("p-costo").value), asporto: q("p-asporto").value, prep: q("p-prep").value,
      ingredienti: q("p-ingr").value.split("\n").filter((r) => r.trim()).map((r) => {
        const [nome, qq, u] = r.split(";").map((x) => (x || "").trim());
        return !qq || /^dispensa$/i.test(qq) ? { nome, dispensa: true } : { nome, q: qq, u: u || "g" };
      }),
    });
    this._render();
  }

  _renderScegli() {
    const l = this.shadowRoot.getElementById("scegli-lista");
    if (l) l.innerHTML = this._scegliHtml();
  }

  _scegliHtml() {
    const m = this.modal;
    const att = this.s.piano.pasti[m.idx].dettagli[m.pos]?.id;
    const lista = [...this._filtraRicette(m.cat, m.q, m.pranzo), ...(m.cat !== "unico" ? this._filtraRicette("unico", m.q, m.pranzo) : [])]
      .filter((c) => c.attivo);
    return lista.map((c) => `<button class="s-riga ${c.id === att ? "on" : ""}" data-act="scelto" data-id="${esc(c.id)}" style="--cc:${CAT[c.cat].color}">
        <span class="punto"></span><span class="s-nome">${esc(c.nome)}${c.cat === "unico" ? ` <span class="tag">unico</span>` : ""}</span>
        <span class="s-meta">${c.minuti}′ · ${euro(c.costo)}</span></button>`).join("") || `<p class="nota">Niente da proporre.</p>`;
  }
}

const STILE = `
:host { display:block; height:100%; --raggio:16px; --cc:var(--primary-color);
  --sfondo: var(--primary-background-color); --carta: var(--card-background-color, #fff);
  --testo: var(--primary-text-color); --tenue: var(--secondary-text-color); --linea: var(--divider-color, rgba(127,127,127,.2));
  font-family: var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif); color: var(--testo); }
* { box-sizing:border-box; }
ha-icon { --mdc-icon-size:18px; display:inline-flex; }
button { font:inherit; color:inherit; cursor:pointer; }
button:disabled { opacity:.4; cursor:default; }
.app { height:100vh; display:flex; flex-direction:column; background:var(--sfondo); }
.toolbar { display:flex; align-items:center; gap:12px; min-height:56px; padding:0 12px; background:var(--app-header-background-color, var(--carta));
  color:var(--app-header-text-color, var(--testo)); border-bottom:1px solid var(--linea); position:relative; flex-wrap:wrap; }
.logo { display:flex; align-items:center; gap:8px; font-weight:600; font-size:20px; margin-right:auto; }
.logo ha-icon { --mdc-icon-size:22px; color:var(--primary-color); }
.tabs { display:flex; gap:4px; }
.tab { border:0; background:none; padding:8px 12px; border-radius:999px; display:flex; align-items:center; gap:6px; opacity:.75; }
.tab.on { background:color-mix(in srgb, var(--primary-color) 16%, transparent); color:var(--primary-color); opacity:1; font-weight:600; }
.toolbar .loader { position:absolute; left:0; right:0; bottom:-1px; height:2px; background:linear-gradient(90deg,transparent,var(--primary-color),transparent); background-size:50% 100%; animation:scorri 1s linear infinite; }
@keyframes scorri { from{background-position:-50% 0} to{background-position:150% 0} }
.contenuto { flex:1; overflow:auto; padding:24px clamp(12px,3vw,32px) 64px; }
.vuoto { display:grid; place-items:center; height:60vh; }
.loader.grande { width:36px; height:36px; border-radius:50%; border:3px solid var(--linea); border-top-color:var(--primary-color); animation:gira 1s linear infinite; }
@keyframes gira { to{transform:rotate(360deg)} }

h1 { font-size:clamp(22px,3vw,30px); margin:2px 0 8px; font-weight:650; letter-spacing:-.01em; }
.sopra { text-transform:uppercase; font-size:12px; letter-spacing:.08em; color:var(--tenue); font-weight:600; }
.nota { color:var(--tenue); font-size:13px; line-height:1.4; }
.intesta { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
.azioni, .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.row.center { justify-content:center; } .row.fine { justify-content:flex-end; margin-top:8px; }
.btn { border:1px solid var(--linea); background:var(--carta); border-radius:12px; padding:9px 14px; display:inline-flex; align-items:center; gap:8px; font-weight:500; transition:transform .1s, box-shadow .15s; }
.btn:hover:not(:disabled) { box-shadow:0 2px 10px rgba(0,0,0,.08); }
.btn:active { transform:scale(.98); }
.btn.primario { background:var(--primary-color); color:var(--text-primary-color,#fff); border-color:transparent; }
.btn.piccolo { padding:6px 10px; font-size:13px; }
.link { background:none; border:0; color:var(--tenue); text-decoration:underline; font-size:13px; }
.piede { text-align:center; margin-top:24px; }
.pillole { display:flex; gap:6px; flex-wrap:wrap; }
.pill { font-size:12px; padding:4px 10px; border-radius:999px; background:var(--carta); border:1px solid var(--linea); color:var(--tenue); }
.pill b { color:var(--testo); }
.card { background:var(--carta); border-radius:var(--raggio); border:1px solid var(--linea); padding:16px; }

.hero { max-width:560px; margin:8vh auto; text-align:center; }
.hero > ha-icon { --mdc-icon-size:56px; color:var(--primary-color); margin-bottom:8px; }
.hero p { color:var(--tenue); line-height:1.5; margin-bottom:24px; }
.hero.piccolo { margin-top:4vh; }

.avviso a { color:var(--primary-color); }
.avviso { display:flex; gap:10px; padding:12px 14px; border-radius:12px; margin-bottom:16px; background:color-mix(in srgb, var(--warning-color,#f4b400) 14%, transparent); font-size:14px; }

.griglia { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap:14px; align-items:start; }
@media (min-width:1400px) { .griglia { grid-template-columns:repeat(5, minmax(0, 1fr)); } }
.giorno { background:var(--carta); border:1px solid var(--linea); border-radius:var(--raggio); padding:14px; display:flex; flex-direction:column; gap:10px; }
.giorno.oggi { border-color:var(--primary-color); box-shadow:0 0 0 1px var(--primary-color), 0 6px 20px color-mix(in srgb, var(--primary-color) 18%, transparent); }
.g-testa { display:flex; align-items:baseline; gap:8px; }
.g-nome { font-weight:650; font-size:17px; }
.g-data { color:var(--tenue); font-size:13px; }
.badge-oggi { margin-left:auto; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--primary-color); }
.pasto { border-radius:12px; padding:10px 10px 6px; background:color-mix(in srgb, var(--testo) 3.5%, transparent); position:relative; }
.pasto.bloccato { background:color-mix(in srgb, var(--primary-color) 8%, transparent); }
.p-testa { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.p-icona { color:var(--tenue); --mdc-icon-size:20px; }
.p-tit { display:flex; flex-direction:column; line-height:1.15; }
.p-tit span { font-size:12px; color:var(--tenue); }
.p-meta { margin-left:auto; display:flex; gap:8px; font-size:12px; color:var(--tenue); align-items:center; }
.p-meta ha-icon { --mdc-icon-size:14px; margin-right:2px; }
.costo { color:#2e9e5b; font-weight:600; letter-spacing:.5px; }
.comp { list-style:none; margin:0; padding:0; }
.c-riga { display:flex; align-items:center; gap:8px; min-height:30px; }
.punto { width:8px; height:8px; border-radius:50%; background:var(--cc); flex:none; }
.c-nome { background:none; border:0; padding:3px 0; text-align:left; flex:1; font-size:14px; line-height:1.3; }
.c-nome:hover { text-decoration:underline dotted; }
.c.manca .c-nome { color:var(--error-color,#c62828); font-style:italic; }
.c-azioni { display:flex; opacity:0; transition:opacity .15s; }
.c:hover .c-azioni, .c-azioni:focus-within { opacity:1; }
@media (hover:none) { .c-azioni { opacity:.7; } }
.mini { border:0; background:none; padding:4px; border-radius:8px; color:var(--tenue); display:inline-flex; }
.mini:hover { background:color-mix(in srgb, var(--testo) 8%, transparent); color:var(--testo); }
.mini ha-icon { --mdc-icon-size:16px; }
.c-dett { margin:2px 0 8px 16px; padding-left:10px; border-left:2px solid var(--cc); font-size:13px; color:var(--tenue); }
.c-dett p { margin:6px 0 0; line-height:1.45; }
.ingr { display:flex; gap:6px; align-items:flex-start; } .ingr ha-icon { --mdc-icon-size:14px; margin-top:2px; }
.q { color:var(--testo); font-weight:500; }
.p-azioni { display:flex; justify-content:flex-end; gap:2px; }
.ico { border:0; background:none; padding:6px; border-radius:10px; color:var(--tenue); display:inline-flex; }
.ico:hover:not(:disabled) { background:color-mix(in srgb, var(--testo) 8%, transparent); color:var(--testo); }
.ico.on { color:var(--primary-color); }

.maniglia { cursor:grab; touch-action:none; color:var(--tenue); display:inline-flex; padding:4px 2px; margin-left:-6px; border-radius:6px; user-select:none; }
.maniglia:hover { background:color-mix(in srgb, var(--testo) 8%, transparent); color:var(--testo); }
.maniglia ha-icon { --mdc-icon-size:18px; }
.pasto.origine { opacity:.35; }
.pasto.bersaglio { outline:2px dashed var(--primary-color); outline-offset:2px; background:color-mix(in srgb, var(--primary-color) 12%, transparent); }
.fantasma { position:fixed; z-index:30; pointer-events:none; background:var(--carta); box-shadow:0 14px 40px rgba(0,0,0,.35); transform:rotate(-1.5deg); opacity:.95; }
.app:has(.fantasma) { cursor:grabbing; user-select:none; }
.avviso-mini { display:flex; gap:6px; align-items:center; font-size:12px; color:var(--warning-color,#c77c00); margin:0 0 4px; }
.avviso-mini ha-icon { --mdc-icon-size:14px; }
.suggerimento { display:flex; align-items:center; gap:4px; margin:-6px 0 12px; }
.suggerimento ha-icon { --mdc-icon-size:16px; }
.pill { display:inline-flex; align-items:center; gap:4px; }
.pill ha-icon { --mdc-icon-size:14px; }
.pill small { color:var(--tenue); }
.pill.fuori { border-style:dashed; }
.proporzioni { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; }
.prop { display:flex !important; align-items:center; gap:8px; font-weight:500 !important; justify-content:flex-start !important; background:var(--sfondo); border:1px solid var(--linea); border-radius:12px; padding:6px 8px 6px 12px; }
.prop span { flex:1; }
.prop input { width:64px; text-align:center; }
.mese-tit { font-size:14px; text-transform:capitalize; color:var(--tenue); margin:22px 0 8px; font-weight:600; }
.settimane { display:flex; flex-direction:column; gap:8px; }
.arch { padding:0; overflow:hidden; }
.arch-testa { width:100%; border:0; background:none; display:flex; align-items:center; gap:10px; padding:12px 14px; text-align:left; flex-wrap:wrap; }
.arch-testa .pillole { margin-left:auto; }
.arch-corpo { padding:0 14px 14px; overflow-x:auto; }
.arch table { width:100%; border-collapse:collapse; font-size:13px; }
.arch th { text-align:left; color:var(--tenue); font-weight:600; padding:6px 8px; white-space:nowrap; }
.arch th ha-icon { --mdc-icon-size:14px; }
.arch td { padding:6px 8px; border-top:1px solid var(--linea); vertical-align:top; }
.arch-c { display:flex; align-items:center; gap:6px; line-height:1.5; }
.legame { font-size:11px; font-weight:700; padding:1px 6px; border-radius:6px; background:color-mix(in srgb, #e9a93b 22%, transparent); color:#c98a17; white-space:nowrap; }
.legame.avanzo { background:color-mix(in srgb, #5fa86c 22%, transparent); color:#4a9157; }
.legame.gelo { background:color-mix(in srgb, #4aa3df 22%, transparent); }
.cuore { font-size:11px; }
.evid { color:var(--testo); }
.voti { display:flex; align-items:center; gap:2px; margin-top:6px; }
.mini.on { background:color-mix(in srgb, var(--primary-color) 18%, transparent); }
.spazio { flex:1; }
.r-azioni { align-items:center; gap:2px; }
.prep { margin-top:16px; padding:0; }
.prep-corpo .sessione { margin-bottom:12px; }
.s-tit { margin:6px 0 2px; }
.flags { display:flex !important; flex-direction:column; gap:6px; font-weight:400 !important; }
.flags .check { font-weight:400; flex-direction:row !important; }
.vuoto.piccolo { height:auto; padding:40px 0; display:flex; flex-direction:column; align-items:center; gap:12px; }
.ric-modal h3 { margin:14px 0 6px; font-size:15px; }
.r-titolo { font-weight:650; font-size:16px; }
.r-ingr, .r-passi { margin:0; padding-left:22px; line-height:1.55; font-size:14px; }
.r-passi li { margin-bottom:6px; }
.r-box { display:flex; gap:10px; margin-top:12px; padding:10px 12px; border-radius:12px; background:color-mix(in srgb, var(--primary-color) 10%, transparent); font-size:14px; line-height:1.45; }
.r-box.tip { background:color-mix(in srgb, #e9a93b 14%, transparent); }
.lista-spesa { columns:2 280px; column-gap:32px; }
.voce { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px dashed var(--linea); break-inside:avoid; }

.filtri { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:20px 0 14px; align-items:center; }
.chips { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.chip { border:1px solid var(--linea); background:var(--carta); border-radius:999px; padding:6px 12px; font-size:13px; display:inline-flex; align-items:center; gap:6px; }
.chip small { color:var(--tenue); }
.chip.on { border-color:var(--cc); background:color-mix(in srgb, var(--cc) 14%, var(--carta)); }
.chip.escl { --cc:var(--error-color,#d9534f); padding-right:4px; }
.chip.escl button { border:0; background:none; display:inline-flex; padding:2px; border-radius:50%; }
.chip.escl ha-icon { --mdc-icon-size:14px; }
.cerca { display:flex; align-items:center; gap:6px; border:1px solid var(--linea); border-radius:12px; padding:0 10px; background:var(--carta); min-width:240px; }
.cerca input { border:0; outline:0; background:none; padding:9px 0; flex:1; color:var(--testo); font:inherit; }
.ricette { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px,1fr)); gap:12px; }
.ricetta { background:var(--carta); border:1px solid var(--linea); border-left:4px solid var(--cc); border-radius:14px; padding:12px 12px 8px; display:flex; flex-direction:column; gap:6px; }
.ricetta.spento { opacity:.5; }
.r-testa { display:flex; justify-content:space-between; align-items:center; }
.r-cat { font-size:12px; color:var(--tenue); display:flex; gap:4px; align-items:center; } .r-cat ha-icon { --mdc-icon-size:14px; color:var(--cc); }
.r-nome { font-weight:600; font-size:15px; }
.r-meta { display:flex; gap:10px; flex-wrap:wrap; font-size:12px; color:var(--tenue); }
.r-meta span { display:inline-flex; align-items:center; gap:3px; } .r-meta ha-icon { --mdc-icon-size:14px; }
.r-escl { font-size:12px; color:var(--error-color,#c62828); display:flex; align-items:center; gap:4px; } .r-escl ha-icon { --mdc-icon-size:14px; }
.r-azioni { display:flex; justify-content:flex-end; margin-top:auto; }
.tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:2px 6px; border-radius:6px; background:color-mix(in srgb, var(--testo) 8%, transparent); color:var(--tenue); vertical-align:middle; }
.tag.ai { background:color-mix(in srgb, #8c7ae6 18%, transparent); color:#8c7ae6; }

.gemini { display:flex; flex-direction:column; gap:12px; }
.gemini.spento { flex-direction:row; align-items:center; gap:12px; opacity:.85; }
.gemini > ha-icon, .g-form > ha-icon { color:#8c7ae6; --mdc-icon-size:22px; }
.g-form { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
select, input[type=number], .form input, textarea { font:inherit; color:var(--testo); background:var(--sfondo); border:1px solid var(--linea); border-radius:10px; padding:8px 10px; }
.check { display:inline-flex; gap:6px; align-items:center; font-size:14px; }
.sugg { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px,1fr)); gap:10px; }
.s-item { border:1px dashed var(--cc); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:6px; }
.s-item p { margin:0; font-size:13px; line-height:1.4; }

.switch { position:relative; display:inline-block; width:40px; height:22px; flex:none; }
.switch input { opacity:0; width:0; height:0; }
.switch span { position:absolute; inset:0; border-radius:22px; background:var(--linea); transition:.2s; cursor:pointer; }
.switch span::before { content:""; position:absolute; width:16px; height:16px; left:3px; top:3px; border-radius:50%; background:#fff; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.3); }
.switch input:checked + span { background:var(--primary-color); }
.switch input:checked + span::before { transform:translateX(18px); }

.pref { max-width:720px; display:flex; flex-direction:column; gap:22px; padding:20px; }
.campo label { font-weight:600; display:flex; justify-content:space-between; }
.campo output { color:var(--primary-color); font-weight:600; }
.campo .nota { margin:2px 0 8px; }
.campo.riga { display:flex; justify-content:space-between; align-items:center; gap:16px; }
.campo.riga .nota { margin:2px 0 0; }
.campo.due { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.campo.due input { width:100%; margin-top:6px; }
input[type=range] { width:100%; accent-color:var(--primary-color); }
input.inline { border:1px dashed var(--linea); border-radius:999px; padding:6px 12px; background:none; color:var(--testo); font:inherit; font-size:13px; min-width:200px; outline:0; }
.segmenti { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.segmenti button { border:1px solid var(--linea); background:var(--sfondo); border-radius:12px; padding:10px; display:flex; flex-direction:column; align-items:center; gap:2px; font-size:13px; }
.segmenti button b { color:#2e9e5b; }
.segmenti button.on { border-color:var(--primary-color); background:color-mix(in srgb, var(--primary-color) 12%, var(--carta)); }

.velo { position:fixed; inset:0; background:rgba(0,0,0,.45); display:grid; place-items:center; padding:16px; z-index:10; animation:compari .15s; }
@keyframes compari { from{opacity:0} }
.dialogo { background:var(--carta); border-radius:20px; width:min(460px,100%); max-height:85vh; display:flex; flex-direction:column; gap:10px; padding:16px; box-shadow:0 20px 60px rgba(0,0,0,.3); }
.dialogo.largo { width:min(680px,100%); overflow:auto; }
.d-testa { display:flex; justify-content:space-between; align-items:center; font-size:17px; }
.scegli-lista { overflow:auto; display:flex; flex-direction:column; gap:2px; }
.s-riga { border:0; background:none; text-align:left; padding:10px; border-radius:10px; display:flex; align-items:center; gap:10px; }
.s-riga:hover { background:color-mix(in srgb, var(--testo) 6%, transparent); }
.s-riga.on { background:color-mix(in srgb, var(--primary-color) 12%, transparent); }
.s-nome { flex:1; } .s-meta { font-size:12px; color:var(--tenue); }
.form { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
.form label, .form .lab { display:flex; flex-direction:column; gap:4px; font-size:13px; font-weight:600; }
.form small { font-weight:400; color:var(--tenue); }
.form .full { grid-column:1/-1; }
.form textarea { resize:vertical; font-family:inherit; }
.mesi { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
.mese { cursor:pointer; } .mese input { display:none; }
.mese span { display:inline-block; padding:4px 8px; border-radius:8px; border:1px solid var(--linea); font-size:12px; font-weight:500; }
.mese input:checked + span { background:color-mix(in srgb, #5fa86c 20%, transparent); border-color:#5fa86c; }

.toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#323232; color:#fff; padding:12px 18px; border-radius:12px; font-size:14px; box-shadow:0 8px 24px rgba(0,0,0,.3); z-index:20; max-width:90vw; animation:compari .2s; }
.toast.err { background:var(--error-color,#c62828); }

@media (max-width:700px) {
  .tab span { display:none; }
  .tab { padding:8px 10px; }
  .intesta .azioni { width:100%; }
  .cerca { min-width:0; width:100%; }
}
`;

/* ---------- stile «Vetro blu» come la dashboard Home 3D ---------- */
const STILE_A = `
:host { --sfondo:#071321; --carta:rgba(9,24,39,0.78); --testo:#e8f1f8; --tenue:#8aa4b8; --linea:rgba(120,190,255,0.13);
  --primary-color:#3fb8f5; --accento:#4fc3f7; --badge:#0d2b45; --pill:rgba(5,15,26,0.82); --raggio:26px; }
.app { background: radial-gradient(120% 90% at 50% 0%, #0d2d48 0%, #0a1f33 45%, #071321 100%); color:var(--testo); }
.toolbar { background:#141a21; border-bottom:1px solid rgba(255,255,255,0.06); color:#e8f1f8; min-height:52px; }
.logo { font-weight:500; font-size:20px; }
.contenuto { padding-bottom:120px; }
.card, .giorno, .ricetta, .dialogo, .cerca, .chip, .btn, select, input[type=number], .form input, textarea { border-color:var(--linea); }
.card, .ricetta { background:var(--carta); border-radius:var(--raggio); }
.dialogo { background:#0b1c2d; border:1px solid var(--linea); }
.btn { background:var(--pill); border-radius:999px; color:var(--testo); }
.btn.primario, .pbtn.primario { background:#12557f; border-color:#2b8fcc; color:#fff; }
.sopra { color:var(--accento); }
.chips-stato { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-bottom:22px; }
.chip-s { display:inline-flex; align-items:center; gap:8px; padding:6px 14px 6px 7px; border-radius:999px; background:rgba(8,22,36,0.88); border:1px solid rgba(120,190,255,0.14); font-size:12px; line-height:1.15; max-width:360px; }
.chip-s small { display:block; color:var(--tenue); font-size:10px; }
.chip-s b { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.chip-ic { width:24px; height:24px; border-radius:50%; background:color-mix(in srgb, var(--cc) 16%, transparent); display:grid; place-items:center; flex:none; }
.chip-ic span { width:8px; height:8px; border-radius:50%; background:var(--cc); box-shadow:0 0 8px var(--cc); }
.chip-ic.ic { background:var(--badge); color:var(--accento); } .chip-ic ha-icon { --mdc-icon-size:14px; }
.sez { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin:6px 0 16px; }
.sez > ha-icon { color:var(--accento); --mdc-icon-size:22px; }
.sez h2 { margin:0; font-size:13px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
.sez-linea { flex:1 1 80px; height:4px; border-radius:4px; background:linear-gradient(90deg, #2b7fb8 0%, rgba(43,127,184,0.12) 100%); }
.sez-azioni { display:flex; gap:8px; flex-wrap:wrap; }
.pbtn { display:inline-flex; align-items:center; gap:8px; padding:6px 16px 6px 6px; min-height:44px; border-radius:999px; background:var(--pill); border:1px solid rgba(120,190,255,0.16); color:var(--testo); font-weight:600; font-size:14px; }
.pbtn:hover { border-color:rgba(120,190,255,0.35); }
.badge-ic { width:36px; height:36px; border-radius:50%; background:var(--badge); color:var(--accento); display:grid; place-items:center; flex:none; }
.badge-ic ha-icon { --mdc-icon-size:19px; }
.pbtn .badge-ic { width:32px; height:32px; } .pbtn.primario .badge-ic { background:#1b6fa3; color:#fff; }
.badge-ic .glow { width:10px; height:10px; border-radius:50%; background:var(--cc); box-shadow:0 0 10px var(--cc); }
.griglia { gap:16px; }
.giorno { background:rgba(9,24,39,0.72); border-radius:26px; padding:16px 14px 14px; }
.giorno.oggi { border-color:#3fb8f5; box-shadow:0 0 0 1px rgba(63,184,245,0.4), 0 10px 40px rgba(63,184,245,0.18); }
.g-testa { padding:0 6px; } .g-nome { font-weight:800; } .badge-oggi { color:var(--accento); font-weight:800; }
.pasto { background:var(--pill); border:1px solid rgba(120,190,255,0.10); border-radius:22px; padding:10px 10px 4px; }
.pasto.bloccato { background:color-mix(in srgb, #3fb8f5 10%, var(--pill)); border-color:rgba(63,184,245,0.35); }
.p-testa { gap:10px; } .p-tit b { font-size:14px; }
.costo { color:#6ee7a8; }
.punto { box-shadow:0 0 8px var(--cc); }
.legame { background:rgba(255,204,102,0.16); color:#ffd27a; border-radius:999px; }
.legame.avanzo { background:rgba(110,231,168,0.14); color:#7ff0b6; }
.prep-griglia { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px; }
.prep-pill { display:flex; align-items:center; gap:12px; padding:9px 16px 9px 9px; border-radius:999px; background:var(--carta); border:1px solid var(--linea); }
.prep-t { display:flex; flex-direction:column; line-height:1.25; min-width:0; } .prep-t small { color:var(--tenue); font-size:12px; }
.prep-q { margin-left:auto; color:var(--accento); font-weight:700; font-size:13px; white-space:nowrap; }
.dock { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); display:flex; gap:8px; padding:10px; border-radius:22px; background:rgba(16,21,28,0.95); border:1px solid rgba(255,255,255,0.06); box-shadow:0 10px 30px rgba(0,0,0,0.4); z-index:5; }
.dock-b { width:56px; height:56px; border-radius:16px; border:0; background:none; color:#c4d3df; display:grid; place-items:center; }
.dock-b ha-icon { --mdc-icon-size:24px; }
.dock-b:hover { background:rgba(255,255,255,0.05); }
.dock-b.on { background:#135a80; color:#8fdcff; }
.app { position:relative; }
.toast { display:flex; align-items:center; gap:12px; bottom:104px; }
.toast-btn { border:0; background:rgba(79,195,247,0.18); color:#8fdcff; border-radius:999px; padding:6px 12px 6px 8px; font-weight:700; display:inline-flex; align-items:center; gap:4px; }
.toast-btn ha-icon { --mdc-icon-size:16px; }
.reparti { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap:14px; align-items:start; }
.reparto { padding:14px 16px; }
.rep-testa { display:flex; align-items:center; gap:10px; margin-bottom:6px; font-size:15px; }
.reparto .voce { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px dashed var(--linea); }
.reparto .voce:last-child { border-bottom:0; }
.v-nome { flex:1; min-width:0; }
.voce.in-casa .v-nome, .voce.in-casa .q { text-decoration:line-through; opacity:.5; }
.casa-btn { border:0; background:none; color:var(--tenue); border-radius:10px; width:36px; height:36px; display:grid; place-items:center; }
.casa-btn:hover { background:rgba(255,255,255,0.06); color:var(--testo); }
.casa-btn.on { color:#6ee7a8; }
.dispensa { margin-bottom:20px; display:flex; flex-direction:column; gap:10px; }
.chip.dispo { --cc:#6ee7a8; padding-right:4px; }
.chip.dispo button { border:0; background:none; display:inline-flex; padding:2px; border-radius:50%; color:inherit; }
.chip.dispo ha-icon { --mdc-icon-size:14px; }
.p-tit { min-width:0; flex:1 1 auto; } .p-tit span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.p-meta { margin-left:0; flex:none; white-space:nowrap; display:flex; align-items:center; gap:8px; }
.p-meta span { display:inline-flex; align-items:center; }
.costo { white-space:nowrap; }
.suggerimento { flex-wrap:wrap; }
@media (hover:none) { .suggerimento { display:block; } .suggerimento ha-icon { vertical-align:middle; } }
.pill { background:rgba(8,22,36,0.85); }
.avviso { background:rgba(255,204,102,0.10); border:1px solid rgba(255,204,102,0.25); border-radius:18px; }
.toast { background:#0d2b45; border:1px solid var(--linea); }
.segmenti button, .prop { background:var(--pill); border-color:var(--linea); }
.switch span { background:rgba(255,255,255,0.15); }
@media (max-width:700px) {
  .dock { left:12px; right:12px; transform:none; justify-content:space-between; }
  .dock-b { width:50px; height:50px; }
  .sez-azioni { width:100%; }
}
`;

customElements.define("desco-panel", DescoPanel);
