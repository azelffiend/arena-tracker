import React, { useEffect, useMemo, useRef, useState } from "react";
// === Cloud Sync (Firebase) ===
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { 
  getAuth, 
  onAuthStateChanged, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential
} from "firebase/auth";

// *** Firebase config — your project ***
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
  // ignore (hot-reload / duplicate init)
}

// === Local data ===
const DEFAULT_CHAMPIONS = [
  "Aatrox","Ahri","Akali","Akshan","Alistar","Ambessa","Amumu","Anivia","Annie","Aphelios","Ashe","Aurelion Sol","Azir","Bard","Bel'Veth","Blitzcrank","Brand","Braum","Briar","Caitlyn","Camille","Cassiopeia","Cho'Gath","Corki","Daris","Diana","Dr. Mundo","Draven","Ekko","Elise","Evelynn","Ezreal","Fiddlesticks","Fiora","Fizz","Galio","Gangplank","Garen","Gnar","Gragas","Graves","Gwen","Hecarim","Heimerdinger","Hwei","Illaoi","Irelia","Ivern","Janna","Jarven IV","Jax","Jayce","Jhin","Jinx","K'Sante","Kai'Sa","Kalista","Karma","Karthus","Kassadin","Katarina","Kayle","Kayn","Kennen","Kha'Zix","Kindred","Kled","Kog'Maw","LeBlanc","Lee Sin","Leona","Lillia","Lissandra","Lucian","Lulu","Lux","Malphite","Malzahar","Maokai","Master yi","MeL","Milio","Miss Fortune","Mordekaiser","Morgana","Naafiri","Nami","Nasus","Nautilus","Neeko","Nidalee","Nilah","Nocturne","Nunu & Willump","Olaf","Orianna","Ornn","Pantheon","Poppy","Pyke","Qiyana","Quinn","Rakan","Rammus","Rek'Sai","Rell","Renata Glasc","Renekton","Rengar","Riven","Rumble","Ryze","Samira","Sejuani","Senna","Seraphine","Sett","Shaco","Shen","Shyvana","Singed","Sion","Sivir","Skarner","Smolder","Sona","Soraka","Swain","Sylas","Syndra","Tahm Kench","Taliyah","Talon","Taric","Teemo","Thresh","Tristana","Trundle","Tryndamere","Twisted Fate","Twitch","Udyr","Urgot","Varus","Vayne","Veigar","Vel'Koz","Vex","Vi","Viego","Viktor","Vladimir","Volibear","Warwick","Wukong","Xayah","Xerath","Xin Zhao","Yasuo","Yone","Yorick","Yunara","Yuumi","Zac","Zed","Zeri","Ziggs","Zilean","Zoe","Zyra"
];

function loadRows(){
  try{
    const raw = localStorage.getItem("arena_rows");
    if(!raw) return DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0}));
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return parsed;
    if(Array.isArray(parsed?.rows)) return parsed.rows;
    return DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0}));
  }catch{
    return DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0}));
  }
}
function saveRows(rows){
  try{ localStorage.setItem("arena_rows", JSON.stringify(rows)); }catch{}
}

// Username -> synthetic email (ASCII only) to avoid invalid-email
function usernameToEmail(username){
  const u = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, ""); // strip invalid chars
  return u ? `${u}@arena-tracker.local` : "";
}

export default function App(){
  const [rows, setRows] = useState(loadRows());
  const [query, setQuery] = useState("");
  const [randomChampion, setRandomChampion] = useState(null);

  // Cloud/auth
  const [cloudUser, setCloudUser] = useState(null); // username/password only
  const [cloudStatus, setCloudStatus] = useState("מוכן");
  const [autoSync, setAutoSync] = useState(false);
  const debounceRef = useRef(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // autosave local
  useEffect(()=>{ saveRows(rows); }, [rows]);

  // Auth state (NO automatic anonymous sign-in)
  useEffect(()=>{
    if(!auth) return;
    const unsub = onAuthStateChanged(auth, (u)=>{
      // expose for debugging
      window._cloudUser = u;
      setCloudUser(u);
    });
    return unsub;
  }, []);

  // Auth methods (username+password only)
  async function registerUsernamePassword(){
    try{
      const email = usernameToEmail(username);
      if(!email) return setCloudStatus("שם משתמש חייב להיות באנגלית/ספרות בלבד");
      if(!password) return setCloudStatus("אנא הזן סיסמה (מינ' 6 תווים)");
      await createUserWithEmailAndPassword(auth, email, password);
      setCloudStatus("נרשמת והתחברת ✔");
    }catch(e){
      console.error("register error:", e);
      setCloudStatus(`שגיאת הרשמה: ${e.code || e.message}`);
    }
  }
  async function loginUsernamePassword(){
    try{
      const email = usernameToEmail(username);
      if(!email) return setCloudStatus("שם משתמש חייב להיות באנגלית/ספרות בלבד");
      if(!password) return setCloudStatus("אנא הזן סיסמה");
      await signInWithEmailAndPassword(auth, email, password);
      setCloudStatus("התחברת ✔");
    }catch(e){
      console.error("login error:", e);
      setCloudStatus(`שגיאת התחברות: ${e.code || e.message}`);
    }
  }
  async function linkAnonToUsername(){
    try{
      if(!auth.currentUser) throw new Error("no user");
      const email = usernameToEmail(username);
      if(!email || !password) return setCloudStatus("אנא הזן שם משתמש וסיסמה");
      const cred = EmailAuthProvider.credential(email, password);
      await linkWithCredential(auth.currentUser, cred);
      setCloudStatus("קושר החשבון האנונימי לשם משתמש/סיסמה ✔");
    }catch(e){
      console.error("link error:", e);
      setCloudStatus(`שגיאת קישור: ${e.code || e.message}`);
    }
  }
  async function logout(){
    try{ await signOut(auth); setCloudStatus("מנותק"); }catch{ setCloudStatus("שגיאת ניתוק ✖"); }
  }

  const filtered = useMemo(()=>{
    const q = query.trim().toLowerCase();
    return q? rows.filter(r=> r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const totalLosses = useMemo(()=> rows.reduce((sum, r) => sum + r.losses, 0), [rows]);
  const winRate = useMemo(()=> rows.length ? ((rows.filter(r=> r.win).length/rows.length)*100).toFixed(1) : "0.0", [rows]);

  function updateRows(mutator){
    setRows(prev=> mutator([...prev]));
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
    setRows(prev=> prev.map(r=> ({...r, win:false, losses:0})));
    setRandomChampion(null);
  }

  function restoreChampions(){
    const base = DEFAULT_CHAMPIONS.map(n=>({name:n, win:false, losses:0}));
    setRows(prev=>{
      const have = new Set(prev.map(x=> x.name.toLowerCase()));
      const additions = base.filter(x=> !have.has(x.name.toLowerCase()));
      return [...prev, ...additions];
    });
  }

  function chooseRandomChampion(){
    if (rows.length === 0) return;
    const pool = rows.filter(r => !r.win); // ignore winners
    if (pool.length === 0) {
      alert("כל האלופים כבר עם ניצחון 🙂");
      return;
    }
    const rand = pool[Math.floor(Math.random() * pool.length)];
    setRandomChampion(rand.name);
  }

  // Firestore document path: users/{uid}
  function cloudDocRef(){
    if(!db || !cloudUser) return null;
    return doc(db, "users", cloudUser.uid);
  }

  async function syncToCloud(){
    try{
      if(!cloudUser){ setCloudStatus("לא מחובר – התחבר/י עם שם משתמש וסיסמה"); return; }
      const ref = cloudDocRef(); if(!ref){ setCloudStatus("Firebase לא מאותחל"); return; }
      setCloudStatus("מסנכרן…");
      await setDoc(ref, { rows, updatedAt: serverTimestamp() }, { merge: true });
      setCloudStatus("נסנכרן לענן ✔");
    }catch(e){
      console.error("sync error:", e);
      setCloudStatus(`שגיאת סנכרון: ${e.code || e.message}`);
    }
  }

  async function loadFromCloud(){
    try{
      if(!cloudUser){ setCloudStatus("לא מחובר – התחבר/י עם שם משתמש וסיסמה"); return; }
      const ref = cloudDocRef(); if(!ref){ setCloudStatus("Firebase לא מאותחל"); return; }
      setCloudStatus("טוען מהענן…");
      const snap = await getDoc(ref);
      if(snap.exists()){
        const data = snap.data();
        if(Array.isArray(data?.rows)){
          setRows(data.rows);
          setCloudStatus("נטען מהענן ✔");
        } else {
          setCloudStatus("אין נתונים בענן");
        }
      } else {
        setCloudStatus("אין נתונים בענן");
      }
    }catch(e){
      console.error("load error:", e);
      setCloudStatus(`שגיאת טעינה: ${e.code || e.message}`);
    }
  }

  // Auto Sync (debounced)
  useEffect(()=>{
    if(!autoSync) return;
    if(!db || !cloudUser) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(()=>{ syncToCloud(); }, 800);
    return ()=> clearTimeout(debounceRef.current);
  }, [rows, autoSync]); // eslint-disable-line react-hooks/exhaustive-deps

  const isEmail = cloudUser?.providerData?.[0]?.providerId === "password";

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">Arena Tracker – שם משתמש/סיסמה + סנכרון ענן</h1>
        </div>

        <input className="w-full rounded-xl border px-3 py-2" placeholder="חיפוש אלוף..." value={query} onChange={e=> setQuery(e.target.value)} />

        <div className="flex flex-wrap gap-2 items-center">
          <button className="px-3 py-2 rounded-xl border" onClick={chooseRandomChampion}>בחר אלוף רנדומלי</button>
          <button className="px-3 py-2 rounded-xl border" onClick={restoreChampions}>שחזר רשימת אלופים</button>

          <button className="px-3 py-2 rounded-xl border" onClick={()=>{
            const payload = { rows };
            const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href=url; a.download=`arena-data.json`; a.click(); URL.revokeObjectURL(url);
          }}>שמור לקובץ</button>

          <label className="px-3 py-2 rounded-xl border cursor-pointer">
            טען מקובץ
            <input type="file" accept="application/json" className="hidden" onChange={async (e)=>{
              const file = e.target.files?.[0];
              if(!file) return;
              try{
                const text = await file.text();
                const data = JSON.parse(text);
                if(Array.isArray(data?.rows)){ setRows(data.rows); }
                else if(Array.isArray(data)){ setRows(data); }
                setCloudStatus("המידע נטען מקובץ ✔");
              }catch{ setCloudStatus("שגיאה בטעינת הקובץ ✖"); }
              e.target.value = "";
            }} />
          </label>

          <button className="px-3 py-2 rounded-xl border" onClick={syncToCloud}>סנכרן לענן</button>
          <button className="px-3 py-2 rounded-xl border" onClick={loadFromCloud}>טען מהענן</button>
          <label className="flex items-center gap-2 text-sm ml-2">
            <input type="checkbox" checked={autoSync} onChange={e=> setAutoSync(e.target.checked)} />
            סנכרון אוטומטי
          </label>
        </div>

        {/* Auth */}
        {!cloudUser || !isEmail ? (
          <div className="flex flex-wrap items-center gap-2">
            <input className="rounded-xl border px-3 py-2" placeholder="שם משתמש (a-z, 0-9, . _ -)" value={username} onChange={e=> setUsername(e.target.value)} />
            <input className="rounded-xl border px-3 py-2" type="password" placeholder="סיסמה (מינ' 6 תווים)" value={password} onChange={e=> setPassword(e.target.value)} />
            <button className="px-3 py-2 rounded-xl border" onClick={loginUsernamePassword}>התחבר</button>
            <button className="px-3 py-2 rounded-xl border" onClick={registerUsernamePassword}>הרשמה</button>
            <button className="px-3 py-2 rounded-xl border" onClick={linkAnonToUsername} title="קישור משתמש אנונימי לחשבון שם משתמש/סיסמה">קשר אנונימי → שם משתמש</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>מחובר (UID: {cloudUser.uid?.substring(0,6)}…)</span>
            <button className="px-3 py-2 rounded-xl border" onClick={logout}>התנתק</button>
          </div>
        )}

        <div className="mt-2 p-2 border rounded-xl bg-gray-100 text-sm space-y-1">
          <div>אחוז נצחונות: <span className="font-semibold">{winRate}%</span></div>
          <div>סך כל ההפסדים: <span className="font-semibold">{totalLosses}</span></div>
          <div className="text-sm text-gray-600">סטטוס: {cloudStatus}</div>
        </div>

        {randomChampion && (
          <div className="mt-2 p-3 border rounded-xl bg-gray-50 space-y-2">
            <div>האלוף שנבחר: <span className="font-semibold">{randomChampion}</span></div>
            <div className="flex gap-2">
              <button className="px-3 py-1 rounded-lg border bg-green-100" onClick={()=> setResult(randomChampion, true)}>ניצחתי</button>
              <button className="px-3 py-1 rounded-lg border bg-red-100" onClick={()=> setResult(randomChampion, false)}>הפסד</button>
            </div>
          </div>
        )}
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
