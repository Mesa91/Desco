# Desco

Menu settimanale equilibrato per Home Assistant: per ogni pasto **una proteina, un carboidrato e una verdura** (oppure un piatto unico che li contiene già), facili, veloci ed economici.

- **Lunedì–venerdì**: pranzo da portare al lavoro (1 porzione) e cena a casa (2 porzioni)
- **Proporzioni settimanali** impostabili: di base 3 legumi, 3 pesce, 3 carne, 1 uova, 2 salumi/formaggi; salumi e formaggi sono l'ultima scelta e usano solo i posti che restano (carne rossa al massimo una volta). Non ripete i piatti nella settimana e varia rispetto alla settimana prima
- **Costo e tempo**: budget economico/normale/libero, tempo massimo per piatto, verdure di stagione (filtrate e preferite rispetto a quelle «tutto l'anno»)
- **Pranzi trasportabili**: a pranzo solo piatti buoni freddi o da scaldare (se c'è il microonde); come pesce solo tonno in scatola (impostabile)
- **Alimenti da non usare**: basta una parola («funghi», «salmone») per escludere ogni piatto che li contiene
- **Cena doppia → pranzo di domani**: un contorno della cena (cereali, verdure cotte) si cucina doppio e diventa il pranzo di Linda del giorno dopo
- **Preparazione in anticipo**: cosa cucinare la domenica (per lun–mer) e il mercoledì sera (per gio–ven)
- **Ricetta completa con Gemini**: per ogni pasto ordine delle operazioni, tempi in parallelo e come sistemarlo nel contenitore
- **👍 / 👎**: i piatti che vi piacciono escono più spesso, quelli bocciati non vengono più proposti
- **Promemoria serale** sul telefono: pranzo di domani, cosa cucinare doppio, cosa scongelare, preparazione in anticipo
- **Trascina e scambia**: sposta un pasto su un altro giorno o tra pranzo e cena (mouse e touch)
- **Storico**: ogni settimana passata resta consultabile, divisa per mese, e si può riproporre
- **Menu automatico con approvazione**: il giorno e l'ora scelti (di base venerdì alle 21) Desco prepara il menu della settimana dopo e manda ai telefoni la notifica «Menu dal … al … da approvare» (il tocco apre Desco); con «Approva e crea la spesa» compila la lista della spesa e mostra la conferma nel pannello
- **Annulla**: dopo un cambio indesiderato (rigenera, ⇄, trascinamento) un tasto riporta il menu com'era
- **Dispensa e freezer**: quello che avete già in casa esce dalla spesa e il menu preferisce i piatti che lo usano
- **Lista della spesa**: un tasto invia gli ingredienti della settimana alla To-do di Home Assistant
- **Gemini (facoltativo)**: suggerisce piatti nuovi da aggiungere al ricettario con il piano gratuito di Google AI Studio
- Ricettario integrato con 88 piatti; puoi disattivarli, modificarne una tua versione o aggiungerne di tuoi

## Installazione

Da Home Assistant 2026.11 (Marketplace integrato):

1. Impostazioni → **Marketplace** → **Aggiungi da link** (in alto a destra)
2. Incolla `https://github.com/Mesa91/Desco` (tipo **Integrazione**; serve il collegamento a GitHub)
3. Apri **Desco** → **Installa** e riavvia Home Assistant
4. Impostazioni → Dispositivi e servizi → **Aggiungi integrazione** → Desco
   - la lista della spesa viene trovata da sola (si può cambiare da **Configura**)
   - la chiave Gemini è facoltativa (si può aggiungere dopo da **Configura**)

Su Home Assistant 2026.10 o precedenti: HACS → Repository personalizzati → stesso URL, categoria Integrazione.

Gli aggiornamenti compaiono nella scheda **Installati** del Marketplace. Nella barra laterale compare **Desco**.

## Uso

- **Settimana**: *Genera* crea il menu (da lunedì a venerdì la settimana in corso, nel weekend la prossima). Tocca un piatto per vedere ingredienti e preparazione; ⇄ cambia solo quel componente, ✎ lo scegli tu, ↻ rifà tutto il pasto, 🔒 blocca un pasto quando rigeneri.
- Per scambiare due pasti trascinali dalla maniglia ⠿ uno sull'altro: i piatti si spostano, le porzioni restano quelle dello slot (1 a pranzo, 2 a cena). Se a pranzo finisce un piatto poco adatto al trasporto compare un avviso.
- **Storico**: le settimane precedenti, aperte una per una; *Riproponi* rimette quella settimana come menu da cucinare.
- **Spesa**: elenco ingredienti con quantità; *Invia* li aggiunge alla To-do. Reinviando, le voci della volta prima non ancora spuntate vengono sostituite.
- **Ricettario**: attiva/disattiva piatti, crea i tuoi, *Idee con Gemini*.
- **Preferenze**: alimenti esclusi, tempo massimo, budget, microonde, verdure di stagione, quota di piatti unici, porzioni.

## Scheda per la dashboard

Desco aggiunge da solo la scheda `custom:desco-card`: mostra il pranzo e la cena di oggi e il promemoria della sera; un tocco apre l'app.

```yaml
type: custom:desco-card
# opzionali:
titolo: Desco
mostra_promemoria: true
```

## Entità

| Entità | Contenuto |
|---|---|
| `sensor.desco_pranzo_di_oggi` | pranzo di oggi; attributi `componenti`, `preparazione`, `minuti`, `costo` |
| `sensor.desco_cena_di_oggi` | cena di oggi |
| `sensor.desco_pranzo_di_domani` | pranzo di domani (utile per prepararlo la sera prima) |
| `sensor.desco_cena_di_domani` | cena di domani |
| `sensor.desco_stato_del_menu` | «Da approvare» / «Approvato» / «Nessun menu» |
| `sensor.desco_promemoria_di_stasera` | cosa preparare stasera per domani; attributo `testo` con il messaggio completo |

Servizi: `desco.genera_settimana` (`settimana: auto | corrente | prossima`), `desco.invia_lista_spesa`, `desco.invia_promemoria` e `desco.approva_menu`.

Il promemoria serale si attiva da Impostazioni → Dispositivi e servizi → Desco → **Configura**: scegli i telefoni (`notify.mobile_app_…`) e l'orario. Non serve nessuna automazione. Evento `desco_piano_aggiornato` a ogni modifica del menu.

## Esempi

Domenica sera: menu della settimana nuova e lista della spesa pronta.

```yaml
automation:
  - alias: Desco - menu della settimana
    triggers:
      - trigger: time
        at: "18:00:00"
    conditions:
      - condition: time
        weekday: [sun]
    actions:
      - action: desco.genera_settimana
        data:
          settimana: prossima
      - action: desco.invia_lista_spesa
```

La sera, promemoria del pranzo da preparare per domani:

```yaml
  - alias: Desco - pranzo di domani
    triggers:
      - trigger: time
        at: "20:30:00"
    conditions:
      - condition: time
        weekday: [sun, mon, tue, wed, thu]
      - condition: template
        value_template: "{{ states('sensor.desco_pranzo_di_domani') != 'Nessun pasto' }}"
    actions:
      - action: notify.mobile_app_telefono_di_linda
        data:
          title: "Pranzo di domani"
          message: "{{ states('sensor.desco_pranzo_di_domani') }}"
```

Scheda per la dashboard:

```yaml
type: markdown
content: |
  ### 🥡 Pranzo
  {{ states('sensor.desco_pranzo_di_oggi') }}
  ### 🍽️ Cena · {{ state_attr('sensor.desco_cena_di_oggi', 'minuti') }} min
  {{ states('sensor.desco_cena_di_oggi') }}
```

## Ricettario

Il ricettario integrato è in `custom_components/desco/data/ricettario.json`. Quantità per una persona; `asporto` = `freddo` / `caldo` / `no`; `costo` 1–3; `stagione` = mesi in cui la verdura è di stagione; gli ingredienti con `"dispensa": true` non finiscono nella lista della spesa. I piatti che crei dal pannello sono salvati in `.storage/desco.data` e sopravvivono agli aggiornamenti.
