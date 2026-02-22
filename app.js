(function () {
  "use strict";

  const STORAGE_KEY = "proteinDrinkTracker";
  const THEME_KEY = "proteinTheme";
  const LANG_KEY = "proteinTrackerLang";
  const REMINDER_KEY = "proteinReminder";
  const RESET_HOUR = 2; // 2am local
  const HISTORY_MAX_DAYS = 365;

  const WORLD_CITIES = [
    { name: "New York", timeZone: "America/New_York" },
    { name: "London", timeZone: "Europe/London" },
    { name: "İstanbul", timeZone: "Europe/Istanbul" },
    { name: "Tokyo", timeZone: "Asia/Tokyo" },
    { name: "Sydney", timeZone: "Australia/Sydney" },
    { name: "Santo Domingo", timeZone: "America/Santo_Domingo" },
  ];

  /* --- Location Variables --- */
  let userLocation = { city: "Local Time", timeZone: undefined };

  // Get preferred language (default: en)
  let currentLang = localStorage.getItem(LANG_KEY) || "en";

  /**
   * App "day" = from 2:00 AM to 1:59 AM next calendar day (local).
   * Returns YYYY-MM-DD for the current app day.
   */
  function getDateKey() {
    const now = new Date();
    const hour = now.getHours();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (hour < RESET_HOUR) {
      date.setDate(date.getDate() - 1);
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDisplayDate(dateKey) {
    const d = parseDateKey(dateKey);
    return d.toLocaleDateString(currentLang, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw)
        return {
          dateKey: null,
          drank: false,
          drinkTimestamps: [],
          history: [],
        };
      const data = JSON.parse(raw);
      const history = Array.isArray(data.history) ? data.history : [];
      const drinkTimestamps = Array.isArray(data.drinkTimestamps)
        ? data.drinkTimestamps
        : [];
      return {
        dateKey: data.dateKey || null,
        drank: Boolean(data.drank),
        drinkTimestamps: drinkTimestamps,
        history: history,
      };
    } catch (_) {
      return { dateKey: null, drank: false, drinkTimestamps: [], history: [] };
    }
  }

  function saveState(dateKey, drank, history, drinkTimestamps) {
    try {
      const trimmed = (history || []).slice(-HISTORY_MAX_DAYS);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateKey, drank, drinkTimestamps, history: trimmed }),
      );
    } catch (_) {}
  }

  function getCurrentDrank() {
    const dateKey = getDateKey();
    const stored = loadState();
    if (stored.dateKey !== dateKey) {
      return false;
    }
    return stored.drank;
  }

  function getHistory() {
    const dateKey = getDateKey();
    const stored = loadState();
    let history = stored.history || [];
    if (
      stored.dateKey === dateKey &&
      stored.drank &&
      !history.includes(dateKey)
    ) {
      history = history.concat([dateKey]);
      saveState(dateKey, true, history, stored.drinkTimestamps);
    } else if (stored.dateKey === dateKey && !stored.drank) {
      history = history.filter(function (k) {
        return k !== dateKey;
      });
    }
    return history;
  }

  function setDrank(drank) {
    const dateKey = getDateKey();
    const stored = loadState();
    let history = stored.history || [];
    let drinkTimestamps = stored.drinkTimestamps || [];

    if (drank) {
      if (!history.includes(dateKey)) history = history.concat([dateKey]);
      drinkTimestamps = drinkTimestamps.filter(function (ts) {
        return ts.date !== dateKey;
      });
      drinkTimestamps = drinkTimestamps.concat([
        { date: dateKey, time: new Date().toLocaleTimeString() },
      ]);
    } else {
      history = history.filter(function (k) {
        return k !== dateKey;
      });
      drinkTimestamps = drinkTimestamps.filter(function (ts) {
        return ts.date !== dateKey;
      });
    }

    saveState(dateKey, drank, history, drinkTimestamps);
  }

  function getStreak() {
    const todayKey = getDateKey();
    const history = getHistory();
    const drankSet = new Set(history);
    if (!drankSet.has(todayKey)) return 0;
    let streak = 0;
    const today = parseDateKey(todayKey);
    let d = new Date(today);
    while (true) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = y + "-" + m + "-" + day;
      if (!drankSet.has(key)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function toggleDrank() {
    const next = !getCurrentDrank();
    setDrank(next);
    return next;
  }

  /* 🔔 Notification reminder initialization */
  function initReminder() {
    if (!localStorage.getItem(REMINDER_KEY)) {
      localStorage.setItem(
        REMINDER_KEY,
        JSON.stringify({
          enabled: true,
          time: "09:00",
          lastNotified: null,
        }),
      );
    }

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(function (permission) {
        if (permission === "granted" && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "SET_REMINDER",
            settings: JSON.parse(localStorage.getItem(REMINDER_KEY)),
          });
        }
      });
    } else if (
      "Notification" in window &&
      Notification.permission === "granted" &&
      navigator.serviceWorker.controller
    ) {
      navigator.serviceWorker.controller.postMessage({
        type: "SET_REMINDER",
        settings: JSON.parse(localStorage.getItem(REMINDER_KEY)),
      });
    }
  }

  /* --- Location Functions --- */
  async function fetchCityName(lat, lon) {
    try {
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      );
      if (!res.ok) throw new Error("HTTP Error " + res.status);
      const data = await res.json();
      return data.city || data.locality || "Location Found";
    } catch (e) {
      console.error("City fetch failed", e);
      return "Local Time";
    }
  }

  function initLocation() {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        userLocation.city = await fetchCityName(latitude, longitude);
        const el = document.getElementById("main-clock-label");
        if (el) el.textContent = "Time in " + userLocation.city;
      });
    }
  }

  /* --- Clock Functions --- */
  function initWorldClocks() {
    const container = document.getElementById("world-clocks");
    if (container) {
      let html = "";
      WORLD_CITIES.forEach((city, index) => {
        html += `
          <div class="world-clock-item">
            <span class="city-name">${city.name}</span>
            <span class="city-time" id="world-clock-time-${index}">--:--</span>
          </div>
        `;
      });
      container.innerHTML = html;
    }
  }

  function updateClock() {
    const now = new Date();
    const timeEl = document.getElementById("clock-time");
    const secEl = document.getElementById("clock-seconds");

    if (timeEl && secEl) {
      timeEl.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      secEl.textContent = String(now.getSeconds()).padStart(2, "0");
    }

    WORLD_CITIES.forEach((city, index) => {
      const el = document.getElementById(`world-clock-time-${index}`);
      if (el) {
        el.textContent = now.toLocaleTimeString("en-US", {
          timeZone: city.timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      }
    });
  }

  /* --- Theme Functions --- */
  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
  }

  function toggleTheme() {
    setTheme(
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark",
    );
  }

  /**
   * --- Motivational Quote Functions ---
   * @param {translations[currentLang]} texts The translations object for the current language, containing the motivationalQuotes array.
   * @return {string} The final quote chosen for the day, based on a stored index or a new random one.
   */
  function getDailyQuote(texts) {
    const todayKey = getDateKey();
    const storageKey = "proteinDailyQuote";
    const storedData = localStorage.getItem(storageKey);

    let index;

    if (storedData && storedData.startsWith(todayKey)) {
      index = parseInt(storedData.split("-")[1]);
    } else {
      index = Math.floor(Math.random() * texts.motivationalQuotes.length);
      localStorage.setItem(storageKey, `${todayKey}-${index}`);
    }

    return texts.motivationalQuotes[index] || texts.motivationalQuotes[0];
  }

  /**
   * --- UI Functions ---
   * Updates the entire UI based on the current drank state and language
   * is called multiple times:
   * - when language is changed
   * DO NOT ADD ONE TIME CALLED FUNCTIONS HERE, they should be in init() or separate functions called from init()
   */
  function updateUI(drank) {
    const dateKey = getDateKey();
    const stored = loadState();
    const flexed = document.getElementById("arm-flexed");
    const weak = document.getElementById("arm-weak");
    const btn = document.getElementById("toggle-btn");
    const status = document.getElementById("status-text");
    const title = document.querySelector(".logo-text");
    const dateEl = document.getElementById("date-text");
    const streakEl = document.getElementById("streak-text");
    const lastTimeEl = document.getElementById("last-time");
    const mainClockLabel = document.getElementById("main-clock-label");
    const proteinFoodListBtn = document.getElementById("protein-food-list-btn");
    const texts = translations[currentLang];

    if (title) title.textContent = texts.title;
    if (proteinFoodListBtn)
      proteinFoodListBtn.textContent = texts.proteinFoodListBtn;
    if (flexed) flexed.classList.toggle("hidden", !drank);
    if (weak) weak.classList.toggle("hidden", drank);
    if (btn) btn.textContent = drank ? texts.btnDrankUndo : texts.btnDrank;
    if (status)
      status.textContent = drank ? texts.statusDone : texts.statusNotDone;
    if (mainClockLabel) mainClockLabel.textContent = texts.localTime;
    if (dateEl) dateEl.textContent = formatDisplayDate(dateKey);

    if (streakEl) {
      const streak = getStreak();
      streakEl.textContent =
        streak > 0 ? `${streak} ${texts.statusStreak}` : "";
    }

    if (lastTimeEl) {
      const timestamps = stored.drinkTimestamps || [];
      if (timestamps.length) {
        const recent = timestamps[timestamps.length - 1];
        lastTimeEl.textContent = `${texts.lastDrankLabel} : ${recent.time}`;
      } else {
        lastTimeEl.textContent = "";
      }
    }
    updateHistoryLog();
    updateHistoryTable();

    // Update motivational quote
    const quoteEl = document.getElementById("motivational-quote");
    if (quoteEl) quoteEl.textContent = getDailyQuote(texts);
  }

  function updateHistoryLog() {
    const logContainer = document.getElementById("history-log");
    if (!logContainer) return;

    const stored = loadState();
    const history = stored.history || [];
    const historySet = new Set(history);
    const todayKey = getDateKey();
    let html = "";

    // Last 7 days including today
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      // App day logic: if currently before 2am, today is still "yesterday"
      const currentHour = new Date().getHours();
      if (currentHour < RESET_HOUR) {
        d.setDate(d.getDate() - 1);
      }
      d.setDate(d.getDate() - i);

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = y + "-" + m + "-" + day;

      const isToday = key === todayKey;
      let status = "⚪";
      if (historySet.has(key)) {
        status = "✅";
      } else if (isToday && getCurrentDrank()) {
        status = "✅";
      }

      const dayName = d.toLocaleDateString(currentLang, { weekday: "narrow" });

      html += `
        <div class="history-day">
          <span class="day-label">${dayName}</span>
          <span class="day-status" title="${key}">${status}</span>
        </div>
      `;
    }
    logContainer.innerHTML = html;
  }

  function handleToggle() {
    const drank = toggleDrank();
    updateUI(drank);
    navigator.vibrate?.(50);
    if (drank) {
      console.log("[App] drank=true, attempting notification");
      console.log("[App] SW Controller:", navigator.serviceWorker.controller);
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "SHOW_DRINK_NOTIFICATION",
          title: "🥤 Protein Tracked!",
          body: "Great job! You've logged your protein drink today.",
        });
        console.log("[App] Message sent to SW");
        showNotificationAlert("✅ Good Job.Keep Going..!");
      } else {
        console.log("[App] No SW controller available");
        showNotificationAlert("⚠️ Service Worker not ready");
      }
    }
  }

  function showNotificationAlert(message) {
    const alert = document.createElement("div");
    alert.textContent = message;
    alert.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      z-index: 9999;
      font-weight: bold;
      animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(alert);

    setTimeout(() => {
      alert.style.animation = "slideOut 0.3s ease-out";
      setTimeout(() => alert.remove(), 300);
    }, 3000);
  }

    /* ── HISTORY TABLE ── */
  function updateHistoryTable() {
    const stored = loadState();
    const history = stored.history || [];
    const drinkTimestamps = stored.drinkTimestamps || [];
    const tbody = document.getElementById('history-table-body');
    const emptyMsg = document.getElementById('history-table-empty');
    if (!tbody) return;

    if (!history.length) {
      tbody.innerHTML = '';
      if (emptyMsg) emptyMsg.style.display = 'block';
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Sort newest first
    const sorted = [...history].sort((a, b) => (a < b ? 1 : -1));
    tbody.innerHTML = sorted.map(function(dateKey) {
      const d = parseDateKey(dateKey);
      const dateStr = d.toLocaleDateString(currentLang, { day: '2-digit', month: 'short', year: 'numeric' });
      const dayStr = d.toLocaleDateString(currentLang, { weekday: 'long' });
      const ts = drinkTimestamps.find(function(t) { return t.date === dateKey; });
      const timeStr = ts ? ts.time : '—';
      return `<tr>
        <td class="td-date">${dateStr}</td>
        <td class="td-day">${dayStr}</td>
        <td class="td-time">${timeStr}</td>
        <td class="td-status">✅</td>
      </tr>`;
    }).join('');
  }

  /* ── CSV EXPORT ── */
  function exportCSV() {
    const stored = loadState();
    const history = stored.history || [];
    const drinkTimestamps = stored.drinkTimestamps || [];
    if (!history.length) { alert('No history to export yet!'); return; }

    const rows = [['Date', 'Day', 'Time Logged', 'Status']];
    const sorted = [...history].sort((a, b) => (a < b ? 1 : -1));
    sorted.forEach(function(dateKey) {
      const d = parseDateKey(dateKey);
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const dayStr = d.toLocaleDateString('en-GB', { weekday: 'long' });
      const ts = drinkTimestamps.find(function(t) { return t.date === dateKey; });
      rows.push([dateStr, dayStr, ts ? ts.time : '—', 'Drank ✓']);
    });

    const csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'protein-history.csv';
    a.click();
  }

  /* ── PDF EXPORT ── */
  function exportPDF() {
    const stored = loadState();
    const history = stored.history || [];
    const drinkTimestamps = stored.drinkTimestamps || [];
    if (!history.length) { alert('No history to export yet!'); return; }
    if (!window.jspdf) { alert('PDF library not loaded yet, please try again.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210, margin = 18, colW = pageW - margin * 2;
    let y = margin;

    // Header bar
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, pageW, 38, 'F');
    doc.setTextColor(238, 238, 238);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Protein Drink Tracker', margin, 22);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 180, 200);
    doc.text('History exported on ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), margin, 32);

    y = 50;

    // Table header
    doc.setFillColor(42, 42, 74);
    doc.roundedRect(margin, y, colW, 9, 2, 2, 'F');
    doc.setTextColor(180, 180, 200);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    const c = [margin + 3, margin + 48, margin + 90, margin + 130];
    doc.text('DATE', c[0], y + 6);
    doc.text('DAY', c[1], y + 6);
    doc.text('TIME LOGGED', c[2], y + 6);
    doc.text('STATUS', c[3], y + 6);
    y += 12;

    const sorted = [...history].sort((a, b) => (a < b ? 1 : -1));
    sorted.forEach(function(dateKey, idx) {
      if (y > 278) { doc.addPage(); y = margin; }
      const d = parseDateKey(dateKey);
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const dayStr = d.toLocaleDateString('en-GB', { weekday: 'long' });
      const ts = drinkTimestamps.find(function(t) { return t.date === dateKey; });

      if (idx % 2 === 0) {
        doc.setFillColor(42, 42, 74);
        doc.rect(margin, y - 1, colW, 9, 'F');
      }

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(233, 69, 96);
      doc.setFontSize(8.5);
      doc.text(dateStr, c[0], y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 220);
      doc.text(dayStr, c[1], y + 5);
      doc.text(ts ? ts.time : '—', c[2], y + 5);

      doc.setTextColor(46, 204, 113);
      doc.text('Drank', c[3], y + 5);

      y += 10;
    });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 150);
    doc.text(history.length + ' days tracked in total', margin, 292);

    doc.save('protein-history.pdf');
  }


  function init() {
    const drank = getCurrentDrank();

    const langSelect = document.getElementById("lang-select");
    if (langSelect) {
      langSelect.value = currentLang;
      langSelect.addEventListener("change", (e) => {
        currentLang = e.target.value;
        localStorage.setItem(LANG_KEY, currentLang);
        updateUI(getCurrentDrank());
      });
    }

    updateUI(drank);

    const btn = document.getElementById("toggle-btn");
    if (btn) {
      btn.addEventListener("click", handleToggle);
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToggle();
        }
      });
    }

    const themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
    setTheme(loadTheme());

    const csvBtn = document.getElementById('export-csv-btn');
    if (csvBtn) csvBtn.addEventListener('click', exportCSV);
    const pdfBtn = document.getElementById('export-pdf-btn');
    if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);

    initLocation();
    initWorldClocks();
    updateClock();
    setInterval(updateClock, 1000);

    setInterval(function () {
      updateUI(getCurrentDrank());
    }, 60000);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("sw.js")
        .then(initReminder)
        .catch(function () {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
