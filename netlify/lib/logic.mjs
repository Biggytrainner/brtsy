// Pure business logic for the equipment-loan database (no I/O) — easy to test.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const ICONS = ["bed", "wc", "crutch", "w4", "w3", "c1", "default"];
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
const bad = (m) => { throw new HttpError(400, m); };
const clash = (m) => { throw new HttpError(409, m); };

export const DEFAULT_LENDERS = [
  "นางสาวกรกนก พรมอินชัย", "นางสาวกัลญาณี พรมเพียร", "นางสาวพรรณนิภา ไพโรจน์",
  "นางสาวทิฑัมพร คีรีพิทักษ์", "นางสาวดาวละออ แสงดาวกลางไพร", "นายธนัช อโนคุณ", "นายวสันต์ แก้วจตุพร",
];
export const DEFAULT_EQUIPMENT = [
  { id: "bed", name: "เตียงนอน", icon: "bed", color: "#4A90D9", total: 13, order: 1 },
  { id: "wc", name: "รถเข็น", icon: "wc", color: "#7B68EE", total: 8, order: 2 },
  { id: "crutch", name: "ไม้ค้ำยัน", icon: "crutch", color: "#48BB78", total: 12, order: 3 },
  { id: "w4", name: "ไม้เท้าฝึกเดิน 4 ขา", icon: "w4", color: "#ED8936", total: 6, order: 4 },
  { id: "w3", name: "ไม้เท้าฝึกเดิน 3 ขา", icon: "w3", color: "#F56565", total: 4, order: 5 },
  { id: "c1", name: "ไม้เท้า 1 ขา", icon: "c1", color: "#38B2AC", total: 10, order: 6 },
  { id: "eq_1777537749102", name: "เครื่องให้ออกซิเจน", icon: "default", color: "#E8406A", total: 2, order: 7 },
  { id: "eq_1777538810663", name: "Jewett brace size S", icon: "default", color: "#2F855A", total: 10, order: 8 },
  { id: "eq_1777538868552", name: "Tailor Brace", icon: "bed", color: "#2F855A", total: 2, order: 9 },
];

export const emptyDb = () => ({
  equipment: DEFAULT_EQUIPMENT.map((e) => ({ ...e })),
  records: [],
  lenders: [...DEFAULT_LENDERS],
});
export function normalize(d) {
  if (!d || typeof d !== "object") return emptyDb();
  return {
    equipment: Array.isArray(d.equipment) ? d.equipment : [],
    records: Array.isArray(d.records) ? d.records : [],
    lenders: Array.isArray(d.lenders) ? d.lenders : [],
  };
}

// ---------- validation helpers ----------
const str = (v, max, name, required = true) => {
  if (v == null) v = "";
  if (typeof v !== "string") bad(`${name} ไม่ถูกต้อง`);
  v = v.trim();
  if (required && !v) bad(`กรุณากรอก${name}`);
  if (v.length > max) bad(`${name} ยาวเกินไป`);
  return v;
};
const clean = (v, max) => String(v == null ? "" : v).slice(0, max);
const color = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#2F855A");
const iso = (v, name) => {
  const d = new Date(v);
  if (v == null || isNaN(d)) bad(`${name} ไม่ถูกต้อง`);
  return d.toISOString();
};
const validIso = (v) => { const d = new Date(v); return v == null || isNaN(d) ? null : d.toISOString(); };
const rid = () => Date.now().toString() + Math.random().toString(36).slice(2, 5);
const intIn = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${name} ไม่ถูกต้อง`);
  return n;
};
function pickNums(v, total) {
  if (!Array.isArray(v) || !v.length) bad("กรุณาเลือกเบอร์อุปกรณ์อย่างน้อย 1 ชิ้น");
  const s = [...new Set(v.map(Number))].sort((a, b) => a - b);
  if (s.some((n) => !Number.isInteger(n) || n < 1 || n > total)) bad("เบอร์อุปกรณ์ไม่ถูกต้อง");
  return s;
}
const findEq = (db, id) => {
  const e = db.equipment.find((x) => x.id === id);
  if (!e) throw new HttpError(404, "ไม่พบอุปกรณ์");
  return e;
};
function usage(db, equipId, exceptId) {
  const used = new Set();
  let qty = 0;
  db.records.forEach((r) => {
    if (r.status !== "borrowed" || r.equipId !== equipId || r.id === exceptId) return;
    qty += Number(r.qty) || 0;
    (r.nums || []).forEach((n) => used.add(n));
  });
  return { used, qty };
}
const addLender = (db, n) => { if (n && !db.lenders.includes(n)) db.lenders.push(n); };

// ---------- actions ----------
function borrow(db, b, now) {
  const e = findEq(db, b.equipId);
  const name = str(b.patientName, 120, "ชื่อผู้ยืม");
  const hn = str(b.patientId, 60, "HN/เลขที่");
  const lender = str(b.lender, 120, "ผู้ให้ยืม");
  const note = str(b.note, 500, "หมายเหตุ", false);
  const nums = pickNums(b.nums, e.total);
  const { used, qty } = usage(db, e.id);
  if (nums.some((n) => used.has(n))) clash("เบอร์ที่เลือกเพิ่งถูกยืมโดยผู้ใช้อื่น กรุณาเลือกใหม่");
  if (e.total - qty < nums.length) clash("อุปกรณ์ไม่เพียงพอ");
  db.records.unshift({
    id: rid(), equipId: e.id, equipName: e.name, equipIcon: e.icon,
    patientName: name, patientId: hn, qty: nums.length, nums, lender, note,
    borrowDate: now, returnDate: null, status: "borrowed",
  });
  addLender(db, lender);
}

function giveBack(db, b, now) {
  const r = db.records.find((x) => x.id === b.id);
  if (!r) throw new HttpError(404, "ไม่พบรายการ");
  if (r.status !== "borrowed") clash("รายการนี้ถูกคืนไปแล้ว");
  r.status = "returned";
  r.returnDate = now;
}

function updateRecord(db, b) {
  const r = db.records.find((x) => x.id === b.id);
  if (!r) throw new HttpError(404, "ไม่พบรายการ");
  const name = str(b.patientName, 120, "ชื่อผู้ยืม");
  const hn = str(b.patientId, 60, "HN/เลขที่");
  const lender = str(b.lender, 120, "ผู้ให้ยืม");
  const note = str(b.note, 500, "หมายเหตุ", false);
  const bd = iso(b.borrowDate, "วันที่ยืม");
  let rd = r.returnDate;
  let newNums = null;
  if (r.status === "returned") {
    rd = iso(b.returnDate, "วันที่คืน");
    if (rd < bd) bad("วันที่คืนต้องไม่ก่อนวันที่ยืม");
  } else if (Array.isArray(b.nums) && b.nums.length) {
    const e = findEq(db, r.equipId);
    newNums = pickNums(b.nums, e.total);
    const { used, qty } = usage(db, e.id, r.id);
    if (newNums.some((n) => used.has(n))) clash("เบอร์ที่เลือกถูกยืมโดยรายการอื่นแล้ว");
    if (qty + newNums.length > e.total) clash("อุปกรณ์ไม่เพียงพอ");
  } else if (r.nums && r.nums.length) bad("กรุณาเลือกเบอร์อย่างน้อย 1 ชิ้น");
  if (newNums) { r.nums = newNums; r.qty = newNums.length; }
  Object.assign(r, { patientName: name, patientId: hn, lender, note, borrowDate: bd, returnDate: rd });
  addLender(db, lender);
}

function adjustStock(db, b) {
  const e = findEq(db, b.equipId);
  const d = intIn(b.delta, -100000, 100000, "จำนวน");
  if (!d) bad("กรุณาระบุจำนวนที่ต้องการเพิ่ม/ลด");
  const { qty } = usage(db, e.id);
  if (e.total + d - qty < 0) clash("จำนวนคงเหลือไม่สามารถติดลบได้");
  e.total += d;
}

function saveEquipment(db, b) {
  const name = str(b.name, 120, "ชื่ออุปกรณ์");
  const icon = ICONS.includes(b.icon) ? b.icon : "default";
  const col = color(b.color);
  if (b.id) {
    const e = findEq(db, b.id);
    Object.assign(e, { name, icon, color: col });
  } else {
    const total = b.total == null || b.total === "" ? 0 : intIn(b.total, 0, 100000, "จำนวนเริ่มต้น");
    const order = db.equipment.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0) + 1;
    db.equipment.push({ id: "eq_" + rid(), name, icon, color: col, total, order });
  }
}

function deleteEquipment(db, b) {
  findEq(db, b.id);
  if (usage(db, b.id).qty > 0) clash("มีอุปกรณ์ถูกยืมอยู่ ลบไม่ได้");
  db.equipment = db.equipment.filter((x) => x.id !== b.id);
}

function importData(db, b, now) {
  const ie = b.eqs || b.equipments, ir = b.recs || b.records, stk = b.stk || b.stock || {};
  if (!Array.isArray(ie) || !Array.isArray(ir)) bad("ไฟล์ไม่ถูกต้อง");
  if (ie.length > 500 || ir.length > 20000) bad("ไฟล์ใหญ่เกินไป");
  const borrowed = {};
  ir.forEach((r) => { if (r && r.status === "borrowed") borrowed[r.equipId] = (borrowed[r.equipId] || 0) + (Number(r.qty) || 0); });
  let maxOrder = db.equipment.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
  ie.forEach((q) => {
    if (!q || !ID_RE.test(String(q.id))) return;
    const total = q.total != null ? Number(q.total) : (Number(stk[q.id]) || 0) + (borrowed[q.id] || 0);
    const item = {
      id: String(q.id), name: clean(q.name, 120) || "(ไม่มีชื่อ)", icon: ICONS.includes(q.icon) ? q.icon : "default",
      color: color(q.color), total: Math.max(0, Math.min(100000, Math.floor(total) || 0)),
    };
    const ex = db.equipment.find((x) => x.id === item.id);
    if (ex) Object.assign(ex, item);
    else db.equipment.push({ ...item, order: Number(q.order) || ++maxOrder });
  });
  const byId = new Map(db.records.map((r) => [r.id, r]));
  ir.forEach((r) => {
    if (!r || !ID_RE.test(String(r.id))) return;
    byId.set(String(r.id), {
      id: String(r.id), equipId: clean(r.equipId, 60), equipName: clean(r.equipName, 120),
      equipIcon: ICONS.includes(r.equipIcon) ? r.equipIcon : "default",
      patientName: clean(r.patientName, 120), patientId: clean(r.patientId, 60),
      qty: Math.max(0, Math.floor(Number(r.qty)) || 0),
      nums: Array.isArray(r.nums) ? r.nums.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
      lender: clean(r.lender, 120), note: clean(r.note, 500),
      borrowDate: validIso(r.borrowDate) || now, returnDate: validIso(r.returnDate),
      status: r.status === "borrowed" ? "borrowed" : "returned",
    });
  });
  db.records = [...byId.values()].sort((a, b) => String(b.borrowDate).localeCompare(String(a.borrowDate)));
  (Array.isArray(b.lenders) ? b.lenders : []).forEach((n) => addLender(db, clean(n, 120).trim()));
  ir.forEach((r) => r && addLender(db, clean(r.lender, 120).trim()));
}

export function applyAction(db, action, body, now) {
  const b = body && typeof body === "object" ? body : {};
  switch (action) {
    case "borrow": return borrow(db, b, now);
    case "return": return giveBack(db, b, now);
    case "record/update": return updateRecord(db, b);
    case "stock/adjust": return adjustStock(db, b);
    case "equipment/save": return saveEquipment(db, b);
    case "equipment/delete": return deleteEquipment(db, b);
    case "import": return importData(db, b, now);
    default: throw new HttpError(404, "ไม่พบคำสั่ง");
  }
}
