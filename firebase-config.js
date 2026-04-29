// ============================================================
// FIREBASE AND LOCAL DEMO DATA CONFIGURATION
// ============================================================

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

// Cloudinary config is optional. When it is not configured, the app will
// keep image data inside the product record so demos still work.
const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "YOUR_UPLOAD_PRESET";

const LOCAL_DB_KEY = "ims_demo_db_v1";
const LOCAL_DB_DEFAULTS = {
  products: {},
  adjustments: {},
  logs: {},
  categories: [],
  settings: {}
};

const localListeners = new Map();

function isConfiguredValue(value) {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("YOUR_");
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeSnapshot(value) {
  const cloned = cloneValue(value);
  return {
    val() {
      return cloned;
    }
  };
}

function readLocalDb() {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...LOCAL_DB_DEFAULTS,
      ...parsed,
      products: parsed.products && typeof parsed.products === "object" && !Array.isArray(parsed.products) ? parsed.products : {},
      adjustments: parsed.adjustments && typeof parsed.adjustments === "object" && !Array.isArray(parsed.adjustments) ? parsed.adjustments : {},
      logs: parsed.logs && typeof parsed.logs === "object" && !Array.isArray(parsed.logs) ? parsed.logs : {},
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      settings: parsed.settings && typeof parsed.settings === "object" && !Array.isArray(parsed.settings) ? parsed.settings : {}
    };
  } catch (error) {
    console.warn("IMS local demo database reset after parse failure.", error);
    return cloneValue(LOCAL_DB_DEFAULTS);
  }
}

function writeLocalDb(nextDb) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(nextDb));
  return nextDb;
}

function emitLocal(path) {
  const callbacks = localListeners.get(path);
  if (!callbacks || !callbacks.size) return;
  const snapshot = makeSnapshot(readLocalDb()[path]);
  callbacks.forEach(callback => callback(snapshot));
}

function ensureCollection(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createLocalChildRef(path, key) {
  return {
    update(payload) {
      const dbState = readLocalDb();
      const collection = ensureCollection(dbState[path]);
      collection[key] = {
        ...(collection[key] || {}),
        ...cloneValue(payload)
      };
      dbState[path] = collection;
      writeLocalDb(dbState);
      emitLocal(path);
      return Promise.resolve();
    },
    remove() {
      const dbState = readLocalDb();
      const collection = ensureCollection(dbState[path]);
      delete collection[key];
      dbState[path] = collection;
      writeLocalDb(dbState);
      emitLocal(path);
      return Promise.resolve();
    },
    set(value) {
      const dbState = readLocalDb();
      const collection = ensureCollection(dbState[path]);
      collection[key] = cloneValue(value);
      dbState[path] = collection;
      writeLocalDb(dbState);
      emitLocal(path);
      return Promise.resolve();
    }
  };
}

function createLocalRef(path) {
  return {
    on(eventName, callback) {
      if (eventName !== "value") return;
      if (!localListeners.has(path)) {
        localListeners.set(path, new Set());
      }
      localListeners.get(path).add(callback);
      callback(makeSnapshot(readLocalDb()[path]));
    },
    set(value) {
      const dbState = readLocalDb();
      dbState[path] = cloneValue(value);
      writeLocalDb(dbState);
      emitLocal(path);
      return Promise.resolve();
    },
    push(value) {
      const dbState = readLocalDb();
      const collection = ensureCollection(dbState[path]);
      const key = createLocalId();
      collection[key] = cloneValue(value);
      dbState[path] = collection;
      writeLocalDb(dbState);
      emitLocal(path);
      return Promise.resolve({ key });
    },
    child(key) {
      return createLocalChildRef(path, key);
    }
  };
}

let db = null;
let dbRefs = null;
let APP_DATA_MODE = "local";
let APP_DATA_MESSAGE = "Using local demo data on this device.";

const hasFirebaseConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.databaseURL,
  firebaseConfig.projectId,
  firebaseConfig.appId
].every(isConfiguredValue);

try {
  if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK is not available.");
  }

  if (!hasFirebaseConfig) {
    throw new Error("Firebase configuration is still using placeholder values.");
  }

  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  dbRefs = {
    products: db.ref("products"),
    adjustments: db.ref("adjustments"),
    logs: db.ref("logs"),
    categories: db.ref("categories"),
    settings: db.ref("settings")
  };
  APP_DATA_MODE = "firebase";
  APP_DATA_MESSAGE = "Connected to live Firebase data.";
} catch (error) {
  console.warn("IMS data layer fallback:", error);
  dbRefs = {
    products: createLocalRef("products"),
    adjustments: createLocalRef("adjustments"),
    logs: createLocalRef("logs"),
    categories: createLocalRef("categories"),
    settings: createLocalRef("settings")
  };
  APP_DATA_MODE = "local";
  APP_DATA_MESSAGE = hasFirebaseConfig
    ? "Firebase is unavailable. Using local demo data on this device."
    : "Firebase is not configured yet. Using local demo data on this device.";
}

window.db = db;
window.dbRefs = dbRefs;
window.APP_DATA_MODE = APP_DATA_MODE;
window.APP_DATA_MESSAGE = APP_DATA_MESSAGE;
