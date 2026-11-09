/* Voce «Marketplace» nella barra laterale: porta subito al Marketplace integrato di Home Assistant. */
class DescoScorciatoia extends HTMLElement {
  set panel(p) { this._dest = p?.config?.destinazione || "/marketplace"; this._vai(); }
  set hass(h) { this._vai(); }
  connectedCallback() { this._vai(); }
  _vai() {
    if (this._fatto || !this.isConnected) return;
    this._fatto = true;
    const dest = this._dest || "/marketplace";
    setTimeout(() => {
      history.replaceState(null, "", dest);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
    }, 0);
  }
}
if (!customElements.get("desco-scorciatoia")) customElements.define("desco-scorciatoia", DescoScorciatoia);
