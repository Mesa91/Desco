/* Desco — scheda per le dashboard: i pasti di oggi. Un tocco apre l'app Desco.
   Uso:  type: custom:desco-card
   Opzioni: titolo (default "Desco"), percorso (default "/desco"), mostra_promemoria (default true) */

const COLORI = { proteina: "#ff8a65", carboidrato: "#ffcc66", verdura: "#6ee7a8", unico: "#b49cff" };
const GIORNI = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class DescoCard extends HTMLElement {
  setConfig(config) {
    this._config = { titolo: "Desco", percorso: "/desco", mostra_promemoria: true, ...(config || {}) };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", () => this._apri());
      this.shadowRoot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._apri(); } });
    }
    this._firma = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // ridisegna solo se cambiano i sensori di Desco
    const ent = this._entita();
    const firma = Object.values(ent).map((s) => s && s.last_updated).join("|");
    if (firma !== this._firma) { this._firma = firma; this._render(); }
  }

  _entita() {
    const out = {};
    for (const [id, st] of Object.entries(this._hass?.states || {})) {
      if (id.startsWith("sensor.") && st.attributes && st.attributes.desco) out[st.attributes.desco] = st;
    }
    return out;
  }

  _apri() {
    history.pushState(null, "", this._config.percorso);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  _riga(icona, titolo, sotto, st) {
    const vuoto = !st || st.state === "Nessun pasto" || st.state === "unavailable" || st.state === "unknown";
    const voci = (st && st.attributes.voci) || [];
    const corpo = vuoto
      ? `<span class="tenue">Niente in programma</span>`
      : voci.map((v) => `<span class="voce"><i style="--c:${COLORI[v.cat] || "#8aa4b8"}"></i>${escH(v.nome)}</span>`).join("");
    const meta = !vuoto && st.attributes.minuti != null ? `<span class="meta">${st.attributes.minuti}′ · <b>${escH(st.attributes.costo || "")}</b></span>` : "";
    return `<div class="riga">
      <span class="badge"><ha-icon icon="${icona}"></ha-icon></span>
      <div class="testo"><div class="tit"><b>${titolo}</b><span>${sotto}</span>${meta}</div><div class="voci">${corpo}</div></div>
    </div>`;
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const e = this._entita();
    const oggi = new Date();
    const pr = e.promemoria_sera;
    const promemoria = this._config.mostra_promemoria && pr && pr.state && !/^Niente/.test(pr.state)
      ? `<div class="sera"><ha-icon icon="mdi:bell-ring-outline"></ha-icon><span>${escH(pr.state)}</span></div>` : "";
    const manca = !e.pranzo_oggi && !e.cena_oggi;
    this.shadowRoot.innerHTML = `<style>${STILE}</style>
      <ha-card role="button" tabindex="0" aria-label="Apri Desco: i pasti di oggi">
        <div class="testa">
          <span class="badge"><ha-icon icon="mdi:silverware-fork-knife"></ha-icon></span>
          <div class="tit"><b>${escH(this._config.titolo)}</b><span>${GIORNI[oggi.getDay()]} ${oggi.getDate()}</span></div>
          <ha-icon class="freccia" icon="mdi:chevron-right"></ha-icon>
        </div>
        ${manca ? `<div class="riga"><span class="tenue">Desco non è configurato: aggiungi l'integrazione.</span></div>` : `
          ${this._riga("mdi:food-takeout-box-outline", "Pranzo", "Linda", e.pranzo_oggi)}
          ${this._riga("mdi:silverware-variant", "Cena", "per 2", e.cena_oggi)}
          ${promemoria}`}
      </ha-card>`;
  }

  getCardSize() { return 3; }
  static getStubConfig() { return {}; }
}

const STILE = `
:host { display:block; }
ha-card { cursor:pointer; border-radius:var(--ha-card-border-radius, 32px); padding:10px 14px 12px 10px; display:flex; flex-direction:column; gap:8px; transition:filter .15s; }
ha-card:hover { filter:brightness(1.08); }
ha-card:focus-visible { outline:2px solid var(--primary-color); outline-offset:2px; }
.testa, .riga { display:flex; align-items:center; gap:12px; }
.riga { align-items:flex-start; }
.badge { width:40px; height:40px; border-radius:50%; flex:none; display:grid; place-items:center;
  background:var(--desco-badge, rgba(79,195,247,0.12)); color:var(--desco-accento, var(--state-icon-color, #4fc3f7)); }
.badge ha-icon { --mdc-icon-size:20px; }
.tit { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; line-height:1.2; }
.testa .tit { flex-direction:column; gap:0; }
.tit b { font-size:14px; font-weight:700; }
.tit span { font-size:12px; color:var(--secondary-text-color); }
.testo { flex:1; min-width:0; padding-top:2px; }
.meta { margin-left:auto; font-size:12px; color:var(--secondary-text-color); white-space:nowrap; }
.meta b { color:#6ee7a8; }
.voci { display:flex; flex-wrap:wrap; gap:2px 12px; margin-top:4px; font-size:13px; }
.voce { display:inline-flex; align-items:center; gap:6px; }
.voce i { width:7px; height:7px; border-radius:50%; background:var(--c); box-shadow:0 0 6px var(--c); }
.tenue { color:var(--secondary-text-color); font-size:13px; }
.freccia { margin-left:auto; color:var(--secondary-text-color); }
.sera { display:flex; align-items:center; gap:8px; margin-left:52px; padding:6px 12px; border-radius:999px; font-size:12px;
  background:rgba(255,204,102,0.10); color:#ffd27a; }
.sera ha-icon { --mdc-icon-size:16px; }
`;

if (!customElements.get("desco-card")) customElements.define("desco-card", DescoCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "desco-card")) {
  window.customCards.push({ type: "desco-card", name: "Desco", description: "I pasti di oggi; un tocco apre l'app Desco.", preview: true });
}
