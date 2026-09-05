// ============================================================================
//  Publica firestore.rules no projeto usando a chave de serviço.
//  Uso: node scripts/deploy-regras.mjs
//  (mesma credencial do importador: serviceAccountKey.json ou
//   FIREBASE_SERVICE_ACCOUNT)
// ============================================================================
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = 'um-de-nos';
const RULES_FILE = new URL('../firestore.rules', import.meta.url);

function credencial() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) return JSON.parse(raw);
  const f = new URL('../serviceAccountKey.json', import.meta.url);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  throw new Error('Sem credencial (serviceAccountKey.json ou FIREBASE_SERVICE_ACCOUNT).');
}

const source = fs.readFileSync(RULES_FILE, 'utf8');

const auth = new GoogleAuth({
  credentials: credencial(),
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const token = (await (await auth.getClient()).getAccessToken()).token;

const api = async (url, method, body) => {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${method} ${url}\n${txt}`);
  return txt ? JSON.parse(txt) : {};
};

console.log('📝 Criando ruleset a partir de firestore.rules...');
const ruleset = await api(
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`,
  'POST',
  { source: { files: [{ name: 'firestore.rules', content: source }] } }
);
console.log('   ruleset:', ruleset.name);

const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`;
console.log('🚀 Apontando cloud.firestore para o novo ruleset...');
await api(
  `https://firebaserules.googleapis.com/v1/${releaseName}?updateMask=rulesetName`,
  'PATCH',
  { release: { name: releaseName, rulesetName: ruleset.name }, updateMask: 'rulesetName' }
).catch(async (e) => {
  // Se a release ainda não existe, cria.
  if (String(e).includes('HTTP 404') || String(e).includes('NOT_FOUND')) {
    await api(
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`,
      'POST',
      { name: releaseName, rulesetName: ruleset.name }
    );
  } else { throw e; }
});

console.log('✅ Regras publicadas.');
