const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.apiBase) || '').replace(/\/+$/, '');
const BUILD_VERSION = (window.APP_CONFIG && window.APP_CONFIG.buildVersion) || '';

const VIEW_KEY = 'cardtrader-view';
const CARD_CACHE_KEY = 'cardtrader-scryfall-v1';
const VIEW_FIELDS = [
  'filter', 'q', 'sort', 'dir', 'groupBy', 'collapsed',
  'rarityFilter', 'expansionFilter', 'colorFilter',
];

Vue.createApp({
  data: () => ({ orders: [], order: null, idInput: '', error: '', loading: false, lastUpdate: '',
    buildVersion: BUILD_VERSION,
    canInstall: false, installPrompt: null,
    notificationSupported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    notificationsEnabled: false, notificationBusy: false, notificationMessage: '', notificationError: false,
    pushServerReady: false,
    box: [], boxError: '', boxLoading: false, busy: false, boxLoaded: false,
    cardInfo: {}, cardInfoLoading: false,
    groupBy: '', filter: 'all', q: '', sort: 'paid', dir: -1, collapsed: {}, open: null,
    rarityFilter: '', expansionFilter: '', colorFilter: '',
    showExport: false,
    exp: { status: 'all', seller: '', q: '', format: 'text', withExp: false, merge: true, copied: false },
    COLORS: [
      { key: 'red', label: 'Rosso' },
      { key: 'blue', label: 'Blu' },
      { key: 'green', label: 'Verde' },
      { key: 'white', label: 'Bianco' },
      { key: 'black', label: 'Nero' },
      { key: 'colorless', label: 'Incolore' },
    ],
    STATUSES: [
      { key: 'presale', label: 'Prevendita', color: '#7c3aed' },
      { key: 'incoming', label: 'In arrivo', color: '#d97706' },
      { key: 'arrived', label: 'Arrivato in box', color: '#16a34a' },
      { key: 'returned', label: 'Reso', color: '#6b7280' },
      { key: 'cancelled', label: 'Annullato', color: '#dc2626' }] }),
  created() {
    try { this.cardInfo = JSON.parse(localStorage.getItem(CARD_CACHE_KEY) || '{}') || {}; } catch (e) { /* cache non valida: ignorata */ }
    try {
      const s = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      VIEW_FIELDS.forEach(k => { if (s[k] !== undefined) this[k] = s[k]; });
    } catch (e) { /* preferenze non valide: ignorate */ }
    VIEW_FIELDS.forEach(k => this.$watch(k, () => {
      const o = {}; VIEW_FIELDS.forEach(f => { o[f] = this[f]; });
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(o)); } catch (e) { /* storage non disponibile */ }
    }, { deep: true }));
  },
  mounted() {
    this.loadList();
    this.loadBox();
    setInterval(() => this.loadBox(true), 5000);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js')
        .then(() => this.refreshNotifications())
        .catch(error => {
          console.error('Registrazione della modalità offline non riuscita:', error);
          this.notificationError = true;
          this.notificationMessage = 'Impossibile preparare il servizio notifiche.';
        });
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.installPrompt = event;
      this.canInstall = true;
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.canInstall = false;
    });
  },
  computed: {
    counts() { const c = {}; this.box.forEach(b => { const k = this.st(b).key; c[k] = (c[k] || 0) + 1; }); return c; },
    totalValue() {
      const t = this.box.reduce((s, b) => s + ((b.buyer_price && b.buyer_price.cents) || 0) * this.qty(b), 0);
      return (t / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
    },
    groups() {
      const fmt = c => (c / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
      const mk = (key, label, items) => ({ key, label, items,
        total: fmt(items.reduce((s, b) => s + ((b.buyer_price && b.buyer_price.cents) || 0) * this.qty(b), 0)) });
      if (!this.groupBy) return [mk('all', '', this.shown)];
      const m = new Map();
      this.shown.forEach(b => {
        const k = this.groupBy === 'status' ? this.st(b).key : ((b.seller && b.seller.username) || 'Sconosciuto');
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(b);
      });
      if (this.groupBy === 'status')
        return this.STATUSES.filter(s => m.has(s.key)).map(s => mk(s.key, s.label, m.get(s.key)));
      return [...m].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => mk(k, k, v));
    },
    sellers() {
      return [...new Set(this.box.map(b => b.seller && b.seller.username).filter(Boolean))].sort();
    },
    rarities() {
      return [...new Set(this.box.map(b => this.rarityName(b)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'it'));
    },
    expansions() {
      return [...new Set(this.box.map(b => this.expName(b)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'it'));
    },
    exportRows() {
      const e = this.exp, q = e.q.toLowerCase();
      const out = this.box
        .filter(b => (e.status === 'all' || this.st(b).key === e.status) &&
          (!e.seller || (b.seller && b.seller.username) === e.seller) &&
          (!q || [b.name, this.expName(b), b.seller && b.seller.username].join(' ').toLowerCase().includes(q)))
        .map(b => ({ qty: this.qty(b), name: b.name || '', exp: this.expName(b) }));
      if (!e.merge) return out;
      const m = new Map();
      out.forEach(r => {
        const k = r.name + '|' + r.exp;
        if (m.has(k)) m.get(k).qty += r.qty; else m.set(k, { ...r });
      });
      return [...m.values()];
    },
    exportTotal() { return this.exportRows.reduce((s, r) => s + r.qty, 0); },
    exportOutput() {
      const e = this.exp;
      if (e.format === 'csv') {
        const esc = v => `"${String(v).replace(/"/g, '""')}"`;
        return [e.withExp ? 'quantity,name,expansion' : 'quantity,name',
          ...this.exportRows.map(r => [r.qty, esc(r.name), ...(e.withExp ? [esc(r.exp)] : [])].join(','))].join('\n');
      }
      return this.exportRows.map(r => `${r.qty} ${r.name}${e.withExp && r.exp ? ` (${r.exp})` : ''}`).join('\n');
    },
    shown() {
      const q = this.q.toLowerCase();
      let l = this.box.filter(b => (this.filter === 'all' || this.st(b).key === this.filter) &&
        (!this.rarityFilter || this.rarityName(b) === this.rarityFilter) &&
        (!this.expansionFilter || this.expName(b) === this.expansionFilter) &&
        (!this.colorFilter || this.cardColors(b).includes(this.colorFilter)) &&
        (!q || [b.name, this.expName(b), this.rarityName(b), b.seller && b.seller.username]
          .join(' ').toLowerCase().includes(q)));
      const s = this.sort, dir = this.dir;
      const t = x => (x ? new Date(x).getTime() : null);
      const order = k => this.STATUSES.findIndex(x => x.key === k);
      const val = b =>
        s === 'name' ? (b.name || '').toLowerCase() :
        s === 'seller' ? ((b.seller && b.seller.username) || '').toLowerCase() :
        s === 'exp' ? this.expName(b).toLowerCase() :
        s === 'price' ? ((b.buyer_price && b.buyer_price.cents) || 0) :
        s === 'qty' ? this.qty(b) :
        s === 'status' ? order(this.st(b).key) :
        s === 'eta' ? t(b.estimated_arrived_at) :
        s === 'arrived' ? t(b.arrived_at) : t(b.paid_at);
      return l.slice().sort((a, b) => {
        const x = val(a), y = val(b);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
      });
    }
  },
  methods: {
    async refreshNotifications() {
      if (!this.notificationSupported) return;
      this.notificationError = false;
      try {
        const config = await this.api('/push/config');
        this.pushServerReady = config.enabled && Boolean(config.publicKey);
        if (!this.pushServerReady) {
          this.notificationMessage = 'Notifiche push non configurate sul server. Consulta le istruzioni nel README.';
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        this.notificationsEnabled = Boolean(await registration.pushManager.getSubscription());
        this.notificationMessage = this.notificationsEnabled ? 'Notifiche attive su questo dispositivo.' : '';
      } catch (error) {
        this.notificationError = true;
        this.notificationMessage = error.message;
      }
    },
    async enableNotifications() {
      if (this.notificationBusy) return;
      this.notificationBusy = true;
      this.notificationError = false;
      try {
        const permission = Notification.permission === 'granted'
          ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Consenti le notifiche nelle impostazioni del browser per attivarle.');

        const config = await this.api('/push/config');
        if (!config.enabled || !config.publicKey) throw new Error('Notifiche push non configurate sul server.');

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.decodeVapidKey(config.publicKey),
          });
        }
        const response = await fetch(API_BASE + '/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Errore ${response.status} durante l’attivazione.`);
        this.notificationsEnabled = true;
        this.notificationMessage = 'Notifiche attive su questo dispositivo.';
      } catch (error) {
        this.notificationError = true;
        this.notificationMessage = error.message;
      } finally {
        this.notificationBusy = false;
      }
    },
    async disableNotifications() {
      if (this.notificationBusy) return;
      this.notificationBusy = true;
      this.notificationError = false;
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch(API_BASE + '/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || `Errore ${response.status} durante la disattivazione.`);
          await subscription.unsubscribe();
        }
        this.notificationsEnabled = false;
        this.notificationMessage = 'Notifiche disattivate su questo dispositivo.';
      } catch (error) {
        this.notificationError = true;
        this.notificationMessage = error.message;
      } finally {
        this.notificationBusy = false;
      }
    },
    decodeVapidKey(value) {
      const padding = '='.repeat((4 - value.length % 4) % 4);
      const decoded = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(decoded, character => character.charCodeAt(0));
    },
    async installApp() {
      if (!this.installPrompt) return;
      await this.installPrompt.prompt();
      await this.installPrompt.userChoice;
      this.installPrompt = null;
      this.canInstall = false;
    },
    st(b) {
      const k = b.cancelled_at ? 'cancelled' : b.return_to_seller ? 'returned' : b.arrived_at ? 'arrived'
        : b.presale ? 'presale' : 'incoming';
      return this.STATUSES.find(s => s.key === k);
    },
    late(b) { return !b.arrived_at && !b.cancelled_at && !b.return_to_seller && b.estimated_arrived_at && new Date(b.estimated_arrived_at) < new Date(); },
    qty(b) { return b.quantity ? Object.values(b.quantity).reduce((a, n) => a + (+n || 0), 0) : 1; },
    expName(b) {
      const blueprint = b.blueprint || b.card || {};
      const expansion = b.expansion || blueprint.expansion;
      return ((expansion && expansion.name) || expansion || b.expansion_name || blueprint.expansion_name || '').toString();
    },
    rarityName(b) {
      const sources = [b, b.blueprint, b.card, b.properties].filter(value => value && typeof value === 'object');
      const info = this.cardInfo[b.scryfall_id] || {};
      const cardType = [info.type, ...sources.map(source => source.type_line || source.card_type || source.mtg_type || source.type || '')]
        .join(' ').toLowerCase();
      if (/\bland\b/.test(cardType) || (b.properties && b.properties.mtg_card_colors === 'L')) return 'L';
      for (const source of sources) {
        const value = source.rarity || source.rarity_name || source.mtg_rarity;
        if (value) {
          const rarity = (value.name || value).toString().trim().toLowerCase();
          if (/\bland\b/.test(rarity)) return 'L';
          if (rarity === 'common') return 'C';
          if (rarity === 'uncommon') return 'U';
          if (rarity === 'rare') return 'R';
          if (rarity === 'mythic' || rarity === 'mythic rare' || rarity === 'mythicrare') return 'M';
          return (value.name || value).toString();
        }
      }
      return '';
    },
    rarityLabel(b) {
      return ({ C: 'Common', U: 'Uncommon', R: 'Rara', M: 'Mythic', L: 'Land' })[this.rarityName(b)] || this.rarityName(b);
    },
    async loadCardInfo() {
      if (this.cardInfoLoading) return;
      const ids = [...new Set(this.box.map(b => b.scryfall_id).filter(id => id && !this.cardInfo[id]))];
      if (!ids.length) return;
      this.cardInfoLoading = true;
      try {
        const info = { ...this.cardInfo };
        for (let i = 0; i < ids.length; i += 75) {
          const r = await fetch('https://api.scryfall.com/cards/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map(id => ({ id })) }),
          });
          if (!r.ok) throw new Error('Scryfall ' + r.status);
          const j = await r.json();
          (j.data || []).forEach(card => {
            const face = (card.card_faces || [])[0] || {};
            info[card.id] = { mana: card.mana_cost || face.mana_cost || '', type: card.type_line || face.type_line || '' };
          });
          (j.not_found || []).forEach(card => { if (card.id) info[card.id] = { mana: '', type: '' }; });
          if (i + 75 < ids.length) await new Promise(resolve => setTimeout(resolve, 150));
        }
        this.cardInfo = info;
        try { localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(info)); } catch (e) { /* storage non disponibile */ }
      } catch (e) { console.warn('Costo di mana non disponibile:', e); }
      this.cardInfoLoading = false;
    },
    // Posizione del simbolo nella tavola Mana.svg (celle da 105px, scala 0.2 → passo 21px)
    manaSprite(token) {
      const pos = (col, row) => `${col * -21}px ${row * -21}px`;
      const colors = 'WUBRG';
      const hybrids = ['W/U', 'W/B', 'U/B', 'U/R', 'B/R', 'B/G', 'R/W', 'R/G', 'G/W', 'G/U'];
      if (/^\d+$/.test(token)) {
        const n = Number(token);
        if (n <= 9) return pos(n, 0);
        if (n <= 19) return pos(n - 10, 1);
        return n === 20 ? pos(0, 2) : null;
      }
      if (token.length === 1 && 'XYZ'.includes(token)) return pos('XYZ'.indexOf(token) + 1, 2);
      if (token.length === 1 && colors.includes(token)) return pos(colors.indexOf(token) + 4, 2);
      if (token === 'S') return pos(9, 2);
      let hybrid = hybrids.indexOf(token);
      if (hybrid < 0) hybrid = hybrids.indexOf(token.split('/').reverse().join('/'));
      if (hybrid >= 0) return pos(hybrid, 3);
      const twoColor = /^2\/([WUBRG])$/.exec(token);
      if (twoColor) return pos(colors.indexOf(twoColor[1]), 4);
      const phyrexian = /^([WUBRG])\/P$/.exec(token);
      if (phyrexian) return pos(colors.indexOf(phyrexian[1]) + 5, 4);
      return null;
    },
    manaSymbols(b) {
      const sources = [b.blueprint, b.card, b.properties, b].filter(value => value && typeof value === 'object');
      let cost = (this.cardInfo[b.scryfall_id] || {}).mana || undefined;
      for (const source of cost ? [] : sources) {
        for (const key of ['mana_cost', 'mtg_mana_cost', 'manaCost', 'casting_cost', 'castingCost']) {
          if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            cost = source[key];
            break;
          }
        }
        if (cost !== undefined) break;
      }
      if (Array.isArray(cost)) cost = cost.map(value =>
        value && typeof value === 'object' ? value.value || value.name || value.symbol || '' : value).join('');
      else if (cost && typeof cost === 'object') cost = cost.value || cost.name || cost.symbol || '';
      if (typeof cost !== 'string') return [];

      const tokens = cost.match(/\{([^}]+)\}|[0-9]+|[WUBRGCXYZTS]/gi) || [];
      return tokens.map((raw, index) => {
        const token = (raw[0] === '{' ? raw.slice(1, -1) : raw).toUpperCase();
        return { key: `${index}-${token}`, label: token, position: this.manaSprite(token) };
      });
    },
    cardColors(b) {
      const sources = [b, b.blueprint, b.card, b.properties].filter(value => value && typeof value === 'object');
      let raw;
      for (const source of sources) {
        for (const key of ['colors', 'mana_colors', 'mtg_colors', 'color_identity', 'color', 'mana_color', 'mtg_color']) {
          if (source[key] !== undefined && source[key] !== null) {
            raw = source[key];
            break;
          }
        }
        if (raw !== undefined) break;
      }
      if (raw === undefined) return [];

      const values = [];
      const collect = value => {
        if (Array.isArray(value)) {
          value.forEach(collect);
        } else if (value && typeof value === 'object') {
          if (value.name || value.value) collect(value.name || value.value);
          else Object.entries(value).forEach(([key, enabled]) => { if (enabled) collect(key); });
        } else if (typeof value === 'string') {
          value.split(/[,/|;]/).forEach(part => values.push(part.trim().toLowerCase()));
        }
      };
      collect(raw);

      const aliases = {
        r: 'red', rosso: 'red', red: 'red',
        u: 'blue', blu: 'blue', blue: 'blue',
        g: 'green', verde: 'green', green: 'green',
        w: 'white', bianco: 'white', white: 'white',
        b: 'black', nero: 'black', black: 'black',
        c: 'colorless', incolore: 'colorless', colorless: 'colorless',
      };
      const colors = [...new Set(values.map(value => aliases[value]).filter(Boolean))];
      if (colors.length) return colors;
      return Array.isArray(raw) && raw.length === 0 ? ['colorless'] : [];
    },
    colorLabel(key) {
      const color = this.COLORS.find(item => item.key === key);
      return color ? color.label : '';
    },
    async copyExport() {
      try {
        await navigator.clipboard.writeText(this.exportOutput);
        this.exp.copied = true; setTimeout(() => { this.exp.copied = false; }, 1500);
      } catch (e) { this.error = 'Copia non riuscita: ' + e.message; }
    },
    downloadExport() {
      const csv = this.exp.format === 'csv';
      const blob = new Blob([this.exportOutput], { type: csv ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'carte.' + (csv ? 'csv' : 'txt');
      a.click(); URL.revokeObjectURL(a.href);
    },
    d(x) { return x ? new Date(x).toLocaleDateString('it-IT') : '—'; },
    toggle(id) { this.open = this.open === id ? null : id; },
    async api(path) {
      const r = await fetch(API_BASE + '/api' + path);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Errore ${r.status}: ${j.errors || j.error || ''}`);
      return j;
    },
    async loadList() {
      this.loading = true; this.error = '';
      try {
        const j = await this.api('/orders?sort=date.desc');
        this.orders = Array.isArray(j) ? j : (j.array || j.orders || []);
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    async loadBox(silent) {
      if (this.boxLoading || this.busy) return;
      this.busy = true;
      if (silent !== true) { this.boxLoading = true; this.boxError = ''; }
      try {
        const j = await this.api('/ct0_box_items');
        this.box = Array.isArray(j) ? j : (j.array || j.ct0_box_items || j.items || []);
        this.boxLoaded = true;
        this.lastUpdate = new Date().toLocaleTimeString('it-IT');
        this.loadCardInfo();
      } catch (e) { if (silent !== true) this.boxError = e.message; }
      this.busy = false;
      this.boxLoading = false;
    },
    async loadOrder(id) {
      if (!id) return;
      this.error = '';
      try { this.order = await this.api('/orders/' + encodeURIComponent(id)); this.idInput = id; }
      catch (e) { this.error = e.message; this.order = null; }
    },
    name(u) { return u ? (u.username || u.name || '') : ''; },
    fmt(d) { return d ? new Date(d).toLocaleString('it-IT') : ''; },
    money(p) {
      if (p == null) return '';
      if (typeof p === 'object') return (p.formatted || (p.cents / 100) + ' ' + (p.currency || ''));
      return p;
    },
  },
}).mount('#app');
