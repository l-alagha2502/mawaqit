const prayers = [
  { name: 'Fajr', key: 'fajr', icon: 'Dawn' },
  { name: 'Sunrise', key: 'sunrise', icon: 'First light' },
  { name: 'Dhuhr', key: 'dhuhr', icon: 'Midday' },
  { name: 'Asr', key: 'asr', icon: 'Afternoon' },
  { name: 'Maghrib', key: 'maghrib', icon: 'Sunset' },
  { name: 'Isha', key: 'isha', icon: 'Night' }
];
const cities = [
  ['London', 'United Kingdom', 51.5072, -0.1276], ['New York', 'United States', 40.7128, -74.006],
  ['Jakarta', 'Indonesia', -6.2088, 106.8456], ['Kuala Lumpur', 'Malaysia', 3.139, 101.6869],
  ['Dubai', 'United Arab Emirates', 25.2048, 55.2708], ['Cairo', 'Egypt', 30.0444, 31.2357],
  ['Makkah', 'Saudi Arabia', 21.4225, 39.8262], ['Paris', 'France', 48.8566, 2.3522],
  ['Toronto', 'Canada', 43.6532, -79.3832], ['Sydney', 'Australia', -33.8688, 151.2093]
];
const storageKey = 'mawaqit-location';
const $ = (id) => document.getElementById(id);
let coordinates = null;
let schedule = null;
let locationLabel = 'Your local prayer times';
let notificationTimeouts = [];
let scheduleDate = null;

function dayOfYear(date) { return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000); }
function radians(value) { return value * Math.PI / 180; }
function degrees(value) { return value * 180 / Math.PI; }
function normalize(value, max) { return ((value % max) + max) % max; }

// Compact solar-position calculation based on NOAA's sunrise equation.
function solarTimes(date, latitude, longitude) {
  const n = dayOfYear(date), lngHour = longitude / 15;
  const solar = (angle, rising) => {
    const t = n + ((rising ? 6 : 18) - lngHour) / 24;
    const mean = (0.9856 * t) - 3.289;
    let longitudeSun = mean + 1.916 * Math.sin(radians(mean)) + 0.020 * Math.sin(radians(2 * mean)) + 282.634;
    longitudeSun = normalize(longitudeSun, 360);
    let rightAscension = degrees(Math.atan(0.91764 * Math.tan(radians(longitudeSun))));
    rightAscension = normalize(rightAscension, 360);
    const quadrant = Math.floor(longitudeSun / 90) * 90;
    const raQuadrant = Math.floor(rightAscension / 90) * 90;
    rightAscension = (rightAscension + quadrant - raQuadrant) / 15;
    const sinDeclination = 0.39782 * Math.sin(radians(longitudeSun));
    const cosDeclination = Math.cos(Math.asin(sinDeclination));
    const cosHour = (Math.cos(radians(angle)) - sinDeclination * Math.sin(radians(latitude))) / (cosDeclination * Math.cos(radians(latitude)));
    if (cosHour > 1 || cosHour < -1) return null;
    const hour = (rising ? 360 - degrees(Math.acos(cosHour)) : degrees(Math.acos(cosHour))) / 15;
    const localMean = hour + rightAscension - 0.06571 * t - 6.622;
    return normalize(localMean - lngHour, 24);
  };
  const noon = solar(90.833, true);
  const transit = noon === null ? 12 : (solar(90.833, true) + solar(90.833, false)) / 2;
  const hourAngle = (angle) => solar(angle, true);
  const fajr = solar(108, true), isha = solar(108, false), sunrise = solar(90.833, true), sunset = solar(90.833, false);
  const asr = (() => {
    const declination = 23.45 * Math.sin(radians((360 / 365) * (n - 81)));
    const altitude = degrees(Math.atan(1 / (1 + Math.tan(radians(Math.abs(latitude - declination))))));
    const angle = 90 - altitude;
    return solar(angle, false);
  })();
  return { fajr, sunrise, dhuhr: normalize(transit, 24), asr, maghrib: sunset, isha };
}

function dateAt(hours, date = new Date()) {
  if (hours === null || Number.isNaN(hours)) return null;
  const result = new Date(date); result.setHours(0, 0, 0, 0); result.setMinutes(Math.round(hours * 60)); return result;
}
function formatTime(prayerTime) {
  return prayerTime ? prayerTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--';
}
function calculatePrayerTimes(date, latitude, longitude) {
  if (window.adhan) {
    const coordinates = new adhan.Coordinates(latitude, longitude);
    const parameters = adhan.CalculationMethod.UmmAlQura();
    const prayerTimes = new adhan.PrayerTimes(coordinates, date, parameters);
    return {
      fajr: prayerTimes.fajr,
      sunrise: prayerTimes.sunrise,
      dhuhr: prayerTimes.dhuhr,
      asr: prayerTimes.asr,
      maghrib: prayerTimes.maghrib,
      isha: prayerTimes.isha
    };
  }
  const calculated = solarTimes(date, latitude, longitude);
  return Object.fromEntries(Object.entries(calculated).map(([name, hours]) => [name, dateAt(hours, date)]));
}
function updateDate() { const now = new Date(); $('today').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }

function dateKey(date = new Date()) { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function clearNotificationTimers() {
  notificationTimeouts.forEach((timeout) => clearTimeout(timeout));
  notificationTimeouts = [];
}
function setNotificationStatus(message) { $('notification-status').textContent = message; }
function scheduleNotifications() {
  clearNotificationTimers();
  if (!schedule || !coordinates || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  prayers.forEach((prayer) => {
    const prayerDate = schedule[prayer.key];
    if (!prayerDate || prayerDate <= now) return;
    notificationTimeouts.push(setTimeout(() => {
      new Notification('Mawaqit', { body: `It's time to pray ${prayer.name}` });
      scheduleNotifications();
    }, prayerDate.getTime() - now.getTime()));
  });
}
async function enableNotifications() {
  if (!('Notification' in window)) {
    setNotificationStatus('Notifications are not supported by this browser.');
    return;
  }
  if (!window.isSecureContext) {
    setNotificationStatus('Notifications require a secure connection.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    $('notification-button').textContent = 'Prayer notifications enabled';
    setNotificationStatus('You will be notified at each prayer time.');
    scheduleNotifications();
  } else {
    setNotificationStatus(permission === 'denied' ? 'Notifications are blocked in your browser.' : 'Notification permission was not granted.');
  }
}
function updateNotificationControl() {
  const button = $('notification-button');
  if (!('Notification' in window)) {
    button.disabled = true;
    setNotificationStatus('Notifications are not supported by this browser.');
  } else if (Notification.permission === 'granted') {
    button.textContent = 'Prayer notifications enabled';
    setNotificationStatus('You will be notified at each prayer time.');
    scheduleNotifications();
  } else if (Notification.permission === 'denied') {
    setNotificationStatus('Notifications are blocked in your browser.');
  }
}

function render() {
  const now = new Date();
  const entries = prayers.map((prayer, index) => ({ ...prayer, date: schedule[prayer.key], index }));
  let next = entries.find((entry) => entry.date && entry.date > now);
  if (!next) next = { ...entries[0], date: new Date(entries[0].date.getTime() + 86400000), tomorrow: true };
  $('next-name').textContent = next.name;
  $('next-meta').textContent = `${formatTime(next.date)} · ${next.tomorrow ? 'Tomorrow' : next.icon}`;
  const remaining = Math.max(0, next.date - now) / 60000;
  $('countdown').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}h ${String(Math.floor(remaining % 60)).padStart(2, '0')}m`;
  $('prayer-grid').innerHTML = entries.map((entry) => {
    const past = entry.date < now;
    const active = entry.name === next.name && !next.tomorrow;
    return `<article class="prayer-card ${past ? 'is-past' : ''} ${active ? 'is-next' : ''}"><div><span class="prayer-state">${active ? 'Next' : past ? 'Passed' : 'Upcoming'}</span></div><div><h3 class="prayer-name">${entry.name}</h3><p class="prayer-time">${formatTime(entry.date)}</p></div></article>`;
  }).join('');
}
function setLocation(latitude, longitude, name) {
  coordinates = { latitude, longitude, name }; localStorage.setItem(storageKey, JSON.stringify(coordinates));
  locationLabel = name || 'Your local prayer times'; $('location-display').textContent = locationLabel; schedule = calculatePrayerTimes(new Date(), latitude, longitude); scheduleDate = dateKey(); render(); scheduleNotifications();
}
function requestLocation() {
  const locationDisplay = $('location-display');
  if (!navigator.geolocation) { locationDisplay.textContent = 'Location unavailable'; return; }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      setLocation(latitude, longitude, `Lat: ${latitude}, Lon: ${longitude}`);
    },
    (error) => {
      locationDisplay.textContent = error.code === error.PERMISSION_DENIED ? 'Location access denied' : 'Unable to access location';
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 86400000 }
  );
}
function showCities(query = '') {
  const match = cities.filter(([city, country]) => `${city} ${country}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  $('city-results').innerHTML = match.map(([city, country, latitude, longitude]) => `<button class="city-option" type="button" data-lat="${latitude}" data-lng="${longitude}" data-name="${city}">${city}<small>${country}</small></button>`).join('') || '<p class="dialog-note">No city found. Try another name.</p>';
  document.querySelectorAll('.city-option').forEach((button) => button.addEventListener('click', () => { setLocation(Number(button.dataset.lat), Number(button.dataset.lng), button.dataset.name); $('location-dialog').close(); }));
}

$('city-search').addEventListener('input', (event) => showCities(event.target.value));
$('notification-button').addEventListener('click', enableNotifications);
updateNotificationControl();
updateDate(); setInterval(() => {
  updateDate();
  if (schedule && scheduleDate !== dateKey()) {
    if (coordinates) setLocation(coordinates.latitude, coordinates.longitude, coordinates.name);
  } else if (schedule) {
    render();
  }
}, 1000);
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved?.latitude) setLocation(saved.latitude, saved.longitude, `Lat: ${saved.latitude}, Lon: ${saved.longitude}`);
  else requestLocation();
} catch { requestLocation(); }
