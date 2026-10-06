// Pulsacions en directe per Bluetooth (servei estàndard Heart Rate 0x180D).
// Funciona amb rellotges Polar en mode "Share HR with other device", bandes de pit i altres sensors.
// Només hi ha Web Bluetooth a Chrome/Edge (Android i ordinador); a l'iPhone no és possible.

export const hrSupported = () => !!navigator.bluetooth;

export class HeartRate {
  constructor() {
    this.device = null; this.bpm = null; this.last = 0; this.status = 'off'; this.name = '';
    this.listeners = new Set(); this.manual = false;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(f => { try { f(); } catch {} }); }
  get fresh() { return this.status === 'connected' && Date.now() - this.last < 5000 && this.bpm > 0; }

  // Cal cridar-ho des d'un toc de l'usuari: el navegador mostra la llista de dispositius
  async connect() {
    if (!hrSupported()) throw new Error('Aquest navegador no té Bluetooth. Fes servir Chrome a Android.');
    this.manual = false;
    this.status = 'connecting'; this.emit();
    try {
      this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    } catch (e) {
      this.status = 'off'; this.emit();
      if (e.name === 'NotFoundError') return false; // l'usuari ha cancel·lat
      throw new Error('No s\'ha pogut obrir el Bluetooth. Comprova que està activat.');
    }
    this.name = this.device.name || 'Pulsòmetre';
    this.device.addEventListener('gattserverdisconnected', () => this.reconnect());
    await this.attach();
    return true;
  }

  async attach() {
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', e => this.parse(e.target.value));
    await ch.startNotifications();
    this.status = 'connected'; this.emit();
  }

  parse(dv) {
    const flags = dv.getUint8(0);
    this.bpm = flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
    this.last = Date.now();
    this.emit();
  }

  async reconnect() {
    if (this.manual || !this.device) { this.status = 'off'; this.emit(); return; }
    this.status = 'reconnecting'; this.emit();
    for (let i = 0; i < 6 && !this.manual; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      try { await this.attach(); return; } catch { /* tornem-ho a provar */ }
    }
    this.status = 'lost'; this.emit();
  }

  disconnect() {
    this.manual = true;
    try { this.device?.gatt.disconnect(); } catch {}
    this.status = 'off'; this.bpm = null; this.emit();
  }
}
