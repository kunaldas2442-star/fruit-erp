import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  ERPDataStore,
  Customer,
  Supplier,
  PurchaseItem,
  Sale,
  StockRecord,
  FruitItem,
  Expense,
  DailyRateEntry,
  WastageEntry,
  CustomerLedgerEntry,
  SupplierLedgerEntry,
  SupplierPayment,
  CustomerPayment,
  BusinessSettings,
  CompanyBillProfile,
} from "../src/types";

// Ensure global __filename and __dirname exist in runtime environments for Emscripten/sql.js
const currentModuleFilename =
  typeof __filename !== "undefined"
    ? __filename
    : typeof process !== "undefined" && process.argv && process.argv[1]
      ? process.argv[1]
      : process.cwd();
const currentModuleDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : currentModuleFilename
      ? path.dirname(currentModuleFilename)
      : process.cwd();

if (typeof (globalThis as any).__filename === "undefined" && currentModuleFilename) {
  (globalThis as any).__filename = currentModuleFilename;
}
if (typeof (globalThis as any).__dirname === "undefined") {
  (globalThis as any).__dirname = currentModuleDir;
}

export interface BackupInfo {
  filename: string;
  filepath: string;
  sizeBytes: number;
  sizeDisplay: string;
  createdAt: string;
  recordCount: {
    customers: number;
    suppliers: number;
    sales: number;
    purchases: number;
    stock: number;
  };
}

let SQL: SqlJsStatic | null = null;
let sqliteDb: Database | null = null;

// Determine persistent application data directory across OS platforms
export function getAppDataDirectory(): {
  baseDir: string;
  dbPath: string;
  uploadsDir: string;
  backupsDir: string;
} {
  let baseDir: string;

  if (process.env.FRESH_ERP_DATA_DIR && process.env.FRESH_ERP_DATA_DIR.trim().length > 0) {
    baseDir = process.env.FRESH_ERP_DATA_DIR.trim();
  } else if (process.platform === "win32" && process.env.APPDATA) {
    baseDir = path.join(process.env.APPDATA, "KlyiaFreshERP_Data");
  } else if (process.platform === "darwin" && process.env.HOME) {
    baseDir = path.join(process.env.HOME, "Library", "Application Support", "KlyiaFreshERP_Data");
  } else if (process.env.DATA_DIR && process.env.DATA_DIR.trim().length > 0) {
    baseDir = process.env.DATA_DIR.trim();
  } else {
    // Default fallback in project root / container
    baseDir = path.join(process.cwd(), "data");
  }

  const uploadsDir = path.join(baseDir, "uploads");
  const backupsDir = path.join(baseDir, "backups");
  const dbPath = path.join(baseDir, "fresherp.db");

  // Ensure directories exist safely
  try {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  } catch (err) {
    console.error("[FreshERP Storage] Directory creation warning:", err);
  }

  return { baseDir, dbPath, uploadsDir, backupsDir };
}

// Initialize SQLite WASM engine
async function getSqlInstance(): Promise<SqlJsStatic> {
  if (SQL) return SQL;

  // Guarantee global __filename and __dirname are populated before initSqlJs execution
  if (typeof (globalThis as any).__filename === "undefined") {
    (globalThis as any).__filename = currentModuleFilename;
  }
  if (typeof (globalThis as any).__dirname === "undefined") {
    (globalThis as any).__dirname = currentModuleDir;
  }

  // Locate sql-wasm.wasm whether running from tsx or bundled dist/server.cjs
  let wasmBinary: Buffer | undefined;
  const possibleWasmPaths = [
    process.env.SQL_WASM_PATH,
    path.join(process.cwd(), "dist", "sql-wasm.wasm"),
    path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(currentModuleDir, "sql-wasm.wasm"),
    path.join(currentModuleDir, "..", "dist", "sql-wasm.wasm"),
    path.join(currentModuleDir, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(currentModuleDir, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ].filter(Boolean) as string[];

  for (const p of possibleWasmPaths) {
    if (fs.existsSync(p)) {
      try {
        wasmBinary = fs.readFileSync(p);
        break;
      } catch {
        // continue
      }
    }
  }

  const locateFile = (file: string) => {
    for (const p of possibleWasmPaths) {
      if (fs.existsSync(p)) return p;
    }
    return path.join(currentModuleDir, file);
  };

  SQL = await initSqlJs({
    locateFile,
    ...(wasmBinary ? { wasmBinary } : {}),
  });
  return SQL;
}

// Ensure schema tables & indexes exist
function createTablesAndIndexes(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      must_change_password INTEGER DEFAULT 0,
      last_login TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL,
      tagline TEXT,
      owner_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      gst_number TEXT,
      gstin TEXT,
      upi_id TEXT,
      bank_details TEXT,
      currency TEXT DEFAULT '₹',
      invoice_prefix TEXT DEFAULT 'KFP/2026/',
      invoice_terms TEXT,
      whatsapp_greeting TEXT,
      session_timeout_minutes INTEGER DEFAULT 60,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_profiles (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      trade_name TEXT,
      logo TEXT,
      address TEXT NOT NULL,
      gstin TEXT,
      pan TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      website TEXT,
      bank_details TEXT,
      upi TEXT,
      terms_conditions TEXT,
      signature TEXT,
      authorized_person TEXT,
      is_active INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fruits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      code TEXT,
      category TEXT NOT NULL,
      variety TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'KG',
      default_rate REAL DEFAULT 0,
      gst_rate REAL DEFAULT 0,
      hsn TEXT,
      description TEXT,
      grades_json TEXT NOT NULL,
      min_stock REAL DEFAULT 0,
      image TEXT,
      photo_url TEXT,
      custom_icon_url TEXT,
      avatar_icon TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stock (
      id TEXT PRIMARY KEY,
      fruit_id TEXT NOT NULL,
      fruit_name TEXT NOT NULL,
      variety TEXT NOT NULL,
      grade TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'KG',
      crate_quantity INTEGER NOT NULL DEFAULT 0,
      weight_kg REAL NOT NULL DEFAULT 0,
      purchase_cost_per_kg REAL NOT NULL DEFAULT 0,
      average_cost_per_kg REAL NOT NULL DEFAULT 0,
      selling_rate_per_kg REAL NOT NULL DEFAULT 0,
      stock_value REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      bank_details TEXT,
      gst_number TEXT,
      opening_balance REAL DEFAULT 0,
      notes TEXT,
      total_purchases REAL DEFAULT 0,
      payments_made REAL DEFAULT 0,
      outstanding_payable REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_name TEXT,
      contact_person TEXT,
      phone TEXT NOT NULL,
      whatsapp TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      aadhaar_number TEXT,
      gst_number TEXT,
      gstin TEXT,
      pan TEXT,
      type TEXT DEFAULT 'Wholesale Buyer',
      credit_limit REAL DEFAULT 0,
      credit_period_days INTEGER DEFAULT 7,
      opening_balance REAL DEFAULT 0,
      notes TEXT,
      total_purchases REAL DEFAULT 0,
      total_payments REAL DEFAULT 0,
      outstanding_balance REAL DEFAULT 0,
      last_transaction_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_number TEXT UNIQUE NOT NULL,
      purchase_date TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      fruit_id TEXT NOT NULL,
      fruit_name TEXT NOT NULL,
      variety TEXT NOT NULL,
      grade TEXT NOT NULL,
      crate_quantity INTEGER DEFAULT 0,
      gross_weight REAL DEFAULT 0,
      tare_weight REAL DEFAULT 0,
      net_weight REAL DEFAULT 0,
      purchase_rate REAL DEFAULT 0,
      purchase_value REAL DEFAULT 0,
      transport_cost REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      other_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      effective_cost_per_kg REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'Unpaid',
      paid_amount REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      sale_date TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_business TEXT,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'Credit',
      paid_amount REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'Completed',
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      reference_id TEXT,
      reference_no TEXT,
      description TEXT,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_ledger (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      reference_id TEXT,
      reference_no TEXT,
      description TEXT,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id TEXT PRIMARY KEY,
      payment_date TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'Bank',
      reference_no TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id TEXT PRIMARY KEY,
      payment_date TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'UPI',
      reference_no TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'Cash',
      paid_to TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_rates (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      fruit_id TEXT NOT NULL,
      fruit_name TEXT NOT NULL,
      variety TEXT NOT NULL,
      grade TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'KG',
      purchase_rate REAL DEFAULT 0,
      wholesale_rate REAL DEFAULT 0,
      retail_rate REAL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wastage (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      fruit_id TEXT NOT NULL,
      fruit_name TEXT NOT NULL,
      variety TEXT NOT NULL,
      grade TEXT NOT NULL,
      weight_kg REAL DEFAULT 0,
      crates INTEGER DEFAULT 0,
      estimated_value REAL DEFAULT 0,
      reason TEXT DEFAULT 'Rotten',
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT,
      priority TEXT DEFAULT 'medium',
      severity TEXT DEFAULT 'info',
      date TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      link_section TEXT,
      action_label TEXT,
      action_type TEXT,
      action_target_id TEXT,
      action_data_json TEXT,
      created_at TEXT NOT NULL
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_cust_ledger_cust_id ON customer_ledger(customer_id, date);
    CREATE INDEX IF NOT EXISTS idx_sup_ledger_sup_id ON supplier_ledger(supplier_id, date);
    CREATE INDEX IF NOT EXISTS idx_sales_cust ON sales(customer_id, sale_date);
    CREATE INDEX IF NOT EXISTS idx_purchases_sup ON purchases(supplier_id, purchase_date);
    CREATE INDEX IF NOT EXISTS idx_stock_fruit ON stock(fruit_id, grade);
    CREATE INDEX IF NOT EXISTS idx_rates_fruit_date ON daily_rates(fruit_id, date);
  `);

  // Ensure notifications table has link_section if already existing
  try {
    db.run("ALTER TABLE notifications ADD COLUMN link_section TEXT");
  } catch {
    // Column already exists or table was just created
  }

  // Ensure customers table has aadhaar_number if already existing
  try {
    db.run("ALTER TABLE customers ADD COLUMN aadhaar_number TEXT");
  } catch {
    // Column already exists or table was just created
  }

  // Ensure fruits table has extended catalog columns
  const fruitExtraCols = [
    "short_name TEXT",
    "code TEXT",
    "default_rate REAL DEFAULT 0",
    "gst_rate REAL DEFAULT 0",
    "hsn TEXT",
    "description TEXT",
    "photo_url TEXT",
    "custom_icon_url TEXT",
    "avatar_icon TEXT",
    "updated_at TEXT",
  ];
  for (const c of fruitExtraCols) {
    try {
      db.run(`ALTER TABLE fruits ADD COLUMN ${c}`);
    } catch {
      // Column already exists
    }
  }

  // Ensure sales table has company snapshot columns
  try {
    db.run("ALTER TABLE sales ADD COLUMN company_profile_id TEXT");
  } catch {}
  try {
    db.run("ALTER TABLE sales ADD COLUMN company_snapshot_json TEXT");
  } catch {}

  // Record initial migration
  const migrationCount = db.exec("SELECT COUNT(*) as count FROM schema_migrations");
  const count = migrationCount[0]?.values[0]?.[0] as number;
  if (!count || count === 0) {
    db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)", [new Date().toISOString()]);
  }
}

// Persist the SQLite binary to disk safely with Windows atomic replace
export function saveSqliteDbToDisk(): void {
  if (!sqliteDb) return;
  const { dbPath } = getAppDataDirectory();
  try {
    const data = sqliteDb.export();
    const buffer = Buffer.from(data);
    const tempFile = `${dbPath}.tmp`;
    fs.writeFileSync(tempFile, buffer);
    try {
      fs.renameSync(tempFile, dbPath);
    } catch {
      // Windows-safe fallback: copy and unlink if rename fails due to file lock
      fs.copyFileSync(tempFile, dbPath);
      try {
        fs.unlinkSync(tempFile);
      } catch {}
    }
  } catch (err) {
    console.error("[FreshERP SQLite] Failed to write DB to disk:", err);
  }
}

// Helper to upsert current records and safely delete records no longer in authoritative store
function syncCollectionWithDeletions<T extends { id: string }>(
  tableName: string,
  items: T[] | undefined,
  upsertFn: (item: T) => void
): void {
  if (!sqliteDb || !Array.isArray(items)) return;

  const currentIds = new Set<string>();
  for (const item of items) {
    if (item && item.id) {
      currentIds.add(String(item.id));
      upsertFn(item);
    }
  }

  // Identify obsolete rows in SQLite table to delete
  const existingRows = sqliteDb.exec(`SELECT id FROM ${tableName}`);
  if (existingRows.length > 0 && existingRows[0]?.values) {
    for (const row of existingRows[0].values) {
      const existingId = String(row[0]);
      if (!currentIds.has(existingId)) {
        sqliteDb.run(`DELETE FROM ${tableName} WHERE id = ?`, [existingId]);
      }
    }
  }
}

// Save complete ERP store into SQLite tables transactionally
export function syncStoreToSqlite(store: ERPDataStore): void {
  if (!sqliteDb) return;

  try {
    sqliteDb.run("BEGIN TRANSACTION");

    // 1. Users
    if (store.user) {
      sqliteDb.run(
        `INSERT OR REPLACE INTO users (id, username, password_hash, salt, role, must_change_password, last_login, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "u-1",
          store.user.username || "admin",
          store.user.passwordHash,
          store.user.salt,
          "admin",
          store.user.mustChangePassword ? 1 : 0,
          store.user.lastLogin || null,
          new Date().toISOString(),
        ]
      );
    }

    // 2. Settings
    if (store.settings) {
      sqliteDb.run(
        `INSERT OR REPLACE INTO settings (id, business_name, tagline, owner_name, phone, email, address, city, state, pincode, gst_number, gstin, upi_id, bank_details, currency, invoice_prefix, invoice_terms, whatsapp_greeting, session_timeout_minutes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "set-1",
          store.settings.businessName,
          store.settings.tagline || "",
          store.settings.ownerName || "",
          store.settings.phone || "",
          store.settings.email || "",
          store.settings.address || "",
          store.settings.city || "",
          store.settings.state || "",
          store.settings.pincode || "",
          store.settings.gstNumber || "",
          store.settings.gstin || "",
          store.settings.upiId || "",
          store.settings.bankDetails || "",
          store.settings.currency || "₹",
          store.settings.invoicePrefix || "KFP/2026/",
          store.settings.invoiceTerms || "",
          store.settings.whatsappGreeting || "",
          store.settings.sessionTimeoutMinutes || 60,
          new Date().toISOString(),
        ]
      );
    }

    // 2b. Company Profiles
    if (store.companyProfiles && Array.isArray(store.companyProfiles)) {
      syncCollectionWithDeletions("company_profiles", store.companyProfiles, (cp) => {
        sqliteDb!.run(
          `INSERT OR REPLACE INTO company_profiles (id, company_name, trade_name, logo, address, gstin, pan, phone, email, website, bank_details, upi, terms_conditions, signature, authorized_person, is_active, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cp.id,
            cp.companyName,
            cp.tradeName || null,
            cp.logo || null,
            cp.address,
            cp.gstin || null,
            cp.pan || null,
            cp.phone,
            cp.email || null,
            cp.website || null,
            cp.bankDetails || null,
            cp.upi || null,
            cp.termsConditions || null,
            cp.signature || null,
            cp.authorizedPerson || null,
            cp.isActive ? 1 : 0,
            cp.isDefault ? 1 : 0,
            cp.createdAt || new Date().toISOString(),
            cp.updatedAt || new Date().toISOString(),
          ]
        );
      });
    }

    // 3. Customers
    syncCollectionWithDeletions("customers", store.customers, (c) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO customers (id, name, business_name, contact_person, phone, whatsapp, email, address, city, state, aadhaar_number, gst_number, gstin, pan, type, credit_limit, credit_period_days, opening_balance, notes, total_purchases, total_payments, outstanding_balance, last_transaction_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.name,
          c.businessName || null,
          c.contactPerson || null,
          c.phone,
          c.whatsapp || null,
          c.email || null,
          c.address || null,
          c.city || null,
          c.state || null,
          c.aadhaarNumber || (c as any).aadhaar || null,
          c.gstNumber || null,
          c.gstin || null,
          c.pan || null,
          c.type || "Wholesale Buyer",
          c.creditLimit || 0,
          c.creditPeriodDays || 7,
          c.openingBalance || 0,
          c.notes || null,
          c.totalPurchases || 0,
          c.totalPayments || (c as any).totalPaid || 0,
          c.outstandingBalance || 0,
          c.lastTransactionDate || null,
          c.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 4. Suppliers
    syncCollectionWithDeletions("suppliers", store.suppliers, (s) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO suppliers (id, name, contact_person, phone, email, address, city, state, bank_details, gst_number, opening_balance, notes, total_purchases, payments_made, outstanding_payable, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.name,
          s.contactPerson || null,
          s.phone,
          s.email || null,
          s.address || null,
          s.city || null,
          s.state || null,
          s.bankDetails || null,
          s.gstNumber || null,
          s.openingBalance || 0,
          s.notes || null,
          s.totalPurchases || 0,
          s.paymentsMade || (s as any).totalPaid || 0,
          s.outstandingPayable || 0,
          s.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 5. Customer Ledger
    syncCollectionWithDeletions("customer_ledger", store.customerLedger, (l) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO customer_ledger (id, customer_id, date, type, reference_id, reference_no, description, debit, credit, balance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          l.id,
          l.customerId,
          l.date,
          l.type,
          l.referenceId || null,
          l.referenceNo || null,
          l.description || null,
          l.debit || 0,
          l.credit || 0,
          l.balance || 0,
          l.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 6. Supplier Ledger
    syncCollectionWithDeletions("supplier_ledger", store.supplierLedger, (l) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO supplier_ledger (id, supplier_id, date, type, reference_id, reference_no, description, debit, credit, balance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          l.id,
          l.supplierId,
          l.date,
          l.type,
          l.referenceId || null,
          l.referenceNo || null,
          l.description || null,
          l.debit || 0,
          l.credit || 0,
          l.balance || 0,
          l.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 7. Sales
    syncCollectionWithDeletions("sales", store.sales, (s) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO sales (id, invoice_number, sale_date, customer_id, customer_name, customer_phone, customer_business, subtotal, discount, grand_total, payment_method, paid_amount, due_amount, notes, status, items_json, company_profile_id, company_snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.invoiceNumber,
          s.saleDate,
          s.customerId,
          s.customerName,
          s.customerPhone || null,
          s.customerBusiness || null,
          s.subtotal || 0,
          s.discount || 0,
          s.grandTotal || 0,
          s.paymentMethod || "Credit",
          s.paidAmount || 0,
          s.dueAmount || 0,
          s.notes || null,
          s.status || "Completed",
          JSON.stringify(s.items || []),
          s.companyProfileId || null,
          s.companySnapshot ? JSON.stringify(s.companySnapshot) : null,
          s.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 8. Purchases
    syncCollectionWithDeletions("purchases", store.purchases, (p) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO purchases (id, purchase_number, purchase_date, supplier_id, supplier_name, fruit_id, fruit_name, variety, grade, crate_quantity, gross_weight, tare_weight, net_weight, purchase_rate, purchase_value, transport_cost, commission, other_cost, total_cost, effective_cost_per_kg, payment_status, paid_amount, due_amount, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.purchaseNumber,
          p.purchaseDate,
          p.supplierId,
          p.supplierName,
          p.fruitId,
          p.fruitName,
          p.variety,
          p.grade,
          p.crateQuantity || 0,
          p.grossWeight || 0,
          p.tareWeight || 0,
          p.netWeight || (p as any).netWeightKg || 0,
          p.purchaseRate || 0,
          p.purchaseValue || 0,
          p.transportCost || 0,
          p.commission || 0,
          p.otherCost || 0,
          p.totalCost || (p as any).totalAmount || 0,
          p.effectiveCostPerKg || 0,
          p.paymentStatus || "Unpaid",
          p.paidAmount || 0,
          p.dueAmount || 0,
          p.notes || null,
          p.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 9. Stock
    syncCollectionWithDeletions("stock", store.stock, (s) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO stock (id, fruit_id, fruit_name, variety, grade, unit, crate_quantity, weight_kg, purchase_cost_per_kg, average_cost_per_kg, selling_rate_per_kg, stock_value, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.fruitId,
          s.fruitName,
          s.variety,
          s.grade,
          s.unit || "KG",
          s.crateQuantity || (s as any).cratesCount || 0,
          s.weightKg || 0,
          s.purchaseCostPerKg || 0,
          s.averageCostPerKg || 0,
          s.sellingRatePerKg || 0,
          s.stockValue || 0,
          s.lastUpdated || new Date().toISOString(),
        ]
      );
    });

    // 10. Fruits
    syncCollectionWithDeletions("fruits", store.fruits, (f) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO fruits (id, name, short_name, code, category, variety, unit, default_rate, gst_rate, hsn, description, grades_json, min_stock, image, photo_url, custom_icon_url, avatar_icon, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          f.id,
          f.name,
          f.shortName || null,
          f.code || f.productCode || null,
          f.category,
          f.variety,
          f.unit || "KG",
          f.defaultRate || 0,
          f.gstRate || 0,
          f.hsn || f.hsnSac || null,
          f.description || null,
          JSON.stringify(f.grades || []),
          f.minStock || 0,
          f.image || null,
          f.photoUrl || (f as any).imageUrl || null,
          f.customIconUrl || null,
          f.avatarIcon || (f as any).defaultIcon || null,
          f.status || "active",
          f.createdAt || new Date().toISOString(),
          f.updatedAt || new Date().toISOString(),
        ]
      );
    });

    // 11. Expenses
    syncCollectionWithDeletions("expenses", store.expenses, (e) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO expenses (id, date, category, description, amount, payment_method, paid_to, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.date,
          e.category,
          e.description || "",
          e.amount || 0,
          e.paymentMethod || "Cash",
          e.paidTo || null,
          e.notes || "",
          e.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 12. Wastage
    syncCollectionWithDeletions("wastage", store.wastage, (w) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO wastage (id, date, fruit_id, fruit_name, variety, grade, weight_kg, crates, estimated_value, reason, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          w.id,
          w.date,
          w.fruitId,
          w.fruitName,
          w.variety,
          w.grade,
          w.weightKg || 0,
          w.crates || (w as any).cratesCount || 0,
          w.estimatedValue || 0,
          w.reason || "Rotten",
          w.notes || null,
          w.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 13. Daily Rates
    syncCollectionWithDeletions("daily_rates", store.dailyRates, (r) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO daily_rates (id, date, fruit_id, fruit_name, variety, grade, unit, purchase_rate, wholesale_rate, retail_rate, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.id,
          r.date,
          r.fruitId,
          r.fruitName,
          r.variety,
          r.grade,
          r.unit || "KG",
          r.purchaseRate || 0,
          r.wholesaleRate || 0,
          r.retailRate || 0,
          r.updatedAt || new Date().toISOString(),
        ]
      );
    });

    // 14. Customer Payments
    syncCollectionWithDeletions("customer_payments", store.customerPayments, (cp) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO customer_payments (id, payment_date, customer_id, customer_name, amount, payment_method, reference_no, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cp.id,
          cp.paymentDate,
          cp.customerId,
          cp.customerName,
          cp.amount || 0,
          cp.paymentMethod || "UPI",
          cp.referenceNo || "",
          cp.notes || "",
          cp.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 15. Supplier Payments
    syncCollectionWithDeletions("supplier_payments", store.supplierPayments, (sp) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO supplier_payments (id, payment_date, supplier_id, supplier_name, amount, payment_method, reference_no, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sp.id,
          sp.paymentDate,
          sp.supplierId,
          sp.supplierName,
          sp.amount || 0,
          sp.paymentMethod || "Bank",
          sp.referenceNo || "",
          sp.notes || "",
          sp.createdAt || new Date().toISOString(),
        ]
      );
    });

    // 16. Notifications
    syncCollectionWithDeletions("notifications", store.notifications, (n) => {
      sqliteDb!.run(
        `INSERT OR REPLACE INTO notifications (id, title, message, type, category, priority, severity, date, read, link_section, action_label, action_type, action_target_id, action_data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n.id,
          n.title,
          n.message,
          n.type,
          n.category || null,
          n.priority || "medium",
          n.severity || "info",
          n.date,
          n.read ? 1 : 0,
          n.linkSection || null,
          n.actionLabel || null,
          n.actionType || null,
          n.actionTargetId || null,
          n.actionData ? JSON.stringify(n.actionData) : null,
          new Date().toISOString(),
        ]
      );
    });

    sqliteDb.run("COMMIT");

    // Save binary to disk safely
    saveSqliteDbToDisk();
  } catch (err) {
    try {
      sqliteDb.run("ROLLBACK");
    } catch {}
    console.error("[FreshERP SQLite] Error syncing store to SQLite:", err);
  }
}

// Read database from SQLite tables into ERPDataStore structure
export function loadStoreFromSqlite(): ERPDataStore | null {
  if (!sqliteDb) return null;

  try {
    // Check if users table has data
    const userRes = sqliteDb.exec("SELECT * FROM users LIMIT 1");
    if (!userRes || userRes.length === 0 || !userRes[0]?.values?.length) {
      return null;
    }

    const mapRowToObj = (columns: string[], values: any[]) => {
      const obj: any = {};
      columns.forEach((col, idx) => {
        obj[col] = values[idx];
      });
      return obj;
    };

    // User
    const uRow = mapRowToObj(userRes[0].columns, userRes[0].values[0]);
    const user = {
      username: uRow.username,
      passwordHash: uRow.password_hash,
      salt: uRow.salt,
      mustChangePassword: Boolean(uRow.must_change_password),
      lastLogin: uRow.last_login || undefined,
    };

    // Settings
    const setRes = sqliteDb.exec("SELECT * FROM settings LIMIT 1");
    let settings: BusinessSettings = {
      businessName: "Klyia Fresh Produce Wholesale",
      ownerName: "Admin",
      phone: "+91 98765 43210",
      address: "APMC Fruit Market Yard",
      city: "Navi Mumbai",
    };

    if (setRes && setRes.length > 0 && setRes[0].values.length > 0) {
      const sRow = mapRowToObj(setRes[0].columns, setRes[0].values[0]);
      settings = {
        businessName: sRow.business_name,
        tagline: sRow.tagline,
        ownerName: sRow.owner_name,
        phone: sRow.phone,
        email: sRow.email,
        address: sRow.address,
        city: sRow.city,
        state: sRow.state,
        pincode: sRow.pincode,
        gstNumber: sRow.gst_number,
        gstin: sRow.gstin,
        upiId: sRow.upi_id,
        bankDetails: sRow.bank_details,
        currency: sRow.currency || "₹",
        invoicePrefix: sRow.invoice_prefix || "KFP/2026/",
        invoiceTerms: sRow.invoice_terms,
        whatsappGreeting: sRow.whatsapp_greeting,
        sessionTimeoutMinutes: sRow.session_timeout_minutes || 60,
      };
    }

    // Customers
    const custRes = sqliteDb.exec("SELECT * FROM customers ORDER BY name ASC");
    const customers: Customer[] = [];
    if (custRes.length > 0) {
      const cols = custRes[0].columns;
      for (const vals of custRes[0].values) {
        const r = mapRowToObj(cols, vals);
        customers.push({
          id: r.id,
          name: r.name,
          businessName: r.business_name || "",
          contactPerson: r.contact_person || undefined,
          phone: r.phone,
          whatsapp: r.whatsapp || undefined,
          email: r.email || undefined,
          address: r.address || "",
          city: r.city || "",
          state: r.state || undefined,
          aadhaarNumber: r.aadhaar_number || undefined,
          aadhaar: r.aadhaar_number || undefined,
          gstNumber: r.gst_number || undefined,
          gstin: r.gstin || undefined,
          pan: r.pan || undefined,
          type: r.type || "Wholesale Buyer",
          creditLimit: r.credit_limit || 0,
          creditPeriodDays: r.credit_period_days || 7,
          openingBalance: r.opening_balance || 0,
          notes: r.notes || undefined,
          totalPurchases: r.total_purchases || 0,
          totalPayments: r.total_payments || 0,
          totalPaid: r.total_payments || 0,
          outstandingBalance: r.outstanding_balance || 0,
          lastTransactionDate: r.last_transaction_date || undefined,
          createdAt: r.created_at,
        });
      }
    }

    // Suppliers
    const supRes = sqliteDb.exec("SELECT * FROM suppliers ORDER BY name ASC");
    const suppliers: Supplier[] = [];
    if (supRes.length > 0) {
      const cols = supRes[0].columns;
      for (const vals of supRes[0].values) {
        const r = mapRowToObj(cols, vals);
        suppliers.push({
          id: r.id,
          name: r.name,
          contactPerson: r.contact_person || "",
          phone: r.phone,
          email: r.email || undefined,
          address: r.address || "",
          city: r.city || undefined,
          state: r.state || undefined,
          bankDetails: r.bank_details || undefined,
          gstNumber: r.gst_number || undefined,
          openingBalance: r.opening_balance || 0,
          notes: r.notes || undefined,
          totalPurchases: r.total_purchases || 0,
          paymentsMade: r.payments_made || 0,
          totalPaid: r.payments_made || 0,
          outstandingPayable: r.outstanding_payable || 0,
          createdAt: r.created_at,
        });
      }
    }

    // Customer Ledger
    const clRes = sqliteDb.exec("SELECT * FROM customer_ledger ORDER BY date ASC, created_at ASC");
    const customerLedger: CustomerLedgerEntry[] = [];
    if (clRes.length > 0) {
      const cols = clRes[0].columns;
      for (const vals of clRes[0].values) {
        const r = mapRowToObj(cols, vals);
        customerLedger.push({
          id: r.id,
          customerId: r.customer_id,
          date: r.date,
          type: r.type,
          referenceId: r.reference_id || "",
          referenceNo: r.reference_no || undefined,
          description: r.description || undefined,
          notes: r.description || undefined,
          debit: r.debit || 0,
          credit: r.credit || 0,
          balance: r.balance || 0,
          createdAt: r.created_at,
        });
      }
    }

    // Supplier Ledger
    const slRes = sqliteDb.exec("SELECT * FROM supplier_ledger ORDER BY date ASC, created_at ASC");
    const supplierLedger: SupplierLedgerEntry[] = [];
    if (slRes.length > 0) {
      const cols = slRes[0].columns;
      for (const vals of slRes[0].values) {
        const r = mapRowToObj(cols, vals);
        supplierLedger.push({
          id: r.id,
          supplierId: r.supplier_id,
          date: r.date,
          type: r.type,
          referenceId: r.reference_id || "",
          referenceNo: r.reference_no || undefined,
          description: r.description || undefined,
          notes: r.description || undefined,
          debit: r.debit || 0,
          credit: r.credit || 0,
          balance: r.balance || 0,
          createdAt: r.created_at,
        });
      }
    }

    // Sales
    const sRes = sqliteDb.exec("SELECT * FROM sales ORDER BY sale_date DESC, created_at DESC");
    const sales: Sale[] = [];
    if (sRes.length > 0) {
      const cols = sRes[0].columns;
      for (const vals of sRes[0].values) {
        const r = mapRowToObj(cols, vals);
        let items: any[] = [];
        try {
          items = JSON.parse(r.items_json || "[]");
        } catch {
          items = [];
        }
        let companySnapshot: any = undefined;
        if (r.company_snapshot_json) {
          try {
            companySnapshot = JSON.parse(r.company_snapshot_json);
          } catch {}
        }
        sales.push({
          id: r.id,
          invoiceNumber: r.invoice_number,
          saleDate: r.sale_date,
          customerId: r.customer_id,
          customerName: r.customer_name,
          customerPhone: r.customer_phone || "",
          customerBusiness: r.customer_business || undefined,
          companyProfileId: r.company_profile_id || undefined,
          companySnapshot,
          items,
          subtotal: r.subtotal || 0,
          discount: r.discount || 0,
          grandTotal: r.grand_total || 0,
          totalAmount: r.grand_total || 0,
          paymentMethod: r.payment_method || "Credit",
          paidAmount: r.paid_amount || 0,
          dueAmount: r.due_amount || 0,
          notes: r.notes || "",
          status: r.status || "Completed",
          createdAt: r.created_at,
        });
      }
    }

    // Purchases
    const pRes = sqliteDb.exec("SELECT * FROM purchases ORDER BY purchase_date DESC, created_at DESC");
    const purchases: PurchaseItem[] = [];
    if (pRes.length > 0) {
      const cols = pRes[0].columns;
      for (const vals of pRes[0].values) {
        const r = mapRowToObj(cols, vals);
        purchases.push({
          id: r.id,
          purchaseNumber: r.purchase_number,
          purchaseDate: r.purchase_date,
          supplierId: r.supplier_id,
          supplierName: r.supplier_name,
          fruitId: r.fruit_id,
          fruitName: r.fruit_name,
          variety: r.variety,
          grade: r.grade,
          crateQuantity: r.crate_quantity || 0,
          grossWeight: r.gross_weight || 0,
          tareWeight: r.tare_weight || 0,
          netWeight: r.net_weight || 0,
          netWeightKg: r.net_weight || 0,
          purchaseRate: r.purchase_rate || 0,
          purchaseValue: r.purchase_value || 0,
          transportCost: r.transport_cost || 0,
          commission: r.commission || 0,
          otherCost: r.other_cost || 0,
          totalCost: r.total_cost || 0,
          totalAmount: r.total_cost || 0,
          effectiveCostPerKg: r.effective_cost_per_kg || 0,
          paymentStatus: r.payment_status || "Unpaid",
          paidAmount: r.paid_amount || 0,
          dueAmount: r.due_amount || 0,
          notes: r.notes || "",
          createdAt: r.created_at,
        });
      }
    }

    // Stock
    const stRes = sqliteDb.exec("SELECT * FROM stock ORDER BY fruit_name ASC");
    const stock: StockRecord[] = [];
    if (stRes.length > 0) {
      const cols = stRes[0].columns;
      for (const vals of stRes[0].values) {
        const r = mapRowToObj(cols, vals);
        stock.push({
          id: r.id,
          fruitId: r.fruit_id,
          fruitName: r.fruit_name,
          variety: r.variety,
          grade: r.grade,
          unit: r.unit || "KG",
          crateQuantity: r.crate_quantity || 0,
          cratesCount: r.crate_quantity || 0,
          weightKg: r.weight_kg || 0,
          purchaseCostPerKg: r.purchase_cost_per_kg || 0,
          averageCostPerKg: r.average_cost_per_kg || 0,
          sellingRatePerKg: r.selling_rate_per_kg || 0,
          stockValue: r.stock_value || 0,
          lastUpdated: r.last_updated,
        });
      }
    }

    // Fruits
    const fRes = sqliteDb.exec("SELECT * FROM fruits ORDER BY name ASC");
    const fruits: FruitItem[] = [];
    if (fRes.length > 0) {
      const cols = fRes[0].columns;
      for (const vals of fRes[0].values) {
        const r = mapRowToObj(cols, vals);
        let grades: any[] = [];
        try {
          grades = JSON.parse(r.grades_json || "[]");
        } catch {
          grades = [];
        }
        fruits.push({
          id: r.id,
          name: r.name,
          shortName: r.short_name || undefined,
          code: r.code || undefined,
          productCode: r.code || undefined,
          category: r.category,
          variety: r.variety,
          unit: r.unit || "KG",
          defaultRate: Number(r.default_rate) || 0,
          gstRate: Number(r.gst_rate) || 0,
          hsn: r.hsn || undefined,
          hsnSac: r.hsn || undefined,
          description: r.description || undefined,
          grades,
          minStock: r.min_stock || 0,
          minStockAlertKg: r.min_stock || 0,
          image: r.image || undefined,
          photoUrl: r.photo_url || undefined,
          customIconUrl: r.custom_icon_url || undefined,
          avatarIcon: r.avatar_icon || undefined,
          status: r.status || "active",
          createdAt: r.created_at,
          updatedAt: r.updated_at || undefined,
        });
      }
    }

    // Expenses
    const expRes = sqliteDb.exec("SELECT * FROM expenses ORDER BY date DESC");
    const expenses: Expense[] = [];
    if (expRes.length > 0) {
      const cols = expRes[0].columns;
      for (const vals of expRes[0].values) {
        const r = mapRowToObj(cols, vals);
        expenses.push({
          id: r.id,
          date: r.date,
          category: r.category,
          description: r.description || "",
          amount: r.amount || 0,
          paymentMethod: r.payment_method || "Cash",
          paidTo: r.paid_to || undefined,
          notes: r.notes || "",
          createdAt: r.created_at,
        });
      }
    }

    // Wastage
    const wstRes = sqliteDb.exec("SELECT * FROM wastage ORDER BY date DESC");
    const wastage: WastageEntry[] = [];
    if (wstRes.length > 0) {
      const cols = wstRes[0].columns;
      for (const vals of wstRes[0].values) {
        const r = mapRowToObj(cols, vals);
        wastage.push({
          id: r.id,
          date: r.date,
          fruitId: r.fruit_id,
          fruitName: r.fruit_name,
          variety: r.variety,
          grade: r.grade,
          weightKg: r.weight_kg || 0,
          crates: r.crates || 0,
          cratesCount: r.crates || 0,
          estimatedValue: r.estimated_value || 0,
          reason: r.reason || "Rotten",
          notes: r.notes || "",
          createdAt: r.created_at,
        });
      }
    }

    // Daily Rates
    const drRes = sqliteDb.exec("SELECT * FROM daily_rates ORDER BY date DESC");
    const dailyRates: DailyRateEntry[] = [];
    if (drRes.length > 0) {
      const cols = drRes[0].columns;
      for (const vals of drRes[0].values) {
        const r = mapRowToObj(cols, vals);
        dailyRates.push({
          id: r.id,
          date: r.date,
          fruitId: r.fruit_id,
          fruitName: r.fruit_name,
          variety: r.variety,
          grade: r.grade,
          unit: r.unit || "KG",
          purchaseRate: r.purchase_rate || 0,
          wholesaleRate: r.wholesale_rate || 0,
          retailRate: r.retail_rate || 0,
          updatedAt: r.updated_at,
        });
      }
    }

    // 12. Customer Payments
    const custPayRes = sqliteDb.exec("SELECT * FROM customer_payments ORDER BY payment_date DESC, created_at DESC");
    const customerPayments = [];
    if (custPayRes.length > 0) {
      const cols = custPayRes[0].columns;
      for (const vals of custPayRes[0].values) {
        const r = mapRowToObj(cols, vals);
        customerPayments.push({
          id: String(r.id),
          paymentDate: String(r.payment_date),
          customerId: String(r.customer_id),
          customerName: String(r.customer_name),
          amount: Number(r.amount) || 0,
          paymentMethod: (r.payment_method || "UPI") as any,
          referenceNo: String(r.reference_no || ""),
          notes: String(r.notes || ""),
          createdAt: String(r.created_at || new Date().toISOString()),
        });
      }
    }

    // 13. Supplier Payments
    const supPayRes = sqliteDb.exec("SELECT * FROM supplier_payments ORDER BY payment_date DESC, created_at DESC");
    const supplierPayments = [];
    if (supPayRes.length > 0) {
      const cols = supPayRes[0].columns;
      for (const vals of supPayRes[0].values) {
        const r = mapRowToObj(cols, vals);
        supplierPayments.push({
          id: String(r.id),
          paymentDate: String(r.payment_date),
          supplierId: String(r.supplier_id),
          supplierName: String(r.supplier_name),
          amount: Number(r.amount) || 0,
          paymentMethod: (r.payment_method || "Bank") as any,
          referenceNo: String(r.reference_no || ""),
          notes: String(r.notes || ""),
          createdAt: String(r.created_at || new Date().toISOString()),
        });
      }
    }

    // 14. Notifications
    const notifRes = sqliteDb.exec("SELECT * FROM notifications ORDER BY date DESC, created_at DESC");
    const notifications = [];
    if (notifRes.length > 0) {
      const cols = notifRes[0].columns;
      for (const vals of notifRes[0].values) {
        const r = mapRowToObj(cols, vals);
        let actionData: any = undefined;
        if (r.action_data_json) {
          try {
            actionData = JSON.parse(r.action_data_json);
          } catch {
            // silent fallback
          }
        }
        notifications.push({
          id: String(r.id),
          title: String(r.title),
          message: String(r.message),
          type: String(r.type),
          category: r.category ? (String(r.category) as any) : undefined,
          priority: r.priority ? (String(r.priority) as any) : undefined,
          severity: (r.severity || "info") as any,
          date: String(r.date),
          read: Boolean(r.read === 1 || r.read === true),
          linkSection: r.link_section ? String(r.link_section) : undefined,
          actionLabel: r.action_label ? String(r.action_label) : undefined,
          actionType: r.action_type ? (String(r.action_type) as any) : undefined,
          actionTargetId: r.action_target_id ? String(r.action_target_id) : undefined,
          actionData,
        });
      }
    }

    // 15. Company Profiles
    const compRes = sqliteDb.exec("SELECT * FROM company_profiles ORDER BY is_default DESC, company_name ASC");
    const companyProfiles: CompanyBillProfile[] = [];
    if (compRes.length > 0) {
      const cols = compRes[0].columns;
      for (const vals of compRes[0].values) {
        const r = mapRowToObj(cols, vals);
        companyProfiles.push({
          id: String(r.id),
          companyName: String(r.company_name),
          tradeName: r.trade_name ? String(r.trade_name) : undefined,
          logo: r.logo ? String(r.logo) : undefined,
          address: String(r.address),
          gstin: r.gstin ? String(r.gstin) : undefined,
          pan: r.pan ? String(r.pan) : undefined,
          phone: String(r.phone),
          email: r.email ? String(r.email) : undefined,
          website: r.website ? String(r.website) : undefined,
          bankDetails: r.bank_details ? String(r.bank_details) : undefined,
          upi: r.upi ? String(r.upi) : undefined,
          termsConditions: r.terms_conditions ? String(r.terms_conditions) : undefined,
          signature: r.signature ? String(r.signature) : undefined,
          authorizedPerson: r.authorized_person ? String(r.authorized_person) : undefined,
          isActive: Boolean(r.is_active === 1 || r.is_active === true),
          isDefault: Boolean(r.is_default === 1 || r.is_default === true),
          createdAt: String(r.created_at || new Date().toISOString()),
          updatedAt: r.updated_at ? String(r.updated_at) : undefined,
        });
      }
    }

    return {
      user,
      settings,
      companyProfiles,
      fruits,
      stock,
      suppliers,
      customers,
      purchases,
      sales,
      customerLedger,
      supplierLedger,
      supplierPayments,
      customerPayments,
      expenses,
      dailyRates,
      wastage,
      notifications,
    };
  } catch (err) {
    console.error("[FreshERP SQLite] Failed to load store from SQLite:", err);
    return null;
  }
}

// Master initialization: creates SQLite DB file or opens existing one safely
export async function initializeSqliteEngine(seedFallback: () => ERPDataStore): Promise<{
  db: Database;
  store: ERPDataStore;
}> {
  const { dbPath } = getAppDataDirectory();
  const sql = await getSqlInstance();

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      sqliteDb = new sql.Database(fileBuffer);
      createTablesAndIndexes(sqliteDb);
      const loaded = loadStoreFromSqlite();
      if (loaded) {
        console.log(`[FreshERP SQLite] Successfully opened existing local database at: ${dbPath}`);
        return { db: sqliteDb, store: loaded };
      }
    } catch (err) {
      console.error("[FreshERP SQLite] Could not open existing DB, verifying integrity:", err);
    }
  }

  // Create new database safely without losing anything
  console.log(`[FreshERP SQLite] Initializing fresh local SQLite database at: ${dbPath}`);
  sqliteDb = new sql.Database();
  createTablesAndIndexes(sqliteDb);

  const initialData = seedFallback();
  syncStoreToSqlite(initialData);

  return { db: sqliteDb, store: initialData };
}

// Backup current database to timestamped file in backups directory
export function createDatabaseBackup(customNote?: string): BackupInfo {
  const { backupsDir, dbPath } = getAppDataDirectory();
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const cleanNote = customNote ? `_${customNote.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const backupFilename = `fresherp_backup_${timestampStr}${cleanNote}.db`;
  const backupFilepath = path.join(backupsDir, backupFilename);

  // Export current database bytes
  if (sqliteDb) {
    const data = sqliteDb.export();
    fs.writeFileSync(backupFilepath, Buffer.from(data));
  } else if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupFilepath);
  } else {
    throw new Error("Cannot create backup: No active SQLite database found.");
  }

  const stat = fs.statSync(backupFilepath);
  const sizeKb = (stat.size / 1024).toFixed(1);

  // Load record counts for transparency
  const store = loadStoreFromSqlite();
  return {
    filename: backupFilename,
    filepath: backupFilepath,
    sizeBytes: stat.size,
    sizeDisplay: `${sizeKb} KB`,
    createdAt: now.toISOString(),
    recordCount: {
      customers: store?.customers?.length || 0,
      suppliers: store?.suppliers?.length || 0,
      sales: store?.sales?.length || 0,
      purchases: store?.purchases?.length || 0,
      stock: store?.stock?.length || 0,
    },
  };
}

// List all available backups
export function listDatabaseBackups(): BackupInfo[] {
  const { backupsDir } = getAppDataDirectory();
  if (!fs.existsSync(backupsDir)) return [];

  const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith(".db") || f.endsWith(".json"));
  const list: BackupInfo[] = [];

  for (const filename of files) {
    try {
      const filepath = path.join(backupsDir, filename);
      const stat = fs.statSync(filepath);
      list.push({
        filename,
        filepath,
        sizeBytes: stat.size,
        sizeDisplay: `${(stat.size / 1024).toFixed(1)} KB`,
        createdAt: stat.mtime.toISOString(),
        recordCount: {
          customers: 0,
          suppliers: 0,
          sales: 0,
          purchases: 0,
          stock: 0,
        },
      });
    } catch {
      // ignore individual stat errors
    }
  }

  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Restore database from a backup file safely
export async function restoreDatabaseBackup(filename: string): Promise<ERPDataStore> {
  const { backupsDir, dbPath } = getAppDataDirectory();
  const targetPath = path.join(backupsDir, filename);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup file '${filename}' does not exist.`);
  }

  // First take an automatic safety backup of current state
  try {
    createDatabaseBackup("pre_restore_safety");
  } catch (safetyErr) {
    console.warn("[FreshERP Backup] Pre-restore safety backup skipped:", safetyErr);
  }

  const sql = await getSqlInstance();
  const backupBuffer = fs.readFileSync(targetPath);
  sqliteDb = new sql.Database(backupBuffer);
  createTablesAndIndexes(sqliteDb);
  saveSqliteDbToDisk();

  const restoredStore = loadStoreFromSqlite();
  if (!restoredStore) {
    throw new Error("Failed to restore: Backup file does not contain valid FreshERP tables.");
  }

  return restoredStore;
}
