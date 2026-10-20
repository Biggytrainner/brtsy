import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { applyAction, normalize, emptyDb, HttpError } from "../lib/logic.mjs";

const KEY = "db";
const TOKEN_HOURS = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// ---------- auth (shared passcode -> signed 12h token) ----------
const secret = () => (process.env.APP_PASSCODE || "") + "|" + (process.env.SESSION_SECRET || "");
const sign = (exp) => crypto.createHmac("sha256", secret()).update(String(exp)).digest("base64url");
const makeToken = () => { const exp = Date.now() + TOKEN_HOURS * 3600e3; return exp + "." + sign(exp); };
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
function checkToken(t) {
  const [exp, sig] = String(t || "").split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEq(sig, sign(exp));
}

// ---------- storage: ONE blob, updated with optimistic concurrency ----------
const store = () => getStore({ name: "equipment-loan", consistency: "strong" });
const hash = (db) => crypto.createHash("sha1").update(JSON.stringify(db)).digest("hex").slice(0, 12);

async function load(st) {
  const r = await st.getWithMetadata(KEY, { type: "json" });
  return r ? { data: r.data, etag: r.etag } : { data: null, etag: null };
}

async function mutate(st, fn) {
  for (let i = 0; i < 6; i++) {
    const { data, etag } = await load(st);
    const db = normalize(data);
    fn(db); // throws HttpError on validation/conflict -> nothing is written
    const res = await st.setJSON(KEY, db, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (res && res.modified === false) { await sleep(60 + Math.random() * 120 * (i + 1)); continue; }
    return db;
  }
  throw new HttpError(409, "มีผู้ใช้อื่นกำลังบันทึกพร้อมกัน กรุณาลองใหม่อีกครั้ง");
}

export default async (req) => {
  if (!process.env.APP_PASSCODE) return json({ error: "ยังไม่ได้ตั้งค่า APP_PASSCODE ใน Netlify" }, 503);
  const url = new URL(req.url);
  const action = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  try {
    if (action === "login" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (typeof b.passcode === "string" && safeEq(b.passcode, process.env.APP_PASSCODE)) return json({ token: makeToken() });
      await sleep(800);
      return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
    }
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!checkToken(auth)) return json({ error: "unauthorized" }, 401);

    const st = store();
    if (action === "state" && req.method === "GET") {
      const { data } = await load(st);
      const db = normalize(data || emptyDb());
      const rev = hash(db);
      if (url.searchParams.get("rev") === rev) return json({ unchanged: true, rev });
      return json({ rev, ...db });
    }
    if (req.method !== "POST") return json({ error: "ไม่พบคำสั่ง" }, 404);
    const body = await req.json().catch(() => ({}));
    const now = new Date().toISOString();
    // first write ever: start from the seeded default data
    const db = await mutate(st, (d) => {
      if (!d.equipment.length && !d.records.length && !d.lenders.length) Object.assign(d, emptyDb());
      applyAction(d, action, body, now);
    });
    return json({ ok: true, rev: hash(db), ...db });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "เซิร์ฟเวอร์ผิดพลาด" }, 500);
  }
};

export const config = { path: "/api/*" };
