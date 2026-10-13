// 副業配達の手残り見える化（無料版）の計算（2026-10-14新設）。ブラウザでもテストでも同じものを使う（ES module・外部通信なし）。
//
// 出すもの：報酬合計／入力した直接費用の合計／直接費用を引いた残額／1時間あたりの残額。
// 「税引後利益」「確定した所得」ではない（税金・社会保険・車両の維持費などは入っていない）。
// 未入力（空欄）と 0 を分ける：空欄は「未入力」として一覧に出し、合計には足さない。時間が無いか0なら1時間あたりは出さない（0で割らない）。

/** 金額の欄（空欄→null、数字以外→NaN）。カンマ・円・¥・全角数字を受け付ける */
export function parseYen(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,円¥￥\s]/g, "");
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** 時間の欄（例：2.5、2:30、２時間30分）。空欄→null、読めない→NaN。単位は時間 */
export function parseHours(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/[：]/g, ":");
  if (s === "") return null;
  let m;
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d+):([0-5]?\d)$/.exec(s))) return Number(m[1]) + Number(m[2]) / 60;
  if ((m = /^(?:(\d+)時間)?\s*(?:(\d+)分)?$/.exec(s)) && (m[1] || m[2])) return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
  return NaN;
}

/** 開始・終了の時刻（"HH:MM"）から時間。終了が開始より前なら日付をまたいだとみなす。同じなら0 */
export function hoursBetween(start, end) {
  const t = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const a = t(start);
  const b = t(end);
  if (a === null || b === null) return null;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return d / 60;
}

export const FIELDS = {
  reward: "通常報酬",
  bonus: "ボーナス",
  fuel: "燃料・充電",
  parking: "駐輪・駐車",
  otherCost: "その他の直接費用",
  food: "この稼働で増えた飲食代",
};
const COSTS = ["fuel", "parking", "otherCost", "food"];

/**
 * 計算（純関数）。input は欄の文字列そのまま：{ reward, bonus, fuel, parking, otherCost, food, hours, start, end }
 * 時間は hours（直接）を優先し、無ければ start・end から出す。
 */
export function compute(input) {
  const errors = [];
  const missing = [];
  const v = {};
  for (const [k, label] of Object.entries(FIELDS)) {
    const n = parseYen(input?.[k]);
    if (n === null) missing.push(label);
    else if (Number.isNaN(n)) errors.push(`${label}：数字で入力してください`);
    else if (n < 0) errors.push(`${label}：マイナスは入れられません（費用は正の数で）`);
    v[k] = n === null || Number.isNaN(n) || n < 0 ? null : n;
  }
  let hours = parseHours(input?.hours);
  let hoursFrom = "hours";
  if (Number.isNaN(hours)) {
    errors.push("稼働時間：2.5 や 2:30 の形で入力してください");
    hours = null;
  }
  if (hours === null) {
    const h = hoursBetween(input?.start, input?.end);
    if (h !== null) {
      hours = h;
      hoursFrom = "times";
    } else if (String(input?.start ?? "").trim() || String(input?.end ?? "").trim()) {
      errors.push("開始・終了：両方を 18:30 のような形で入力してください");
    }
  }
  if (hours !== null && hours > 24) errors.push("稼働時間：24時間を超えています。1回の稼働ごとに入力してください");
  if (hours === null) missing.push("稼働時間");

  const hasIncome = v.reward !== null || v.bonus !== null;
  const gross = (v.reward ?? 0) + (v.bonus ?? 0);
  const costTotal = COSTS.reduce((s, k) => s + (v[k] ?? 0), 0);
  const net = gross - costTotal;
  const perHour = hasIncome && hours !== null && hours > 0 && hours <= 24 ? net / hours : null;
  return {
    ok: errors.length === 0 && hasIncome,
    errors,
    missing,
    values: v,
    hours,
    hoursFrom,
    gross: hasIncome ? gross : null,
    costTotal,
    costEntered: COSTS.some((k) => v[k] !== null),
    net: hasIncome ? net : null,
    perHour,
    deficit: hasIncome && net < 0,
    zeroHours: hours === 0,
  };
}

/** 表示用：円（四捨五入・3桁区切り・マイナスは「−」） */
export function yen(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const r = Math.round(n);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("ja-JP")}円`;
}
/** 表示用：時間（例：2時間30分） */
export function hm(h) {
  if (h === null || h === undefined) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}時間${total % 60 ? `${total % 60}分` : ""}`;
}

/** この端末への保存（localStorage）。読み書きできなければ何もしない。金額は端末の外へ送らない */
export const STORE_KEY = "tenokori.v1.records";
export function loadRecords(storage) {
  try {
    const a = JSON.parse(storage?.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
export function saveRecord(storage, record) {
  const list = loadRecords(storage);
  list.unshift(record);
  const kept = list.slice(0, 200);
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(kept));
    return kept;
  } catch {
    return list;
  }
}
export function deleteRecord(storage, id) {
  const list = loadRecords(storage).filter((r) => r.id !== id);
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* 保存できなくても続ける */
  }
  return list;
}
