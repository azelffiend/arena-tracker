import React, { useEffect, useMemo, useRef, useState } from "react";
// === Cloud Sync (Firebase) ===
// npm i firebase
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// *** Firebase config — replace with your own values from Firebase Console ***
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDeBxhx5PcKrKpKmsG-MTD9rOzylddFHNg",
  authDomain: "arena-tracker-43203.firebaseapp.com",
  projectId: "arena-tracker-43203",
  storageBucket: "arena-tracker-43203.firebasestorage.app",
  messagingSenderId: "566307735075",
  appId: "1:566307735075:web:181f740ed11afb98e59396",
  measurementId: "G-6FLGSSJMN5"
};


// Initialize Firebase (once)
let app, db, auth;
try {
  app = initializeApp(FIREBASE_CONFIG);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (e) {
  // ignore: app may already be initialized in hot-reload or config missing
}

// === Local users + data store ===
// Saved in localStorage: { users: { [username]: { rows: [...] } }, currentUser: "default" }
const DEFAULT_CHAMPIONS = [
  "Aatrox","Ahri","Akali","Akshan","Alistar","Amumu","Anivia","Annie","Aphelios","Ashe"
];

function loadStore(){
  try{
    const raw = localStorage.getItem("arena_store");
    if(!raw) return { users: { default: { rows: DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0})) } }, currentUser: "default" };
    const parsed = JSON.parse(raw);
    if(!parsed.users || !parsed.currentUser){
      return { users: { default: { rows: DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0})) } }, currentUser: "default" };
    }
    return parsed;
  }catch{
    return { users: { default: { rows: DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0})) } }, currentUser: "default" };
  }
}

function saveStore(store){
  try{ localStorage.setItem("arena_store", JSON.stringify(store)); }catch{}
}

export default function ArenaTracker(){
  const [store, setStore] = useState(loadStore());
  const users = Object.keys(store.users);
  const currentUser = store.currentUser;
  const rows = store.users[currentUser]?.rows || [];

  const [query, setQuery] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [randomChampion, setRandomChampion] = useState(null);

  // === Cloud state ===
  const [cloudUser, setCloudUser] = useState(null); // Firebase anonymous user
  const [cloudStatus, setCloudStatus] = useState("מוכן");
  const [autoSync, setAutoSync] = useState(false);
  const debounceRef = useRef(null);

  // autosave local
  useEffect(()=>{ saveStore(store); }, [store]);

  // ensure user bucket
  useEffect(()=>{
    if(!store.users[currentUser]){
      setStore(s=> ({...s, users:{...s.users, [currentUser]: { rows: DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0})) } }}));
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Firebase anonymous auth
  useEffect(()=>{
    if(!auth) return;
    const unsub = onAuthStateChanged(auth, (u)=>{
      if(u){ setCloudUser(u); }
      else { signInAnonymously(auth).catch(()=>{}); }
    });
    return unsub;
  }, []);

  const filtered = useMemo(()=>{
    const q = query.trim().toLowerCase();
    return q? rows.filter(r=> r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const totalLosses = useMemo(()=> rows.reduce((sum, r) => sum + r.losses, 0), [rows]);
  const winRate = useMemo(()=> rows.length ? ((rows.filter(r=> r.win).length/rows.length)*100).toFixed(1) : "0.0", [rows]);

  function updateRows(mutator){
    setStore(s=> ({
      ...s,
      users: {
        ...s.users,
        [currentUser]: { rows: mutator((s.users[currentUser]?.rows)||[]) }
      }
    }));
  }

  function setResult(name, result){
    updateRows(prev=> prev.map(r=> {
      if(r.name===name){
        return { ...r, win: !!result, losses: result? r.losses : r.losses + 1 };
      }
      return r;
    }));
  }

  function resetAll(){
    updateRows(prev=> prev.map(r=> ({...r, win:false, losses:0})));
    setRandomChampion(null);
  }

  // user management
  function addUser(){
    const name = prompt("שם משתמש חדש?")?.trim();
    if(!name) return;
    if(store.users[name]){ alert("שם משתמש כבר קיים"); return; }
    const next = {
      ...store,
      users: { ...store.users, [name]: { rows: DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0})) } },
      currentUser: name
    };
    setStore(next);
  }

  function switchUser(name){
    if(!store.users[name]) return;
    setStore(s=> ({...s, currentUser: name}));
    setRandomChampion(null);
  }

  function deleteUser(name){
    if(name === "default"){ alert("אי אפשר למחוק את משתמש ברירת המחדל"); return; }
    if(!confirm(`למחוק את המשתמש "${name}"?`)) return;
    const {[name]:_, ...rest} = store.users;
    const nextUser = Object.keys(rest)[0] || "default";
    setStore({ users: rest, currentUser: nextUser });
  }

  // Firestore document path: users/{uid}/profiles/{username}
  function cloudDocRef(){
    if(!db || !cloudUser) return null;
    return doc(db, "users", cloudUser.uid, "profiles", currentUser);
  }

  async function syncToCloud(){
    try{
      const ref = cloudDocRef(); if(!ref) { setCloudStatus("אין חיבור לענן"); return; }
      setCloudStatus("מסנכרן…");
      await setDoc(ref, { rows, updatedAt: serverTimestamp() }, { merge: true });
      setCloudStatus("נסנכרן לענן ✔");
    }catch(e){ setCloudStatus("שגיאת סנכרון ✖"); }
  }

  async function loadFromCloud(){
    try{
      const ref = cloudDocRef(); if(!ref) { setCloudStatus("אין חיבור לענן"); return; }
      setCloudStatus("טוען מהענן…");
      const snap = await getDoc(ref);
      if(snap.exists()){
        const data = snap.data();
        if(Array.isArray(data?.rows)){
          setStore(s=> ({...s, users: { ...s.users, [currentUser]: { rows: data.rows } }}));
          setCloudStatus("נטען מהענן ✔");
        } else {
          setCloudStatus("אין נתונים בענן");
        }
      } else {
        setCloudStatus("אין נתונים בענן");
      }
    }catch(e){ setCloudStatus("שגיאת טעינה ✖"); }
  }

  // Auto Sync (debounced)
  useEffect(()=>{
    if(!autoSync) return;
    if(!db || !cloudUser) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(()=>{ syncToCloud(); }, 800);
    return ()=> clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, currentUser, autoSync]);

  // local import/export
  async function handleImport(e){
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      if(Array.isArray(data?.rows)){
        setStore(s=> ({...s, users: { ...s.users, [currentUser]: { rows: data.rows } }}));
      } else if(Array.isArray(data)){
        setStore(s=> ({...s, users: { ...s.users, [currentUser]: { rows: data } }}));
      } else if(data?.users && data?.currentUser){
        setStore(data); // replace entire store
      }
      setSaveMsg("המידע נטען בהצלחה ✔");
    }catch{
      setSaveMsg("שגיאה בטעינת הקובץ ✖");
    }
    e.target.value = "";
  }

  function handleExport(scope="user"){
    if(scope === "user"){
      const payload = { rows };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=`arena-${currentUser}.json`; a.click(); URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([JSON.stringify(store, null, 2)], {type: "application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=`arena-all-users.json`; a.click(); URL.revokeObjectURL(url);
    }
    setSaveMsg("נשמר לקובץ ✔");
  }

  function restoreChampions(){
    const base = DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0}));
    updateRows(prev=>{
      const have = new Set(prev.map(x=> x.name.toLowerCase()));
      const additions = base.filter(x=> !have.has(x.name.toLowerCase()));
      return [...prev, ...additions];
    });
  }

  function resultLabel(val){ return val? "כן" : ""; }

  function chooseRandomChampion(){
    if(rows.length === 0) return;
    const rand = rows[Math.floor(Math.random() * rows.length)];
    setRandomChampion(rand.name);
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">Arena Tracker – רב משתמשים + סנכרון ענן</h1>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm">משתמש:</label>
            <select className="rounded-xl border px-3 py-2" value={currentUser} onChange={e=> switchUser(e.target.value)}>
              {users.map(u=> <option key={u} value={u}>{u}</option>)}
            </select>
            <button className="px-3 py-2 rounded-xl border" onClick={addUser}>הוסף משתמש</button>
            {currentUser!=="default" && (
              <button className="px-3 py-2 rounded-xl border" onClick={()=> deleteUser(currentUser)}>מחק משתמש</button>
            )}
          </div>
        </div>

        <input className="w-full rounded-xl border px-3 py-2" placeholder="חיפוש אלוף..." value={query} onChange={e=> setQuery(e.target.value)} />

        <div className="flex flex-wrap gap-2 items-center">
          <button className="px-3 py-2 rounded-xl border" onClick={chooseRandomChampion}>בחר אלוף רנדומלי</button>
          <button className="px-3 py-2 rounded-xl border" onClick={restoreChampions}>שחזר רשימת אלופים</button>

          {/* Local save/load */}
          <button className="px-3 py-2 rounded-xl border" onClick={()=> handleExport("user")}>שמור משתמש</button>
          <button className="px-3 py-2 rounded-xl border" onClick={()=> handleExport("all")}>שמור כל המשתמשים</button>
          <label className="px-3 py-2 rounded-xl border cursor-pointer">
            טען מקובץ
            <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
          </label>

          {/* Cloud */}
          <button className="px-3 py-2 rounded-xl border" onClick={syncToCloud}>סנכרן לענן</button>
          <button className="px-3 py-2 rounded-xl border" onClick={loadFromCloud}>טען מהענן</button>
          <label className="flex items-center gap-2 text-sm ml-2">
            <input type="checkbox" checked={autoSync} onChange={e=> setAutoSync(e.target.checked)} />
            סנכרון אוטומטי
          </label>
        </div>
        <div className="text-sm text-gray-600">סטטוס ענן: {cloudUser? `מחובר (UID: ${cloudUser.uid.substring(0,6)}…)` : "מתחבר…"} · {cloudStatus}</div>
        {saveMsg && <div className="text-sm text-gray-600">{saveMsg}</div>}

        {randomChampion && (
          <div className="mt-2 p-3 border rounded-xl bg-gray-50 space-y-2">
            <div>האלוף שנבחר ({currentUser}): <span className="font-semibold">{randomChampion}</span></div>
            <div className="flex gap-2">
              <button className="px-3 py-1 rounded-lg border bg-green-100" onClick={()=> setResult(randomChampion, true)}>ניצחתי</button>
              <button className="px-3 py-1 rounded-lg border bg-red-100" onClick={()=> setResult(randomChampion, false)}>הפסד</button>
            </div>
          </div>
        )}

        <div className="mt-2 p-2 border rounded-xl bg-gray-100 text-sm space-y-1">
          <div>אחוז נצחונות (לפי רשימת האלופים של {currentUser}): <span className="font-semibold">{winRate}%</span></div>
          <div>סך כל ההפסדים ({currentUser}): <span className="font-semibold">{totalLosses}</span></div>
        </div>
      </header>

      <section className="rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr className="text-right">
              <th className="p-3">אלוף</th>
              <th className="p-3">ניצחון?</th>
              <th className="p-3">מס' הפסדים</th>
              <th className="p-3">פעולה</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r=> (
              <tr key={r.name} className="border-t">
                <td className="p-2 font-medium">{r.name}</td>
                <td className="p-2">{r.win? "כן" : ""}</td>
                <td className="p-2">{r.losses}</td>
                <td className="p-2">
                  <div className="flex gap-2">
                    <button className="px-3 py-1 rounded-lg border bg-green-100" onClick={()=> setResult(r.name, true)}>ניצחון</button>
                    <button className="px-3 py-1 rounded-lg border bg-red-100" onClick={()=> setResult(r.name, false)}>הפסד</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex justify-center gap-3">
        <button className="mt-4 px-4 py-2 rounded-xl border bg-yellow-100" onClick={resetAll}>איפוס הכל</button>
      </div>
    </div>
  );
}
