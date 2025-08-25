import React, { useEffect, useMemo, useState } from "react";
import { Share2, Calendar, MapPin, ChevronUp, ChevronDown, RotateCcw, Clock, CheckCircle2, X, Pencil, Download } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import jsPDF from "jspdf";

// -------------------- Types --------------------
type Session = {
  sessionId: string;
  date: string; // YYYY-MM-DD
  location: string;
  total: number;
  finishedAt: string; // ISO8601 with local offset
};

// -------------------- Storage Keys --------------------
const SESSIONS_KEY = "pc_sessions_v1";
const CURRENT_KEY = "pc_current_v1";
const LOCATIONS_KEY = "pc_locations_v1";

// -------------------- Defaults --------------------
const DEFAULT_LOCATIONS = [
  "Dhaka",
  "Barisal",
  "Gazipur",
  "Sirajganj (KYAMCH)",
  "Clinic A",
];

// -------------------- Helpers --------------------
const pad2 = (n: number) => String(n).padStart(2, "0");
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const todayISO = () => new Date().toISOString().slice(0, 10);
const localISO = () => new Date().toISOString();

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}
function saveSessions(list: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
}
function loadLocations(): string[] {
  try {
    const raw = localStorage.getItem(LOCATIONS_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : DEFAULT_LOCATIONS;
    // Guarantee exactly 5 slots
    const fixed = [...arr];
    for (let i = fixed.length; i < 5; i++) fixed.push(`Clinic ${String.fromCharCode(65 + i)}`);
    return fixed.slice(0, 5);
  } catch {
    return DEFAULT_LOCATIONS;
  }
}
function saveLocations(names: string[]) {
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(names.slice(0, 5)));
}

// Current transient state persisted to survive app kill
type CurrentState = {
  date: string | null;
  location: string | null;
  newCount: number;
  oldCount: number;
  locked: boolean; // becomes true on first increment
};
const loadCurrent = (): CurrentState => {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw
      ? (JSON.parse(raw) as CurrentState)
      : { date: todayISO(), location: null, newCount: 0, oldCount: 0, locked: false };
  } catch {
    return { date: todayISO(), location: null, newCount: 0, oldCount: 0, locked: false };
  }
};
const saveCurrent = (s: CurrentState) => localStorage.setItem(CURRENT_KEY, JSON.stringify(s));

// Haptic shim
const haptic = () => {
  if (navigator.vibrate) navigator.vibrate(10);
};

// -------------------- App --------------------
export default function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions());
  const [locations, setLocations] = useState<string[]>(loadLocations());
  const [current, setCurrent] = useState<CurrentState>(loadCurrent());

  const [showHistory, setShowHistory] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [showEditLocations, setShowEditLocations] = useState(false);

  useEffect(() => saveSessions(sessions), [sessions]);
  useEffect(() => saveLocations(locations), [locations]);
  useEffect(() => saveCurrent(current), [current]);

  const total = current.newCount + current.oldCount;
  const canStart = Boolean(current.date) && Boolean(current.location);
  const counterEnabled = canStart;

  const onInc = (key: "newCount" | "oldCount") => {
    if (!counterEnabled) return;
    setCurrent((s) => {
      const val = clamp(s[key] + 1, 0, 99);
      const next = { ...s, [key]: val, locked: s.locked || val > 0 || s.newCount + s.oldCount > 0 } as CurrentState;
      haptic();
      return next;
    });
  };
  const onDec = (key: "newCount" | "oldCount") => {
    if (!counterEnabled) return;
    setCurrent((s) => {
      const val = clamp(s[key] - 1, 0, 99);
      const next = { ...s, [key]: val, locked: s.locked || s.newCount + s.oldCount > 0 } as CurrentState;
      haptic();
      return next;
    });
  };
  const onReset = (key: "newCount" | "oldCount") => {
    if (!counterEnabled) return;
    setCurrent((s) => ({ ...s, [key]: 0 }));
  };

  const changeDate = (val: string) => {
    if (current.locked) return; // locked after first tap
    setCurrent((s) => ({ ...s, date: val }));
  };
  const changeLocation = (val: string) => {
    if (current.locked) return;
    setCurrent((s) => ({ ...s, location: val }));
  };

  // Finish logic with merge on same date+location; ignore if total==0
  const doFinish = () => {
    if (total === 0 || !current.date || !current.location) {
      setShowFinish(false);
      return;
    }
    setSessions((prev) => {
      const idx = prev.findIndex((r) => r.date === current.date && r.location === current.location);
      const ts = localISO();
      if (idx >= 0) {
        const merged = [...prev];
        merged[idx] = { ...merged[idx], total: merged[idx].total + total, finishedAt: ts };
        return merged.sort((a, b) => (a.date === b.date ? b.finishedAt.localeCompare(a.finishedAt) : b.date.localeCompare(a.date)));
      }
      const next: Session = {
        sessionId: uuidv4(),
        date: current.date,
        location: current.location,
        total,
        finishedAt: ts,
      };
      return [next, ...prev].sort((a, b) => (a.date === b.date ? b.finishedAt.localeCompare(a.finishedAt) : b.date.localeCompare(a.date)));
    });

    // Reset to 00, keep context and unlock for next session same day/location
    setCurrent((s) => ({ ...s, newCount: 0, oldCount: 0, locked: false }));
    setShowFinish(false);
  };

  // -------------------- History + Filters --------------------
  const [locFilter, setLocFilter] = useState<string | "ALL">("ALL");
  const years = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => set.add(s.date.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [sessions]);
  const [yearFilter, setYearFilter] = useState<string | "ALL">("ALL");
  const [monthFilter, setMonthFilter] = useState<number | 0>(0); // 0 = ALL
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (locFilter !== "ALL" && s.location !== locFilter) return false;
      if (yearFilter !== "ALL" && s.date.slice(0, 4) !== yearFilter) return false;
      if (monthFilter !== 0 && Number(s.date.slice(5, 7)) !== monthFilter) return false;
      if (from && s.date < from) return false;
      if (to && s.date > to) return false;
      return true;
    });
  }, [sessions, locFilter, yearFilter, monthFilter, from, to]);

  // -------------------- Export --------------------
  function exportPDF(scope: "ALL" | "FILTERED" | "TODAY") {
    let list: Session[] = [];
    if (scope === "ALL") list = sessions;
    if (scope === "FILTERED") list = filtered;
    if (scope === "TODAY") list = sessions.filter((s) => s.date === todayISO());

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const left = 40;
    let top = 50;
    doc.setFontSize(16);
    doc.text("Patient Counter", left, top);
    top += 24;
    doc.setFontSize(12);
    if (list.length === 0) {
      doc.text("No entries.", left, top);
    } else {
      list
        .slice()
        .sort((a, b) => (a.date === b.date ? b.finishedAt.localeCompare(a.finishedAt) : b.date.localeCompare(a.date)))
        .forEach((s, i) => {
          const line = `${i + 1}. ${s.date} — ${s.location} — Total: ${s.total}`;
          doc.text(line, left, top);
          top += 18;
          if (top > 780) {
            doc.addPage();
            top = 50;
          }
        });
    }
    doc.save("Patient Counter.pdf");
  }

  // -------------------- UI --------------------
  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-start justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="w-6" />
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Patient Counter</h1>
          <button
            className="p-2 rounded-xl hover:bg-gray-100 active:bg-gray-200"
            onClick={() => exportPDF("ALL")}
            title="Export PDF"
          >
            <Share2 className="h-6 w-6" />
          </button>
        </div>

        {/* Filters Card */}
        <div className="rounded-2xl border border-gray-200 p-3 sm:p-4 mb-4">
          <h2 className="text-gray-500 font-semibold mb-2">Filters</h2>
          <div className="divide-y divide-gray-200">
            {/* Date */}
            <label className="flex items-center gap-3 py-2">
              <Calendar className="h-5 w-5 text-gray-700" />
              <div className="flex-1">
                <div className="text-sm text-gray-600">Date</div>
              </div>
              <input
                type="date"
                className="border rounded-xl px-3 py-2 text-sm"
                value={current.date ?? todayISO()}
                onChange={(e) => changeDate(e.target.value)}
                disabled={current.locked}
              />
            </label>
            {/* Location */}
            <label className="flex items-center gap-3 py-2">
              <MapPin className="h-5 w-5 text-gray-700" />
              <div className="flex-1">
                <div className="text-sm text-gray-600">Location</div>
              </div>
              <select
                className="border rounded-xl px-3 py-2 text-sm"
                value={current.location ?? ""}
                onChange={(e) => changeLocation(e.target.value)}
                disabled={current.locked}
              >
                <option value="" disabled>
                  Select
                </option>
                {locations.slice(0, 5).map((name, i) => (
                  <option key={i} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                className="ml-2 p-2 rounded-lg hover:bg-gray-100"
                title="Rename locations"
                onClick={() => setShowEditLocations(true)}
                disabled={current.locked}
              >
                <Pencil className="h-4 w-4" />
              </button>
            </label>
          </div>
        </div>

        {/* Counters Card */}
        <div className="rounded-2xl border border-gray-200 p-3 sm:p-4 mb-4">
          <div className="grid grid-cols-2 gap-3">
            {/* NEW */}
            <div className="relative rounded-2xl border border-gray-200 p-3 text-center">
              <button
                className="mx-auto mb-1 p-2 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                onClick={() => onInc("newCount")}
                disabled={!counterEnabled}
              >
                <ChevronUp className="h-6 w-6" />
              </button>
              <div className="text-5xl font-extrabold text-blue-600 tabular-nums select-none">
                {pad2(current.newCount)}
              </div>
              <button
                className="mx-auto mt-1 p-2 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                onClick={() => onDec("newCount")}
                disabled={!counterEnabled}
              >
                <ChevronDown className="h-6 w-6" />
              </button>
              <div className="mt-1 text-sm font-semibold text-blue-700">NEW</div>
              <button
                className="absolute top-2 right-2 p-2 rounded-lg hover:bg-gray-100"
                onClick={() => onReset("newCount")}
                disabled={!counterEnabled}
                title="Reset"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>

            {/* OLD */}
            <div className="relative rounded-2xl border border-gray-200 p-3 text-center">
              <button
                className="mx-auto mb-1 p-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                onClick={() => onInc("oldCount")}
                disabled={!counterEnabled}
              >
                <ChevronUp className="h-6 w-6" />
              </button>
              <div className="text-5xl font-extrabold text-gray-700 tabular-nums select-none">
                {pad2(current.oldCount)}
              </div>
              <button
                className="mx-auto mt-1 p-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                onClick={() => onDec("oldCount")}
                disabled={!counterEnabled}
              >
                <ChevronDown className="h-6 w-6" />
              </button>
              <div className="mt-1 text-sm font-semibold text-gray-700">OLD</div>
              <button
                className="absolute top-2 right-2 p-2 rounded-lg hover:bg-gray-100"
                onClick={() => onReset("oldCount")}
                disabled={!counterEnabled}
                title="Reset"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Total */}
          <div className="mt-4 pt-3 border-t text-center text-lg font-semibold text-gray-800">
            Total: <span className="tabular-nums">{pad2(total)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 items-center">
          <button
            className="flex-1 inline-flex items-center justify-center gap-2 border border-gray-300 text-gray-900 rounded-xl py-3 hover:bg-gray-50"
            onClick={() => setShowHistory(true)}
          >
            <Clock className="h-5 w-5" /> History
          </button>
          <button
            className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl py-3 hover:bg-blue-700 disabled:opacity-50"
            onClick={() => setShowFinish(true)}
            disabled={total === 0}
          >
            <CheckCircle2 className="h-5 w-5" /> Finish
          </button>
        </div>
        <p className="text-center text-sm text-gray-500 mt-3">
          Finish closes today’s session and saves to History.
        </p>

        {/* Finish Modal */}
        {showFinish && (
          <Modal onClose={() => setShowFinish(false)}>
            <div className="p-5">
              <h3 className="text-lg font-semibold mb-2">Close session?</h3>
              <p className="text-sm text-gray-600 mb-4">Are you sure you want to close today’s session?</p>
              <div className="flex gap-3">
                <button className="flex-1 py-2 rounded-lg border" onClick={() => setShowFinish(false)}>No</button>
                <button className="flex-1 py-2 rounded-lg bg-blue-600 text-white" onClick={doFinish}>Yes</button>
              </div>
            </div>
          </Modal>
        )}

        {/* Edit Locations Modal */}
        {showEditLocations && (
          <Modal onClose={() => setShowEditLocations(false)}>
            <div className="p-5">
              <h3 className="text-lg font-semibold mb-3">Rename locations (5 slots)</h3>
              <div className="space-y-2">
                {locations.map((n, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-8 text-sm text-gray-500">{i + 1}.</span>
                    <input
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                      value={n}
                      onChange={(e) => {
                        const copy = [...locations];
                        copy[i] = e.target.value || DEFAULT_LOCATIONS[i] || `Clinic ${String.fromCharCode(65 + i)}`;
                        setLocations(copy);
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" onClick={() => setShowEditLocations(false)}>
                  Done
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* History Modal */}
        {showHistory && (
          <Modal onClose={() => setShowHistory(false)}>
            <div className="p-5 w-[92vw] max-w-md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-2xl font-extrabold">History</h3>
                <button
                  className="inline-flex items-center gap-1 text-sm px-3 py-2 border rounded-lg hover:bg-gray-50"
                  onClick={() => exportPDF("FILTERED")}
                >
                  <Download className="h-4 w-4" /> Export
                </button>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <select className="border rounded-lg px-3 py-2 text-sm" value={locFilter} onChange={(e) => setLocFilter(e.target.value as any)}>
                  <option value="ALL">All locations</option>
                  {locations.map((n, i) => (
                    <option key={i} value={n}>{n}</option>
                  ))}
                </select>
                <select className="border rounded-lg px-3 py-2 text-sm" value={yearFilter} onChange={(e) => setYearFilter(e.target.value as any)}>
                  <option value="ALL">All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <select className="border rounded-lg px-3 py-2 text-sm" value={monthFilter} onChange={(e) => setMonthFilter(Number(e.target.value))}>
                  <option value={0}>All months</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{new Date(2025, m - 1, 1).toLocaleString(undefined, { month: "long" })}</option>
                  ))}
                </select>
                <div className="" />
                <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
                <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>

              {/* Export shortcuts */}
              <div className="flex gap-2 mb-3">
                <button className="flex-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50" onClick={() => exportPDF("TODAY")}>
                  Export Today
                </button>
                <button className="flex-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50" onClick={() => exportPDF("ALL")}>
                  Export All
                </button>
              </div>

              {/* List */}
              <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-gray-200">
                {filtered.length === 0 ? (
                  <div className="p-4 text-sm text-gray-600">No entries.</div>
                ) : (
                  <ul className="divide-y">
                    {filtered
                      .slice()
                      .sort((a, b) => (a.date === b.date ? b.finishedAt.localeCompare(a.finishedAt) : b.date.localeCompare(a.date)))
                      .map((s) => (
                        <li key={s.sessionId} className="px-4 py-3 flex items-center justify-between">
                          <div className="text-gray-900">{formatDateDMY(s.date)}</div>
                          <div className="text-gray-600">{s.location}</div>
                          <div className="font-semibold">Total: {s.total}</div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

// -------------------- Modal --------------------
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-[92vw] max-w-lg rounded-2xl shadow-2xl">
        <button className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100" onClick={onClose}>
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

// -------------------- Utils --------------------
function formatDateDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}