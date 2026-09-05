import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCdpcRDc1mAZUA2lpumLammGi8W8Ao5Xgw",
  authDomain: "um-de-nos.firebaseapp.com",
  projectId: "um-de-nos",
  storageBucket: "um-de-nos.firebasestorage.app",
  messagingSenderId: "489192587083",
  appId: "1:489192587083:web:71c8e6660585f020b0b2ce"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// `app` é exportado para o painel admin inicializar o Firebase Authentication.
// A página pública continua usando só `db`.
export { db, app };