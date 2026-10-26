/**
 * Mersin Kadastro – Müdür Ajandası → Google Takvim aktarımı
 * Bu script mersinkadastro33@gmail.com hesabında script.google.com'da çalışır.
 * Sayfadaki her kayıt/düzenleme/silme sonrası görev listesi buraya gelir;
 * script varsayılan takvime ekler, günceller veya siler.
 * Ayrıca 10 dakikada bir gorevler.json'u GitHub'dan okuyup yedek senkron yapar.
 */
const ANAHTAR = 'vx4kixPt1Vqei8obeFZJapSo'; // index.html'deki GCAL_ANAHTAR ile aynı
const GITHUB_DOSYA = 'https://raw.githubusercontent.com/gokhangeo/personelmesai/main/gorevler.json';
const ETIKET = 'mudurGorevId';

const RENK = {
  'Görev': CalendarApp.EventColor.MAUVE,
  'Toplantı': CalendarApp.EventColor.BLUE,
  'Saha / Keşif': CalendarApp.EventColor.GREEN,
  'Diğer': CalendarApp.EventColor.GRAY
};

/** İlk kurulumda bir kez çalıştırın: izin ister ve 10 dk'lık yedek senkronu kurar. */
function kurulum() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'zamanliSenkron') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('zamanliSenkron').timeBased().everyMinutes(10).create();
  zamanliSenkron();
  Logger.log('Kurulum tamam. Takvim: ' + CalendarApp.getDefaultCalendar().getName());
}

function doPost(e) {
  try {
    const veri = JSON.parse(e.postData.contents);
    if (veri.anahtar !== ANAHTAR) return cevap({ ok: false, hata: 'yetkisiz' });
    const sonuc = senkronize(veri.gorevler || []);
    return cevap(Object.assign({ ok: true }, sonuc));
  } catch (err) {
    return cevap({ ok: false, hata: String(err) });
  }
}

function doGet() {
  return cevap({ ok: true, mesaj: 'Müdür Ajandası Google Takvim bağlantısı çalışıyor.' });
}

function zamanliSenkron() {
  // raw.githubusercontent kullanılır (api.github.com Google sunucularına 403/limit veriyor)
  const res = UrlFetchApp.fetch(GITHUB_DOSYA + '?t=' + Date.now(), { muteHttpExceptions: true });
  const kod = res.getResponseCode();
  if (kod === 404) return senkronize([]);
  if (kod !== 200) { Logger.log('GitHub okunamadı: ' + kod + ' (bir sonraki turda tekrar denenecek)'); return; }
  return senkronize(JSON.parse(res.getContentText('UTF-8')));
}

function senkronize(gorevler) {
  const kilit = LockService.getScriptLock();
  kilit.waitLock(30000);
  try {
    const takvim = CalendarApp.getDefaultCalendar();
    const props = PropertiesService.getScriptProperties();
    const harita = JSON.parse(props.getProperty('harita') || '{}'); // gorevId -> {eventId, hash}
    let eklenen = 0, guncellenen = 0, silinen = 0;
    const mevcutIdler = {};

    gorevler.forEach(g => {
      if (!g || !g.id || !g.tarih || !g.baslik) return;
      const id = String(g.id);
      mevcutIdler[id] = true;
      const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(g), Utilities.Charset.UTF_8));
      const kayit = harita[id];
      let ev = null;
      if (kayit) {
        if (kayit.hash === hash) return; // değişiklik yok
        try { ev = takvim.getEventById(kayit.eventId); } catch (x) { ev = null; }
      }
      const baslik = (g.tamamlandi ? '✔ ' : '') + g.baslik;
      const aciklama = [g.kategori ? 'Tür: ' + g.kategori : '', g.aciklama || '', '', 'Mersin Kadastro – Müdür Ajandası'].filter((s, i) => s || i === 2).join('\n');

      if (ev && ev.isAllDayEvent() !== !!g.tumGun) { ev.deleteEvent(); ev = null; }
      if (ev) {
        ev.setTitle(baslik);
        if (g.tumGun) ev.setAllDayDate(gun(g.tarih));
        else ev.setTime(zaman(g.tarih, g.baslangic), zaman(g.tarih, g.bitis));
        ev.setLocation(g.yer || '');
        ev.setDescription(aciklama);
        guncellenen++;
      } else {
        const sec = { location: g.yer || '', description: aciklama };
        ev = g.tumGun
          ? takvim.createAllDayEvent(baslik, gun(g.tarih), sec)
          : takvim.createEvent(baslik, zaman(g.tarih, g.baslangic), zaman(g.tarih, g.bitis), sec);
        ev.setTag(ETIKET, id);
        if (!g.tumGun) { ev.removeAllReminders(); ev.addPopupReminder(30); }
        eklenen++;
      }
      if (RENK[g.kategori]) ev.setColor(RENK[g.kategori]);
      harita[id] = { eventId: ev.getId(), hash: hash };
    });

    Object.keys(harita).forEach(id => {
      if (mevcutIdler[id]) return;
      try { const ev = takvim.getEventById(harita[id].eventId); if (ev) ev.deleteEvent(); } catch (x) {}
      delete harita[id];
      silinen++;
    });

    props.setProperty('harita', JSON.stringify(harita));
    return { eklenen: eklenen, guncellenen: guncellenen, silinen: silinen };
  } finally {
    kilit.releaseLock();
  }
}

// Türkiye sabit UTC+3
function zaman(tarih, saat) { return new Date(tarih + 'T' + (saat || '09:00') + ':00+03:00'); }
function gun(tarih) { const p = tarih.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function cevap(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
