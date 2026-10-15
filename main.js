const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.apiBase) || '').replace(/\/+$/, '');

Vue.createApp({
  data: () => ({ orders: [], order: null, idInput: '', error: '', loading: false, lastUpdate: '',
    canInstall: false, installPrompt: null,
    notificationSupported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    notificationsEnabled: false, notificationBusy: false, notificationMessage: '', notificationError: false,
    pushServerReady: false,
    box: [], boxError: '', boxLoading: false, busy: false, boxLoaded: false,
    groupBy: '', filter: 'all', q: '', sort: 'paid', dir: -1, collapsed: {}, open: null,
    STATUSES: [
      { key: 'presale', label: 'Prevendita', color: '#7c3aed' },
      { key: 'incoming', label: 'In arrivo', color: '#d97706' },
      { key: 'arrived', label: 'Arrivato in box', color: '#16a34a' },
      { key: 'returned', label: 'Reso', color: '#6b7280' },
      { key: 'cancelled', label: 'Annullato', color: '#dc2626' }] }),
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
    shown() {
      const q = this.q.toLowerCase();
      let l = this.box.filter(b => (this.filter === 'all' || this.st(b).key === this.filter) &&
        (!q || [b.name, b.expansion, b.seller && b.seller.username].join(' ').toLowerCase().includes(q)));
      const s = this.sort, dir = this.dir;
      const t = x => (x ? new Date(x).getTime() : null);
      const order = k => this.STATUSES.findIndex(x => x.key === k);
      const val = b =>
        s === 'name' ? (b.name || '').toLowerCase() :
        s === 'seller' ? ((b.seller && b.seller.username) || '').toLowerCase() :
        s === 'exp' ? (b.expansion && b.expansion.name || b.expansion || '').toString().toLowerCase() :
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
