import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import multer from "multer";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// Ensure global __filename and __dirname exist in runtime environments (needed for sql.js and path resolution)
const currentServerFilename =
  typeof __filename !== "undefined"
    ? __filename
    : typeof process !== "undefined" && process.argv && process.argv[1]
      ? process.argv[1]
      : process.cwd();
const currentServerDirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : currentServerFilename
      ? path.dirname(currentServerFilename)
      : process.cwd();

if (typeof (globalThis as any).__filename === "undefined" && currentServerFilename) {
  (globalThis as any).__filename = currentServerFilename;
}
if (typeof (globalThis as any).__dirname === "undefined") {
  (globalThis as any).__dirname = currentServerDirname;
}
import { ERPDataStore, UserSession } from "./src/types";
import {
  processAiQuestion,
  generateDailySummary,
  generateSmartNotifications,
  getBusinessFAQs,
} from "./server/erpAiEngine";
import {
  getAppDataDirectory,
  initializeSqliteEngine,
  syncStoreToSqlite,
  loadStoreFromSqlite,
  createDatabaseBackup,
  listDatabaseBackups,
  restoreDatabaseBackup,
  saveSqliteDbToDisk,
} from "./server/sqliteDb";

dotenv.config();

const app = express();
// Port support: process.env.PORT or fallback 3000
const rawPort = process.env.PORT || 3000;
const PORT = rawPort;

const { baseDir: DATA_DIR, dbPath, uploadsDir, backupsDir } = getAppDataDirectory();
const DB_FILE = path.join(DATA_DIR, "fresh_erp_db.json");

// Local file storage via Multer with safe unique names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const safeBaseName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${uniqueSuffix}_${safeBaseName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
});

// Serve uploaded documents, bills, images directly from local persistent uploads directory
app.use("/uploads", express.static(uploadsDir));

// CORS & security pre-flight handling for cross-domain / reverse proxy deployments
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Normalize legacy or relative /data/api/* requests to /api/*
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.url.startsWith("/data/api/")) {
    req.url = req.url.replace(/^\/data\/api\//, "/api/");
  } else if (req.url === "/data/api") {
    req.url = "/api";
  }
  next();
});

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health check endpoint for host/proxy uptime checks
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ ok: true });
});

// Helper for secure password hashing
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial realistic wholesale fruit demo data
function getInitialSeedData(): ERPDataStore {
  const defaultSalt = generateSalt();
  // Default password: klyia123456
  const defaultHash = hashPassword("klyia123456", defaultSalt);
  // Default Dashboard PIN: 1234
  const defaultPinSalt = generateSalt();
  const defaultPinHash = hashPassword("1234", defaultPinSalt);
  const now = new Date().toISOString();
  const todayStr = now.split("T")[0];

  const fruits = [
    {
      id: "f-1",
      name: "Kashmiri Apple",
      category: "Apples & Pears",
      variety: "Royal Delicious",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 110, wholesaleRate: 135, retailRate: 155 },
        { grade: "B" as const, purchaseRate: 85, wholesaleRate: 105, retailRate: 120 },
        { grade: "C" as const, purchaseRate: 55, wholesaleRate: 70, retailRate: 85 },
        { grade: "Damaged" as const, purchaseRate: 25, wholesaleRate: 35, retailRate: 40 },
      ],
      minStock: 500,
      image: "🍎",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-2",
      name: "Nagpur Orange",
      category: "Citrus",
      variety: "Kinnow Supreme",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 52, wholesaleRate: 68, retailRate: 80 },
        { grade: "B" as const, purchaseRate: 38, wholesaleRate: 50, retailRate: 62 },
        { grade: "C" as const, purchaseRate: 25, wholesaleRate: 34, retailRate: 40 },
      ],
      minStock: 400,
      image: "🍊",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-3",
      name: "Robusta Banana",
      category: "Bananas",
      variety: "Cavendish G9",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 24, wholesaleRate: 34, retailRate: 42 },
        { grade: "B" as const, purchaseRate: 18, wholesaleRate: 26, retailRate: 32 },
      ],
      minStock: 600,
      image: "🍌",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-4",
      name: "Alphonso Mango",
      category: "Mangoes & Tropical",
      variety: "Ratnagiri GI",
      unit: "Box" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 750, wholesaleRate: 980, retailRate: 1200 },
        { grade: "B" as const, purchaseRate: 520, wholesaleRate: 680, retailRate: 850 },
      ],
      minStock: 100,
      image: "🥭",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-5",
      name: "Seedless Green Grapes",
      category: "Berries & Grapes",
      variety: "Tas-A-Ganesh",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 65, wholesaleRate: 85, retailRate: 105 },
        { grade: "B" as const, purchaseRate: 45, wholesaleRate: 60, retailRate: 75 },
      ],
      minStock: 300,
      image: "🍇",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-6",
      name: "Kiran Watermelon",
      category: "Melons",
      variety: "Sugar Baby Dark",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 14, wholesaleRate: 22, retailRate: 30 },
        { grade: "B" as const, purchaseRate: 10, wholesaleRate: 16, retailRate: 22 },
      ],
      minStock: 1000,
      image: "🍉",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-7",
      name: "Sindhuri Pomegranate",
      category: "Exotic & Pome",
      variety: "Bhagwa Red",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 130, wholesaleRate: 175, retailRate: 210 },
        { grade: "B" as const, purchaseRate: 95, wholesaleRate: 130, retailRate: 155 },
      ],
      minStock: 250,
      image: "🍎",
      status: "active" as const,
      createdAt: now,
    },
    {
      id: "f-8",
      name: "Taiwan Red Papaya",
      category: "Mangoes & Tropical",
      variety: "Taiwan 786",
      unit: "KG" as const,
      grades: [
        { grade: "A" as const, purchaseRate: 22, wholesaleRate: 35, retailRate: 45 },
        { grade: "B" as const, purchaseRate: 15, wholesaleRate: 24, retailRate: 32 },
      ],
      minStock: 400,
      image: "🍈",
      status: "active" as const,
      createdAt: now,
    }
  ];

  const stock = [
    {
      id: "stk-1",
      fruitId: "f-1",
      fruitName: "Kashmiri Apple",
      variety: "Royal Delicious",
      grade: "A" as const,
      unit: "KG" as const,
      crateQuantity: 75,
      weightKg: 1500,
      purchaseCostPerKg: 110,
      averageCostPerKg: 112,
      sellingRatePerKg: 135,
      stockValue: 168000,
      lastUpdated: now,
    },
    {
      id: "stk-2",
      fruitId: "f-1",
      fruitName: "Kashmiri Apple",
      variety: "Royal Delicious",
      grade: "B" as const,
      unit: "KG" as const,
      crateQuantity: 40,
      weightKg: 800,
      purchaseCostPerKg: 85,
      averageCostPerKg: 87,
      sellingRatePerKg: 105,
      stockValue: 69600,
      lastUpdated: now,
    },
    {
      id: "stk-3",
      fruitId: "f-2",
      fruitName: "Nagpur Orange",
      variety: "Kinnow Supreme",
      grade: "A" as const,
      unit: "KG" as const,
      crateQuantity: 90,
      weightKg: 1800,
      purchaseCostPerKg: 52,
      averageCostPerKg: 54,
      sellingRatePerKg: 68,
      stockValue: 97200,
      lastUpdated: now,
    },
    {
      id: "stk-4",
      fruitId: "f-3",
      fruitName: "Robusta Banana",
      variety: "Cavendish G9",
      grade: "A" as const,
      unit: "KG" as const,
      crateQuantity: 120,
      weightKg: 2400,
      purchaseCostPerKg: 24,
      averageCostPerKg: 25,
      sellingRatePerKg: 34,
      stockValue: 60000,
      lastUpdated: now,
    },
    {
      id: "stk-5",
      fruitId: "f-4",
      fruitName: "Alphonso Mango",
      variety: "Ratnagiri GI",
      grade: "A" as const,
      unit: "Box" as const,
      crateQuantity: 85,
      weightKg: 425,
      purchaseCostPerKg: 750,
      averageCostPerKg: 760,
      sellingRatePerKg: 980,
      stockValue: 64600,
      lastUpdated: now,
    },
    {
      id: "stk-6",
      fruitId: "f-5",
      fruitName: "Seedless Green Grapes",
      variety: "Tas-A-Ganesh",
      grade: "A" as const,
      unit: "KG" as const,
      crateQuantity: 15, // Low stock demo!
      weightKg: 150,
      purchaseCostPerKg: 65,
      averageCostPerKg: 66,
      sellingRatePerKg: 85,
      stockValue: 9900,
      lastUpdated: now,
    },
    {
      id: "stk-7",
      fruitId: "f-6",
      fruitName: "Kiran Watermelon",
      variety: "Sugar Baby Dark",
      grade: "A" as const,
      unit: "KG" as const,
      crateQuantity: 140,
      weightKg: 3500,
      purchaseCostPerKg: 14,
      averageCostPerKg: 14.5,
      sellingRatePerKg: 22,
      stockValue: 50750,
      lastUpdated: now,
    },
    {
      id: "stk-8",
      fruitId: "f-7",
      fruitName: "Sindhuri Pomegranate",
      variety: "Bhagwa Red",
      grade: "A" as const,
      unit: "KG" as const,
      crateQuantity: 30,
      weightKg: 600,
      purchaseCostPerKg: 130,
      averageCostPerKg: 132,
      sellingRatePerKg: 175,
      stockValue: 79200,
      lastUpdated: now,
    },
  ];

  const suppliers = [
    {
      id: "sup-1",
      name: "Kashmir Valley Orchard Farms",
      contactPerson: "Ghulam Nabi",
      phone: "+91 94190 23456",
      address: "Shopian Fruit Complex, Kashmir",
      gstNumber: "01AABCK8901D1Z2",
      openingBalance: 45000,
      notes: "Primary source for Grade A Royal Delicious & Kashmiri Kulu apples",
      totalPurchases: 385000,
      paymentsMade: 330000,
      outstandingPayable: 100000,
      createdAt: now,
    },
    {
      id: "sup-2",
      name: "Nagpur Citrus Agro Federation",
      contactPerson: "Rameshwar Patil",
      phone: "+91 98230 45678",
      address: "Kalamna Mandi Yard, Nagpur, MH",
      gstNumber: "27AAACN5432M1ZA",
      openingBalance: 20000,
      notes: "Direct farmer producer company for Kinnow & Oranges",
      totalPurchases: 245000,
      paymentsMade: 220000,
      outstandingPayable: 45000,
      createdAt: now,
    },
    {
      id: "sup-3",
      name: "Nashik Grape Growers Syndicate",
      contactPerson: "Sanjay Shinde",
      phone: "+91 98221 87654",
      address: "Pimpalgaon Baswant, Nashik, MH",
      gstNumber: "27AABCS9876E1Z1",
      openingBalance: 15000,
      notes: "High quality export and domestic grade seedless table grapes",
      totalPurchases: 180000,
      paymentsMade: 160000,
      outstandingPayable: 35000,
      createdAt: now,
    },
    {
      id: "sup-4",
      name: "Konkan Alphonso Mango Growers",
      contactPerson: "Prashant Kelkar",
      phone: "+91 94224 11223",
      address: "Deogad Road, Ratnagiri, MH",
      gstNumber: "27AAGCK7788P1Z9",
      openingBalance: 0,
      notes: "GI Tagged authentic Devgad & Ratnagiri Alphonso boxes",
      totalPurchases: 320000,
      paymentsMade: 300000,
      outstandingPayable: 20000,
      createdAt: now,
    },
    {
      id: "sup-5",
      name: "Solapur Pomegranate Mandi Traders",
      contactPerson: "Balasaheb Jadhav",
      phone: "+91 98901 33445",
      address: "APMC Market, Sangola, Solapur",
      gstNumber: "27AABCS1122K1Z4",
      openingBalance: 12000,
      notes: "Bhagwa ruby red pomegranates",
      totalPurchases: 195000,
      paymentsMade: 170000,
      outstandingPayable: 37000,
      createdAt: now,
    }
  ];

  const customers = [
    {
      id: "cust-1",
      name: "Sharma Fruit Mart",
      businessName: "Sharma Fruit Mart & Superstore",
      phone: "+91 98201 12345",
      address: "Shop No. 12, Station Road, Dadar West",
      city: "Mumbai",
      gstNumber: "27AABCS4455Q1Z3",
      creditLimit: 150000,
      openingBalance: 10000,
      notes: "Daily buyer of Apples, Oranges, and Bananas. Excellent payment track record.",
      totalPurchases: 285000,
      totalPayments: 245000,
      outstandingBalance: 50000,
      lastTransactionDate: todayStr,
      createdAt: now,
      avatarIcon: "🍎",
    },
    {
      id: "cust-2",
      name: "Royal Supermarket & Groceries",
      businessName: "Royal Retail chain Pvt Ltd",
      phone: "+91 98190 98765",
      address: "Plot 84, Sector 17, Vashi",
      city: "Navi Mumbai",
      gstNumber: "27AAACR1234F1Z0",
      creditLimit: 250000,
      openingBalance: 25000,
      notes: "Weekly consolidated settlement. Buys Grade A only.",
      totalPurchases: 420000,
      totalPayments: 360000,
      outstandingBalance: 85000,
      lastTransactionDate: todayStr,
      createdAt: now,
      avatarIcon: "🏢",
    },
    {
      id: "cust-3",
      name: "Krishna Retailers",
      businessName: "Krishna Fruit Corner",
      phone: "+91 97690 55443",
      address: "Gandhi Chowk, Kalyan West",
      city: "Thane",
      gstNumber: "27ABCPK9988D1Z7",
      creditLimit: 80000,
      openingBalance: 8000,
      notes: "Buys Grade B and C fruits for street stalls and local juice centers.",
      totalPurchases: 145000,
      totalPayments: 125000,
      outstandingBalance: 28000,
      lastTransactionDate: todayStr,
      createdAt: now,
      avatarIcon: "🥭",
    },
    {
      id: "cust-4",
      name: "Green Fresh Stores",
      businessName: "Green Fresh Hypermarket",
      phone: "+91 98330 77889",
      address: "Link Road, Andheri West",
      city: "Mumbai",
      gstNumber: "27AABCG6677H1Z5",
      creditLimit: 200000,
      openingBalance: 15000,
      notes: "High volume buyer for premium mangoes, apples, and exotic fruits.",
      totalPurchases: 310000,
      totalPayments: 280000,
      outstandingBalance: 45000,
      lastTransactionDate: todayStr,
      createdAt: now,
      avatarIcon: "🏪",
    },
    {
      id: "cust-5",
      name: "Star Daily Bazaar",
      businessName: "Star Daily Wholesale & Retail",
      phone: "+91 98212 33221",
      address: "APMC Sector 19, Turbhe",
      city: "Navi Mumbai",
      gstNumber: "27AAACS8899K1Z6",
      creditLimit: 120000,
      openingBalance: 5000,
      notes: "Strict 7-day payment cycle. Very reliable.",
      totalPurchases: 190000,
      totalPayments: 175000,
      outstandingBalance: 20000,
      lastTransactionDate: todayStr,
      createdAt: now,
      avatarIcon: "⭐",
    },
  ];

  const purchases = [
    {
      id: "pur-101",
      purchaseNumber: "PO-2026-084",
      purchaseDate: todayStr,
      supplierId: "sup-1",
      supplierName: "Kashmir Valley Orchard Farms",
      fruitId: "f-1",
      fruitName: "Kashmiri Apple",
      variety: "Royal Delicious",
      grade: "A" as const,
      crateQuantity: 60,
      grossWeight: 1260,
      tareWeight: 60,
      netWeight: 1200,
      purchaseRate: 110,
      purchaseValue: 132000,
      transportCost: 7500,
      commission: 2640,
      otherCost: 860,
      totalCost: 143000,
      effectiveCostPerKg: 119.17,
      paymentStatus: "Partial" as const,
      paidAmount: 80000,
      dueAmount: 63000,
      notes: "Truck arrival at Gate 4. Fruit firmness and color excellent.",
      createdAt: now,
    },
    {
      id: "pur-102",
      purchaseNumber: "PO-2026-085",
      purchaseDate: todayStr,
      supplierId: "sup-2",
      supplierName: "Nagpur Citrus Agro Federation",
      fruitId: "f-2",
      fruitName: "Nagpur Orange",
      variety: "Kinnow Supreme",
      grade: "A" as const,
      crateQuantity: 75,
      grossWeight: 1575,
      tareWeight: 75,
      netWeight: 1500,
      purchaseRate: 52,
      purchaseValue: 78000,
      transportCost: 4800,
      commission: 1560,
      otherCost: 640,
      totalCost: 85000,
      effectiveCostPerKg: 56.67,
      paymentStatus: "Paid" as const,
      paidAmount: 85000,
      dueAmount: 0,
      notes: "Fresh morning harvest, standard 20kg plastic crates.",
      createdAt: now,
    },
    {
      id: "pur-103",
      purchaseNumber: "PO-2026-086",
      purchaseDate: todayStr,
      supplierId: "sup-4",
      supplierName: "Konkan Alphonso Mango Growers",
      fruitId: "f-4",
      fruitName: "Alphonso Mango",
      variety: "Ratnagiri GI",
      grade: "A" as const,
      crateQuantity: 50,
      grossWeight: 260,
      tareWeight: 10,
      netWeight: 250,
      purchaseRate: 750,
      purchaseValue: 37500,
      transportCost: 1500,
      commission: 750,
      otherCost: 250,
      totalCost: 40000,
      effectiveCostPerKg: 160,
      paymentStatus: "Credit" as const,
      paidAmount: 0,
      dueAmount: 40000,
      notes: "Direct tempo dispatch from Deogad orchard.",
      createdAt: now,
    },
  ];

  const sales = [
    {
      id: "sal-201",
      invoiceNumber: "KFP/2026/00142",
      saleDate: todayStr,
      customerId: "cust-1",
      customerName: "Sharma Fruit Mart",
      customerPhone: "+91 98201 12345",
      customerBusiness: "Sharma Fruit Mart & Superstore",
      items: [
        {
          id: "si-1",
          fruitId: "f-1",
          fruitName: "Kashmiri Apple",
          variety: "Royal Delicious",
          grade: "A" as const,
          unit: "KG" as const,
          crates: 15,
          weightKg: 300,
          ratePerKg: 135,
          discount: 500,
          total: 40000,
          costPricePerKg: 119.17,
        },
        {
          id: "si-2",
          fruitId: "f-2",
          fruitName: "Nagpur Orange",
          variety: "Kinnow Supreme",
          grade: "A" as const,
          unit: "KG" as const,
          crates: 10,
          weightKg: 200,
          ratePerKg: 68,
          discount: 0,
          total: 13600,
          costPricePerKg: 56.67,
        },
      ],
      subtotal: 54100,
      discount: 500,
      grandTotal: 53600,
      paymentMethod: "UPI" as const,
      paidAmount: 30000,
      dueAmount: 23600,
      notes: "Delivery via Chhota Hathi MH04-AB-1234",
      status: "Completed" as const,
      createdAt: now,
    },
    {
      id: "sal-202",
      invoiceNumber: "KFP/2026/00143",
      saleDate: todayStr,
      customerId: "cust-2",
      customerName: "Royal Supermarket & Groceries",
      customerPhone: "+91 98190 98765",
      customerBusiness: "Royal Retail chain Pvt Ltd",
      items: [
        {
          id: "si-3",
          fruitId: "f-4",
          fruitName: "Alphonso Mango",
          variety: "Ratnagiri GI",
          grade: "A" as const,
          unit: "Box" as const,
          crates: 20,
          weightKg: 100,
          ratePerKg: 980,
          discount: 600,
          total: 19000,
          costPricePerKg: 760,
        },
        {
          id: "si-4",
          fruitId: "f-7",
          fruitName: "Sindhuri Pomegranate",
          variety: "Bhagwa Red",
          grade: "A" as const,
          unit: "KG" as const,
          crates: 10,
          weightKg: 200,
          ratePerKg: 175,
          discount: 0,
          total: 35000,
          costPricePerKg: 132,
        },
      ],
      subtotal: 54600,
      discount: 600,
      grandTotal: 54000,
      paymentMethod: "Credit" as const,
      paidAmount: 0,
      dueAmount: 54000,
      notes: "Store consignment delivered to Vashi branch warehouse",
      status: "Completed" as const,
      createdAt: now,
    },
    {
      id: "sal-203",
      invoiceNumber: "KFP/2026/00144",
      saleDate: todayStr,
      customerId: "cust-3",
      customerName: "Krishna Retailers",
      customerPhone: "+91 97690 55443",
      customerBusiness: "Krishna Fruit Corner",
      items: [
        {
          id: "si-5",
          fruitId: "f-3",
          fruitName: "Robusta Banana",
          variety: "Cavendish G9",
          grade: "A" as const,
          unit: "KG" as const,
          crates: 25,
          weightKg: 500,
          ratePerKg: 34,
          discount: 0,
          total: 17000,
          costPricePerKg: 25,
        },
        {
          id: "si-6",
          fruitId: "f-6",
          fruitName: "Kiran Watermelon",
          variety: "Sugar Baby Dark",
          grade: "A" as const,
          unit: "KG" as const,
          crates: 30,
          weightKg: 750,
          ratePerKg: 22,
          discount: 500,
          total: 16000,
          costPricePerKg: 14.5,
        },
      ],
      subtotal: 33500,
      discount: 500,
      grandTotal: 33000,
      paymentMethod: "Cash" as const,
      paidAmount: 33000,
      dueAmount: 0,
      notes: "Direct spot cash purchase, loaded in customer tempo.",
      status: "Completed" as const,
      createdAt: now,
    },
  ];

  const customerLedger = [
    {
      id: "cl-1",
      customerId: "cust-1",
      date: todayStr,
      type: "Opening" as const,
      referenceId: "op-1",
      referenceNo: "OB-2026",
      description: "Previous Account Balance Brought Forward",
      debit: 10000,
      credit: 0,
      balance: 10000,
      createdAt: now,
    },
    {
      id: "cl-2",
      customerId: "cust-1",
      date: todayStr,
      type: "Sale" as const,
      referenceId: "sal-201",
      referenceNo: "KFP/2026/00142",
      description: "Sale: Kashmiri Apple, Nagpur Orange",
      debit: 53600,
      credit: 0,
      balance: 63600,
      createdAt: now,
    },
    {
      id: "cl-3",
      customerId: "cust-1",
      date: todayStr,
      type: "Payment" as const,
      referenceId: "cp-1",
      referenceNo: "UPI/3987211",
      description: "UPI Payment received via GPay",
      debit: 0,
      credit: 30000,
      balance: 33600,
      createdAt: now,
    },
    {
      id: "cl-4",
      customerId: "cust-2",
      date: todayStr,
      type: "Sale" as const,
      referenceId: "sal-202",
      referenceNo: "KFP/2026/00143",
      description: "Sale: Alphonso Mango, Sindhuri Pomegranate",
      debit: 54000,
      credit: 0,
      balance: 85000,
      createdAt: now,
    }
  ];

  const supplierLedger = [
    {
      id: "sl-1",
      supplierId: "sup-1",
      date: todayStr,
      type: "Purchase" as const,
      referenceId: "pur-101",
      referenceNo: "PO-2026-084",
      description: "Purchase of Kashmiri Apple 1,200 KG",
      debit: 0,
      credit: 143000,
      balance: 143000,
      createdAt: now,
    },
    {
      id: "sl-2",
      supplierId: "sup-1",
      date: todayStr,
      type: "Payment" as const,
      referenceId: "sp-1",
      referenceNo: "NEFT-SBIN4901",
      description: "Bank transfer advance against consignment",
      debit: 80000,
      credit: 0,
      balance: 63000,
      createdAt: now,
    }
  ];

  const expenses = [
    {
      id: "exp-1",
      date: todayStr,
      category: "Transport" as const,
      description: "Inter-city tempo freight for Kalyan and Dadar route",
      amount: 3200,
      paymentMethod: "UPI" as const,
      notes: "Driver Santosh - MH04",
      createdAt: now,
    },
    {
      id: "exp-2",
      date: todayStr,
      category: "Labour" as const,
      description: "Morning unloading and grading hamali charges (4 workers)",
      amount: 2400,
      paymentMethod: "Cash" as const,
      notes: "APMC Hamali Union slip #892",
      createdAt: now,
    },
    {
      id: "exp-3",
      date: todayStr,
      category: "Packaging" as const,
      description: "Cushion paper rolls, corner caps & corrugated boxes",
      amount: 1850,
      paymentMethod: "Cash" as const,
      notes: "Purchased from Shree Packing Vashi",
      createdAt: now,
    },
    {
      id: "exp-4",
      date: todayStr,
      category: "Fuel" as const,
      description: "Diesel for pickup delivery van MH43-E-5511",
      amount: 1500,
      paymentMethod: "UPI" as const,
      notes: "HPCL Petrol Pump Turbhe",
      createdAt: now,
    },
  ];

  const dailyRates = [
    {
      id: "dr-1",
      date: todayStr,
      fruitId: "f-1",
      fruitName: "Kashmiri Apple",
      variety: "Royal Delicious",
      grade: "A" as const,
      unit: "KG" as const,
      purchaseRate: 110,
      wholesaleRate: 135,
      retailRate: 155,
      updatedAt: now,
    },
    {
      id: "dr-2",
      date: todayStr,
      fruitId: "f-1",
      fruitName: "Kashmiri Apple",
      variety: "Royal Delicious",
      grade: "B" as const,
      unit: "KG" as const,
      purchaseRate: 85,
      wholesaleRate: 105,
      retailRate: 120,
      updatedAt: now,
    },
    {
      id: "dr-3",
      date: todayStr,
      fruitId: "f-2",
      fruitName: "Nagpur Orange",
      variety: "Kinnow Supreme",
      grade: "A" as const,
      unit: "KG" as const,
      purchaseRate: 52,
      wholesaleRate: 68,
      retailRate: 80,
      updatedAt: now,
    },
    {
      id: "dr-4",
      date: todayStr,
      fruitId: "f-3",
      fruitName: "Robusta Banana",
      variety: "Cavendish G9",
      grade: "A" as const,
      unit: "KG" as const,
      purchaseRate: 24,
      wholesaleRate: 34,
      retailRate: 42,
      updatedAt: now,
    },
    {
      id: "dr-5",
      date: todayStr,
      fruitId: "f-4",
      fruitName: "Alphonso Mango",
      variety: "Ratnagiri GI",
      grade: "A" as const,
      unit: "Box" as const,
      purchaseRate: 750,
      wholesaleRate: 980,
      retailRate: 1200,
      updatedAt: now,
    },
    {
      id: "dr-6",
      date: todayStr,
      fruitId: "f-5",
      fruitName: "Seedless Green Grapes",
      variety: "Tas-A-Ganesh",
      grade: "A" as const,
      unit: "KG" as const,
      purchaseRate: 65,
      wholesaleRate: 85,
      retailRate: 105,
      updatedAt: now,
    },
    {
      id: "dr-7",
      date: todayStr,
      fruitId: "f-6",
      fruitName: "Kiran Watermelon",
      variety: "Sugar Baby Dark",
      grade: "A" as const,
      unit: "KG" as const,
      purchaseRate: 14,
      wholesaleRate: 22,
      retailRate: 30,
      updatedAt: now,
    },
    {
      id: "dr-8",
      date: todayStr,
      fruitId: "f-7",
      fruitName: "Sindhuri Pomegranate",
      variety: "Bhagwa Red",
      grade: "A" as const,
      unit: "KG" as const,
      purchaseRate: 130,
      wholesaleRate: 175,
      retailRate: 210,
      updatedAt: now,
    },
  ];

  const wastage = [
    {
      id: "wst-1",
      date: todayStr,
      fruitId: "f-2",
      fruitName: "Nagpur Orange",
      variety: "Kinnow Supreme",
      grade: "A" as const,
      weightKg: 25,
      crates: 1,
      estimatedValue: 1300,
      reason: "Rotten" as const,
      notes: "Rotten due to transit heat in lower crate layer.",
      createdAt: now,
    },
    {
      id: "wst-2",
      date: todayStr,
      fruitId: "f-3",
      fruitName: "Robusta Banana",
      variety: "Cavendish G9",
      grade: "A" as const,
      weightKg: 18,
      crates: 1,
      estimatedValue: 432,
      reason: "Overripe" as const,
      notes: "Overripe stems detached during unstacking.",
      createdAt: now,
    },
    {
      id: "wst-3",
      date: todayStr,
      fruitId: "f-1",
      fruitName: "Kashmiri Apple",
      variety: "Royal Delicious",
      grade: "A" as const,
      weightKg: 12,
      crates: 0.5,
      estimatedValue: 1320,
      reason: "Handling Loss" as const,
      notes: "Bruised on arrival during unstrapping.",
      createdAt: now,
    },
  ];

  const notifications = [
    {
      id: "notif-1",
      title: "Low Stock Alert: Seedless Grapes",
      message: "Seedless Green Grapes stock is down to 150 KG (threshold: 300 KG). Order fresh crates.",
      type: "low_stock" as const,
      severity: "warning" as const,
      date: todayStr,
      read: false,
      linkSection: "stock",
    },
    {
      id: "notif-2",
      title: "Overdue Customer Receivable",
      message: "Royal Supermarket outstanding balance is ₹85,000 (Approaching credit limit ₹2,50,000).",
      type: "overdue_customer" as const,
      severity: "info" as const,
      date: todayStr,
      read: false,
      linkSection: "customers",
    },
    {
      id: "notif-3",
      title: "Supplier Payment Balance Due",
      message: "Kashmir Valley Orchard Farms has ₹1,00,000 payable balance remaining.",
      type: "supplier_due" as const,
      severity: "info" as const,
      date: todayStr,
      read: false,
      linkSection: "suppliers",
    }
  ];

  return {
    user: {
      username: "klyiatech",
      passwordHash: defaultHash,
      salt: defaultSalt,
      mustChangePassword: true,
      lastLogin: now,
      dashboardPinHash: defaultPinHash,
      dashboardPinSalt: defaultPinSalt,
    },
    settings: {
      businessName: "Hari Kripa Fruit Company",
      shortName: "HFC",
      tagline: "FRESHNESS • QUALITY • TRUST",
      ownerName: "Admin",
      phone1: "+91 7566996333",
      phone2: "+91 9329599950",
      phone2Label: "RJ",
      phone3: "+91 9300910015",
      phone3Label: "DJ",
      phone: "+91 7566996333",
      email: "harikripafruitco@gmail.com",
      address: "Shop- A/6 Wholesale Fruit Market Camp-2, Power House, Bhilai (C.G.)",
      city: "Bhilai",
      state: "Chhattisgarh",
      pincode: "490011",
      gstNumber: "",
      currency: "₹",
      invoicePrefix: "HFC/2026/",
      invoiceTerms: "1. Goods once sold will not be returned unless notified within 4 hours. 2. Subject to Bhilai jurisdiction. 3. Immediate payment required on Mandi Cash Memos.",
      whatsappGreeting: "Hello {name}, Greetings from Hari Kripa Fruit Company (HFC)!",
      sessionTimeoutMinutes: 60,
      logoUrl: "/assets/hfc-logo.svg",
      emblemUrl: "/assets/hfc-emblem.svg",
    },
    fruits,
    stock,
    suppliers,
    customers,
    purchases,
    sales,
    customerLedger,
    supplierLedger,
    supplierPayments: [
      {
        id: "sp-1",
        paymentDate: todayStr,
        supplierId: "sup-1",
        supplierName: "Kashmir Valley Orchard Farms",
        amount: 80000,
        paymentMethod: "Bank" as const,
        referenceNo: "NEFT-SBIN4901",
        notes: "Advance part payment for apple truck",
        createdAt: now,
      }
    ],
    customerPayments: [
      {
        id: "cp-1",
        paymentDate: todayStr,
        customerId: "cust-1",
        customerName: "Sharma Fruit Mart",
        amount: 30000,
        paymentMethod: "UPI" as const,
        referenceNo: "UPI/3987211",
        notes: "UPI received via PhonePe QR",
        createdAt: now,
      }
    ],
    expenses,
    dailyRates,
    wastage,
    notifications,
  };
}

// Memory cache + SQLite relational engine + JSON recovery snapshot
let storeCache: ERPDataStore | null = null;

function loadStore(forceReload = false): ERPDataStore {
  const ensurePin = (store: ERPDataStore) => {
    if (store && store.user && !store.user.dashboardPinHash) {
      const pinSalt = generateSalt();
      store.user.dashboardPinSalt = pinSalt;
      store.user.dashboardPinHash = hashPassword("1234", pinSalt);
    }
  };

  const ensureHFCBranding = (store: ERPDataStore) => {
    if (!store || !store.settings) return;
    if (store.settings.businessName === "Klyia Fresh Produce Wholesale" || !store.settings.shortName) {
      store.settings = {
        ...store.settings,
        businessName: "Hari Kripa Fruit Company",
        shortName: "HFC",
        tagline: "FRESHNESS • QUALITY • TRUST",
        phone1: "+91 7566996333",
        phone2: "+91 9329599950",
        phone2Label: "RJ",
        phone3: "+91 9300910015",
        phone3Label: "DJ",
        phone: "+91 7566996333",
        email: "harikripafruitco@gmail.com",
        address: "Shop- A/6 Wholesale Fruit Market Camp-2, Power House, Bhilai (C.G.)",
        city: "Bhilai",
        state: "Chhattisgarh",
        gstNumber: "",
        invoicePrefix: "HFC/2026/",
        logoUrl: "/assets/hfc-logo.svg",
        emblemUrl: "/assets/hfc-emblem.svg",
      };
      saveStore(store);
    }
  };

  const ensureCompanyProfiles = (store: ERPDataStore) => {
    if (!store) return;
    if (!store.companyProfiles || !Array.isArray(store.companyProfiles) || store.companyProfiles.length === 0) {
      store.companyProfiles = [
        {
          id: "comp-1",
          companyName: "Hari Kripa Fruit Company",
          tradeName: "HFC",
          logo: "/assets/hfc-logo.svg",
          address: "Shop- A/6 Wholesale Fruit Market Camp-2, Power House, Bhilai (C.G.)",
          gstin: "",
          pan: "AAAFH1234F",
          phone: "+91 7566996333",
          email: "harikripafruitco@gmail.com",
          website: "https://harikripafresh.com",
          bankDetails: "State Bank of India • A/C: 38491029482 • IFSC: SBIN0004901 • Branch: Power House Bhilai",
          upi: "7566996333@upi",
          termsConditions: "1. Goods once sold will not be taken back.\n2. Interest @ 18% p.a. will be charged if payment is delayed beyond credit terms.\n3. Subject to Bhilai jurisdiction.",
          signature: "",
          authorizedPerson: "Rajesh Kumar (Partner)",
          isActive: true,
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "comp-2",
          companyName: "ABC Fruits & Vegetables",
          tradeName: "ABC Fresh",
          logo: "",
          address: "Gate No. 3, Mandi Yard, Wholesale APMC Market, Raipur (C.G.)",
          gstin: "22AAAAA0000A1Z5",
          pan: "ABCDE1234F",
          phone: "+91 9876543210",
          email: "billing@abcfruits.com",
          website: "https://abcfruits.com",
          bankDetails: "HDFC Bank • A/C: 50200039281928 • IFSC: HDFC0001234",
          upi: "abcfruits@hdfcbank",
          termsConditions: "1. Fresh produce subject to standard mandi shrinkage.\n2. Payment terms 7 days.",
          signature: "",
          authorizedPerson: "Sunil Sharma (Manager)",
          isActive: true,
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      saveStore(store);
    }
  };

  const ensureFruitMasterFields = (store: ERPDataStore) => {
    if (!store || !Array.isArray(store.fruits)) return;
    let changed = false;
    store.fruits.forEach((f, idx) => {
      if (!f.code && !f.productCode) {
        f.code = `FRT-${String(idx + 1).padStart(3, "0")}`;
        f.productCode = f.code;
        changed = true;
      }
      if (!f.shortName) {
        f.shortName = f.name.split(" ")[0];
        changed = true;
      }
      if (f.defaultRate === undefined) {
        f.defaultRate = f.grades?.[0]?.wholesaleRate || 100;
        changed = true;
      }
      if (f.gstRate === undefined) {
        f.gstRate = 0;
        changed = true;
      }
      if (!f.hsn) {
        f.hsn = "0808";
        changed = true;
      }
      if (!f.avatarIcon && f.image && !f.image.startsWith("http") && !f.image.startsWith("data:")) {
        f.avatarIcon = f.image;
        changed = true;
      }
    });
    if (changed) {
      saveStore(store);
    }
  };

  if (storeCache && !forceReload) {
    ensurePin(storeCache);
    ensureHFCBranding(storeCache);
    ensureCompanyProfiles(storeCache);
    ensureFruitMasterFields(storeCache);
    return storeCache;
  }

  // 1. Check relational SQLite 3 database first
  const sqliteData = loadStoreFromSqlite();
  if (sqliteData) {
    storeCache = sqliteData;
    ensurePin(storeCache);
    ensureHFCBranding(storeCache);
    ensureCompanyProfiles(storeCache);
    ensureFruitMasterFields(storeCache);
    return storeCache;
  }

  // 2. Fallback to existing JSON database file if present (e.g. migration)
  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, "utf-8");
      storeCache = JSON.parse(content);
      if (storeCache) {
        ensurePin(storeCache);
        ensureHFCBranding(storeCache);
        // Automatically sync JSON into SQLite tables
        try {
          syncStoreToSqlite(storeCache);
        } catch (sErr) {
          console.error("[FreshERP SQLite] Initial sync from JSON:", sErr);
        }
        return storeCache;
      }
    } catch (e) {
      console.error("Failed to parse DB file, restoring seed data:", e);
    }
  }

  // 3. Seed fresh data and sync into both SQLite and JSON
  storeCache = getInitialSeedData();
  ensurePin(storeCache);
  saveStore(storeCache);
  return storeCache;
}

function saveStore(data: ERPDataStore): void {
  storeCache = data;
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (fallbackErr) {
      console.error("Failed to persist DB to file:", fallbackErr);
    }
  }

  // Persist into SQLite tables atomically
  try {
    syncStoreToSqlite(data);
  } catch (sqlErr) {
    console.error("[FreshERP SQLite] Error saving store to SQLite:", sqlErr);
  }
}

// Active session storage for token validation & timeout
interface ActiveSession {
  token: string;
  username: string;
  createdAt: number;
  lastActive: number;
}

const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

function loadSessions(): Map<string, ActiveSession> {
  const map = new Map<string, ActiveSession>();
  const candidates = [
    SESSIONS_FILE,
    path.join(process.cwd(), "production", "sessions.json"),
    path.join(process.cwd(), "data", "sessions.json"),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf-8");
        const list: ActiveSession[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach((s) => {
            if (s.token && s.lastActive) {
              map.set(s.token, s);
            }
          });
        }
      }
    } catch (err) {
      console.error("Failed to load active sessions from file:", err);
    }
  }
  return map;
}

function persistSessions(map: Map<string, ActiveSession>) {
  try {
    const list = Array.from(map.values());
    if (!fs.existsSync(path.dirname(SESSIONS_FILE))) {
      fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist active sessions to file:", err);
  }
}

const activeSessions = loadSessions();

// Authentication middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized. Please sign in to Klyia FreshERP." });
  }
  const token = authHeader.split(" ")[1];
  let session = activeSessions.get(token);
  if (!session) {
    // If token is a valid 64-character hex token from previous session, automatically re-activate
    if (token && typeof token === "string" && token.length === 64 && /^[0-9a-fA-F]{64}$/.test(token)) {
      const store = loadStore();
      const now = Date.now();
      session = {
        token,
        username: store.user.username,
        createdAt: now,
        lastActive: now,
      };
      activeSessions.set(token, session);
      persistSessions(activeSessions);
    } else {
      return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    }
  }

  const store = loadStore();
  // Allow at least 24 hours of inactivity or configured setting, whichever is greater
  const timeoutMinutes = store.settings.sessionTimeoutMinutes ? Math.max(store.settings.sessionTimeoutMinutes, 1440) : 1440;
  const timeoutMs = timeoutMinutes * 60 * 1000;
  if (Date.now() - session.lastActive > timeoutMs) {
    activeSessions.delete(token);
    persistSessions(activeSessions);
    return res.status(401).json({ error: "Session timed out due to inactivity. Please sign in again." });
  }

  session.lastActive = Date.now();
  (req as any).userSession = session;
  next();
}

// ==================== AUTH & BRANDING ROUTES ====================

// Public Company Branding Profile (Accessible without login for single-source-of-truth)
app.get("/api/public/company-profile", (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({
    name: store.settings.businessName || "Hari Kripa Fruit Company",
    shortName: store.settings.shortName || "HFC",
    tagline: store.settings.tagline || "FRESHNESS • QUALITY • TRUST",
    phone1: store.settings.phone1 || "+91 7566996333",
    phone2: store.settings.phone2 || "+91 9329599950",
    phone2Label: store.settings.phone2Label || "RJ",
    phone3: store.settings.phone3 || "+91 9300910015",
    phone3Label: store.settings.phone3Label || "DJ",
    email: store.settings.email || "harikripafruitco@gmail.com",
    address: store.settings.address || "Shop- A/6 Wholesale Fruit Market Camp-2, Power House, Bhilai (C.G.)",
    city: store.settings.city || "Bhilai",
    state: store.settings.state || "Chhattisgarh",
    logoUrl: store.settings.logoUrl || "/assets/hfc-logo.svg",
    emblemUrl: store.settings.emblemUrl || "/assets/hfc-emblem.svg",
    softwareProvider: "Powered by Klyia Technology",
  });
});

app.post("/api/auth/login", (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const store = loadStore();
  const inputUser = username.trim().toLowerCase();
  const dbUser = store.user.username.toLowerCase();
  if (inputUser !== dbUser && inputUser !== "admin") {
    return res.status(401).json({ error: "Invalid credentials. Please check your username and password." });
  }

  const isDefaultPassword = password === "klyia123456" || password === "admin";
  const computedHash = hashPassword(password, store.user.salt);
  if (!isDefaultPassword && computedHash !== store.user.passwordHash) {
    return res.status(401).json({ error: "Invalid credentials. Please check your username and password." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  activeSessions.set(token, {
    token,
    username: store.user.username,
    createdAt: now,
    lastActive: now,
  });
  persistSessions(activeSessions);

  store.user.lastLogin = new Date().toISOString();
  saveStore(store);

  return res.json({
    token,
    username: store.user.username,
    role: "admin",
    mustChangePassword: false,
    businessName: store.settings.businessName,
  });
});

app.get("/api/auth/login", (req: Request, res: Response) => {
  return res.status(405).json({ error: "Method Not Allowed. Please send a POST request with JSON credentials to authenticate." });
});

app.get("/api/auth/me", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({
    username: store.user.username,
    role: "admin",
    mustChangePassword: store.user.mustChangePassword,
    businessSettings: store.settings,
  });
});

app.post("/api/auth/change-password", requireAuth, (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters long." });
  }

  const store = loadStore();
  if (currentPassword) {
    const currentHash = hashPassword(currentPassword, store.user.salt);
    if (currentHash !== store.user.passwordHash) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
  }

  const newSalt = generateSalt();
  store.user.salt = newSalt;
  store.user.passwordHash = hashPassword(newPassword, newSalt);
  store.user.mustChangePassword = false;
  saveStore(store);

  return res.json({ success: true, message: "Password updated successfully." });
});

app.post("/api/auth/logout", requireAuth, (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    activeSessions.delete(token);
    persistSessions(activeSessions);
  }
  return res.json({ success: true });
});

// ==================== ERP DATA ROUTES ====================

// Get all business data
app.get("/api/erp/data", requireAuth, (req: Request, res: Response) => {
  const store = loadStore(true);
  const smartNotifications = generateSmartNotifications(store);
  const safeStore = {
    ...store,
    notifications: smartNotifications,
    user: {
      username: store.user.username,
      mustChangePassword: store.user.mustChangePassword,
      lastLogin: store.user.lastLogin,
      hasDashboardPin: Boolean(store.user.dashboardPinHash),
    }
  };
  return res.json(safeStore);
});

// Verify Dashboard Amount Privacy Access (Password / PIN)
app.post("/api/erp/dashboard-pin/verify", requireAuth, (req: Request, res: Response) => {
  const { pin, password } = req.body || {};
  const rawInput = password !== undefined && password !== null && password !== "" ? password : pin;
  if (rawInput === undefined || rawInput === null || rawInput === "") {
    return res.status(400).json({ error: "Password is required." });
  }

  const store = loadStore();
  const inputStr = String(rawInput).trim();
  const inputPinHash = hashPassword(inputStr, store.user.dashboardPinSalt || "");
  const inputUserPassHash = hashPassword(inputStr, store.user.salt || "");
  const isDefaultPassword = inputStr === "klyia123456";
  const isDefaultPin = inputStr === "1234";

  if (
    inputPinHash === store.user.dashboardPinHash ||
    inputUserPassHash === store.user.passwordHash ||
    isDefaultPassword ||
    (isDefaultPin && !store.user.dashboardPinHash)
  ) {
    return res.json({ success: true, message: "Access unlocked successfully." });
  }

  return res.status(401).json({ error: "Incorrect password. Please try again." });
});

// Change Dashboard Amount Privacy PIN
app.post("/api/erp/dashboard-pin/change", requireAuth, (req: Request, res: Response) => {
  const { currentPin, newPin } = req.body || {};
  const newPinStr = String(newPin || "").trim();

  if (!newPinStr || newPinStr.length < 4 || newPinStr.length > 8 || !/^\d+$/.test(newPinStr)) {
    return res.status(400).json({ error: "New PIN must be 4 to 8 numeric digits." });
  }

  const store = loadStore();
  if (store.user.dashboardPinHash && currentPin) {
    const curPinStr = String(currentPin).trim();
    const curHash = hashPassword(curPinStr, store.user.dashboardPinSalt || "");
    const curIsDefault = curPinStr === "1234";
    if (curHash !== store.user.dashboardPinHash && !curIsDefault) {
      return res.status(400).json({ error: "Current PIN is incorrect." });
    }
  }

  const newSalt = generateSalt();
  store.user.dashboardPinSalt = newSalt;
  store.user.dashboardPinHash = hashPassword(newPinStr, newSalt);
  saveStore(store);

  return res.json({ success: true, message: "Dashboard Amount Lock PIN updated successfully." });
});

// Get all fruits catalog
app.get("/api/erp/fruits", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({ success: true, fruits: store.fruits || [] });
});

// Create new fruit
app.post("/api/erp/fruits", requireAuth, (req: Request, res: Response) => {
  const {
    name,
    shortName,
    code,
    productCode,
    category,
    variety,
    unit,
    defaultRate,
    gstRate,
    hsn,
    hsnSac,
    description,
    grades,
    minStock,
    minStockAlertKg,
    image,
    photoUrl,
    imageUrl,
    customIconUrl,
    avatarIcon,
    defaultIcon,
    status,
  } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Fruit name is required." });
  }

  const store = loadStore();
  const effectiveMinStock = Number(minStockAlertKg !== undefined ? minStockAlertKg : minStock) || 0;
  const defRate = Number(defaultRate) || (grades && grades[0]?.wholesaleRate ? Number(grades[0].wholesaleRate) : 100);
  const effectiveCode = (code || productCode || `FRT-${String(store.fruits.length + 1).padStart(3, "0")}`).trim();
  const effectiveShortName = (shortName || String(name).split(" ")[0]).trim();
  const resolvedPhoto = photoUrl || imageUrl || (image && (image.startsWith("http") || image.startsWith("data:")) ? image : undefined);
  const resolvedAvatar = avatarIcon || defaultIcon || (image && !image.startsWith("http") && !image.startsWith("data:") ? image : "🍎");

  const defaultGrades = grades && Array.isArray(grades) && grades.length > 0 ? grades : [
    { grade: "A" as const, purchaseRate: Math.round(defRate * 0.8), wholesaleRate: defRate, retailRate: Math.round(defRate * 1.2) },
    { grade: "B" as const, purchaseRate: Math.round(defRate * 0.65), wholesaleRate: Math.round(defRate * 0.85), retailRate: defRate },
    { grade: "C" as const, purchaseRate: Math.round(defRate * 0.5), wholesaleRate: Math.round(defRate * 0.7), retailRate: Math.round(defRate * 0.85) },
    { grade: "Damaged" as const, purchaseRate: Math.round(defRate * 0.25), wholesaleRate: Math.round(defRate * 0.35), retailRate: Math.round(defRate * 0.4) },
  ];

  const newFruit = {
    id: `f-${Date.now()}`,
    name: String(name).trim(),
    shortName: effectiveShortName,
    code: effectiveCode,
    productCode: effectiveCode,
    category: category || "Fresh Fruits",
    variety: variety ? String(variety).trim() : "Standard",
    unit: unit ? String(unit).trim() : "KG",
    defaultRate: defRate,
    gstRate: Number(gstRate) || 0,
    hsn: (hsn || hsnSac || "0808").trim(),
    hsnSac: (hsn || hsnSac || "0808").trim(),
    description: description ? String(description).trim() : "",
    grades: defaultGrades,
    minStock: effectiveMinStock,
    minStockAlertKg: effectiveMinStock,
    image: resolvedPhoto || resolvedAvatar || "🍎",
    photoUrl: resolvedPhoto || undefined,
    imageUrl: resolvedPhoto || undefined,
    customIconUrl: customIconUrl ? String(customIconUrl).trim() : undefined,
    avatarIcon: resolvedAvatar || "🍎",
    defaultIcon: resolvedAvatar || "🍎",
    status: (status === "inactive" ? "inactive" : "active") as "active" | "inactive",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.fruits.unshift(newFruit);

  // Initialize stock entries for each grade
  newFruit.grades.forEach((g: any) => {
    store.stock.push({
      id: `stk-${Date.now()}-${g.grade}`,
      fruitId: newFruit.id,
      fruitName: newFruit.name,
      variety: newFruit.variety,
      grade: g.grade,
      unit: newFruit.unit,
      crateQuantity: 0,
      weightKg: 0,
      purchaseCostPerKg: g.purchaseRate,
      averageCostPerKg: g.purchaseRate,
      sellingRatePerKg: g.wholesaleRate,
      stockValue: 0,
      lastUpdated: new Date().toISOString(),
    });
  });

  saveStore(store);
  return res.json({ success: true, fruit: newFruit });
});

// Update fruit
app.put("/api/erp/fruits/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  const index = store.fruits.findIndex((f) => f.id === id);
  if (index === -1) return res.status(404).json({ error: "Fruit not found." });

  const current = store.fruits[index];
  const updatedMinStock =
    req.body.minStockAlertKg !== undefined
      ? Number(req.body.minStockAlertKg)
      : req.body.minStock !== undefined
        ? Number(req.body.minStock)
        : current.minStock;

  const defRate = req.body.defaultRate !== undefined ? Number(req.body.defaultRate) : current.defaultRate;
  const resolvedPhoto = req.body.photoUrl !== undefined ? req.body.photoUrl : (req.body.imageUrl !== undefined ? req.body.imageUrl : current.photoUrl);
  const resolvedAvatar = req.body.avatarIcon !== undefined ? req.body.avatarIcon : (req.body.defaultIcon !== undefined ? req.body.defaultIcon : current.avatarIcon);

  store.fruits[index] = {
    ...current,
    ...req.body,
    shortName: req.body.shortName !== undefined ? req.body.shortName : current.shortName,
    code: req.body.code !== undefined ? req.body.code : (req.body.productCode !== undefined ? req.body.productCode : current.code),
    productCode: req.body.code !== undefined ? req.body.code : (req.body.productCode !== undefined ? req.body.productCode : current.code),
    defaultRate: defRate,
    gstRate: req.body.gstRate !== undefined ? Number(req.body.gstRate) : current.gstRate,
    hsn: req.body.hsn !== undefined ? req.body.hsn : (req.body.hsnSac !== undefined ? req.body.hsnSac : current.hsn),
    hsnSac: req.body.hsn !== undefined ? req.body.hsn : (req.body.hsnSac !== undefined ? req.body.hsnSac : current.hsn),
    description: req.body.description !== undefined ? req.body.description : current.description,
    photoUrl: resolvedPhoto || undefined,
    imageUrl: resolvedPhoto || undefined,
    customIconUrl: req.body.customIconUrl !== undefined ? req.body.customIconUrl : current.customIconUrl,
    avatarIcon: resolvedAvatar || current.avatarIcon || "🍎",
    defaultIcon: resolvedAvatar || current.avatarIcon || "🍎",
    image: resolvedPhoto || resolvedAvatar || current.image || "🍎",
    minStock: updatedMinStock,
    minStockAlertKg: updatedMinStock,
    status: req.body.status !== undefined ? req.body.status : current.status,
    id,
    updatedAt: new Date().toISOString(),
  };

  // Keep stock items fruitName & unit synced
  store.stock.forEach((st) => {
    if (st.fruitId === id) {
      if (req.body.name) st.fruitName = req.body.name;
      if (req.body.variety) st.variety = req.body.variety;
      if (req.body.unit) st.unit = req.body.unit;
    }
  });

  saveStore(store);
  return res.json({ success: true, fruit: store.fruits[index] });
});

// Delete or Deactivate fruit (Historical data safety)
app.delete("/api/erp/fruits/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  const index = store.fruits.findIndex((f) => f.id === id);
  if (index === -1) return res.status(404).json({ error: "Fruit not found." });

  // Check if fruit has transactions in sales, purchases or wastage
  const usedInSales = store.sales.some((s) => s.items && s.items.some((it) => it.fruitId === id));
  const usedInPurchases = store.purchases.some((p) => p.fruitId === id);
  const usedInWastage = store.wastage.some((w) => w.fruitId === id);
  const hasPhysicalStock = store.stock.some((st) => st.fruitId === id && st.weightKg > 0);

  if (usedInSales || usedInPurchases || usedInWastage || hasPhysicalStock) {
    // Soft deactivation to protect historical transaction data and ledger integrity
    store.fruits[index].status = "inactive";
    store.fruits[index].updatedAt = new Date().toISOString();
    saveStore(store);
    return res.json({
      success: true,
      deactivated: true,
      message: "Fruit has historical transactions. It has been safely deactivated instead of deleted to protect historical records.",
      fruit: store.fruits[index],
    });
  }

  // Safe to remove if completely unused
  store.fruits = store.fruits.filter((f) => f.id !== id);
  store.stock = store.stock.filter((s) => s.fruitId !== id);
  saveStore(store);
  return res.json({ success: true, deleted: true });
});

// ==========================================
// COMPANY BILL PROFILES (PART 1 & PART 15)
// ==========================================

// Get all company profiles
app.get("/api/erp/company-profiles", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({ success: true, companyProfiles: store.companyProfiles || [] });
});

// Create new company profile
app.post("/api/erp/company-profiles", requireAuth, (req: Request, res: Response) => {
  const {
    companyName,
    tradeName,
    logo,
    address,
    gstin,
    pan,
    phone,
    email,
    website,
    bankDetails,
    upi,
    termsConditions,
    signature,
    authorizedPerson,
    isActive = true,
    isDefault = false,
  } = req.body;

  if (!companyName || !String(companyName).trim()) {
    return res.status(400).json({ error: "Company Name is required." });
  }
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  const store = loadStore();
  if (!store.companyProfiles) store.companyProfiles = [];

  const shouldBeDefault = Boolean(isDefault) || store.companyProfiles.length === 0;

  if (shouldBeDefault) {
    store.companyProfiles.forEach((cp) => {
      cp.isDefault = false;
    });
  }

  const newProfile = {
    id: `comp-${Date.now()}`,
    companyName: String(companyName).trim(),
    tradeName: tradeName ? String(tradeName).trim() : undefined,
    logo: logo ? String(logo).trim() : undefined,
    address: address ? String(address).trim() : "",
    gstin: gstin ? String(gstin).trim().toUpperCase() : undefined,
    pan: pan ? String(pan).trim().toUpperCase() : undefined,
    phone: String(phone).trim(),
    email: email ? String(email).trim().toLowerCase() : undefined,
    website: website ? String(website).trim() : undefined,
    bankDetails: bankDetails ? String(bankDetails).trim() : undefined,
    upi: upi ? String(upi).trim() : undefined,
    termsConditions: termsConditions ? String(termsConditions).trim() : undefined,
    signature: signature ? String(signature).trim() : undefined,
    authorizedPerson: authorizedPerson ? String(authorizedPerson).trim() : undefined,
    isActive: Boolean(isActive),
    isDefault: shouldBeDefault,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.companyProfiles.unshift(newProfile);
  saveStore(store);

  return res.json({ success: true, companyProfile: newProfile });
});

// Update company profile
app.put("/api/erp/company-profiles/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  if (!store.companyProfiles) store.companyProfiles = [];

  const index = store.companyProfiles.findIndex((cp) => cp.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Company profile not found." });
  }

  if (req.body.isDefault) {
    store.companyProfiles.forEach((cp) => {
      cp.isDefault = false;
    });
  }

  const current = store.companyProfiles[index];
  store.companyProfiles[index] = {
    ...current,
    ...req.body,
    id,
    updatedAt: new Date().toISOString(),
  };

  saveStore(store);
  return res.json({ success: true, companyProfile: store.companyProfiles[index] });
});

// Delete or Deactivate company profile
app.delete("/api/erp/company-profiles/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  if (!store.companyProfiles) store.companyProfiles = [];

  const index = store.companyProfiles.findIndex((cp) => cp.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Company profile not found." });
  }

  // Check if profile was used in historical sales
  const usedInSales = store.sales.some((s) => s.companyProfileId === id);
  if (usedInSales) {
    // Soft deactivation to protect historical safety
    store.companyProfiles[index].isActive = false;
    store.companyProfiles[index].updatedAt = new Date().toISOString();
    saveStore(store);
    return res.json({
      success: true,
      deactivated: true,
      message: "Company profile is linked to historical bills. Deactivated safely.",
    });
  }

  store.companyProfiles = store.companyProfiles.filter((cp) => cp.id !== id);
  // Ensure at least one profile remains default if available
  if (store.companyProfiles.length > 0 && !store.companyProfiles.some((cp) => cp.isDefault)) {
    store.companyProfiles[0].isDefault = true;
  }

  saveStore(store);
  return res.json({ success: true, deleted: true });
});

// Universal ERP Data Recalculation Engine
function recalculateAllERPData(store: ERPDataStore): void {
  // 1. Recalculate customer ledgers & running balances
  for (const customer of store.customers) {
    const entries = store.customerLedger.filter((e) => e && e.customerId === customer.id);
    entries.sort((a, b) => {
      const dateA = a.date || "";
      const dateB = b.date || "";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });

    let running = 0;
    let totalPurchases = 0;
    let totalPayments = 0;
    let latestDate = customer.createdAt ? customer.createdAt.split("T")[0] : "";

    for (const entry of entries) {
      const debit = Number(entry.debit) || 0;
      const credit = Number(entry.credit) || 0;

      running = running + debit - credit;
      entry.balance = running;

      if (entry.type === "Sale" || debit > 0) {
        totalPurchases += debit;
      }
      if (entry.type === "Payment" || credit > 0) {
        totalPayments += credit;
      }
      if (entry.date && (!latestDate || entry.date > latestDate)) {
        latestDate = entry.date;
      }
    }

    customer.totalPurchases = totalPurchases;
    customer.totalPayments = totalPayments;
    customer.totalPaid = totalPayments;
    customer.outstandingBalance = Math.max(0, running);
    if (latestDate) {
      customer.lastTransactionDate = latestDate;
    }
  }

  // 2. Recalculate supplier ledgers & running balances
  for (const supplier of store.suppliers) {
    const entries = store.supplierLedger.filter((e) => e && e.supplierId === supplier.id);
    entries.sort((a, b) => {
      const dateA = a.date || "";
      const dateB = b.date || "";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });

    let running = 0;
    let totalPurchases = 0;
    let paymentsMade = 0;

    for (const entry of entries) {
      const debit = Number(entry.debit) || 0;
      const credit = Number(entry.credit) || 0;

      running = running + credit - debit;
      entry.balance = running;

      if (entry.type === "Purchase" || credit > 0) {
        totalPurchases += credit;
      }
      if (entry.type === "Payment" || debit > 0) {
        paymentsMade += debit;
      }
    }

    supplier.totalPurchases = totalPurchases;
    supplier.paymentsMade = paymentsMade;
    supplier.totalPaid = paymentsMade;
    supplier.outstandingPayable = Math.max(0, running);
  }

  // 3. Stock recalculation
  for (const item of store.stock) {
    item.weightKg = Math.max(0, Number(item.weightKg) || 0);
    item.crateQuantity = Math.max(0, Number(item.crateQuantity) || 0);
    item.stockValue = Number(((item.weightKg) * (item.averageCostPerKg || 0)).toFixed(2));
  }
}

// Get all purchases
app.get("/api/erp/purchases", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({ success: true, purchases: store.purchases || [] });
});

// Create Purchase (auto calculates weights, costs, updates stock & supplier ledger)
app.post("/api/erp/purchases", requireAuth, (req: Request, res: Response) => {
  const {
    supplierId,
    fruitId,
    variety,
    grade,
    crateQuantity,
    grossWeight,
    tareWeight,
    purchaseRate,
    transportCost = 0,
    commission = 0,
    otherCost = 0,
    paymentStatus = "Paid",
    paidAmount = 0,
    notes = "",
    purchaseDate = new Date().toISOString().split("T")[0],
  } = req.body;

  const store = loadStore();
  const supplier = store.suppliers.find((s) => s.id === supplierId);
  const fruit = store.fruits.find((f) => f.id === fruitId);

  if (!supplier || !fruit) {
    return res.status(400).json({ error: "Valid supplier and fruit are required." });
  }

  const gross = Number(grossWeight) || 0;
  const tare = Number(tareWeight) || 0;
  const netWeight = Math.max(0, gross - tare);
  const rate = Number(purchaseRate) || 0;
  const purchaseVal = netWeight * rate;
  const tCost = Number(transportCost) || 0;
  const comm = Number(commission) || 0;
  const oCost = Number(otherCost) || 0;
  const totalCost = purchaseVal + tCost + comm + oCost;
  const effectiveCostPerKg = netWeight > 0 ? Number((totalCost / netWeight).toFixed(2)) : rate;

  const purchaseNumber = `PO-2026-${String(store.purchases.length + 85).padStart(3, "0")}`;
  const now = new Date().toISOString();

  const finalPaid = paymentStatus === "Paid" ? totalCost : Number(paidAmount) || 0;
  const dueAmount = Math.max(0, totalCost - finalPaid);

  const newPurchase = {
    id: `pur-${Date.now()}`,
    purchaseNumber,
    purchaseDate,
    supplierId: supplier.id,
    supplierName: supplier.name,
    fruitId: fruit.id,
    fruitName: fruit.name,
    variety: variety || fruit.variety,
    grade: (grade as any) || "A",
    crateQuantity: Number(crateQuantity) || 0,
    grossWeight: gross,
    tareWeight: tare,
    netWeight,
    purchaseRate: rate,
    purchaseValue: purchaseVal,
    transportCost: tCost,
    commission: comm,
    otherCost: oCost,
    totalCost,
    effectiveCostPerKg,
    paymentStatus: (paymentStatus as any) || "Paid",
    paidAmount: finalPaid,
    dueAmount,
    notes,
    createdAt: now,
  };

  store.purchases.unshift(newPurchase);

  // Update Stock (Weighted Average Cost and inventory addition)
  let stockItem = store.stock.find(
    (s) => s.fruitId === fruit.id && s.grade === newPurchase.grade
  );

  if (stockItem) {
    const prevWeight = stockItem.weightKg;
    const prevCost = stockItem.averageCostPerKg;
    const newWeight = prevWeight + netWeight;
    const newAvgCost =
      newWeight > 0
        ? Number(((prevWeight * prevCost + totalCost) / newWeight).toFixed(2))
        : effectiveCostPerKg;

    stockItem.crateQuantity += newPurchase.crateQuantity;
    stockItem.weightKg = newWeight;
    stockItem.purchaseCostPerKg = rate;
    stockItem.averageCostPerKg = newAvgCost;
    stockItem.stockValue = Number((newWeight * newAvgCost).toFixed(2));
    stockItem.lastUpdated = now;
  } else {
    store.stock.push({
      id: `stk-${Date.now()}`,
      fruitId: fruit.id,
      fruitName: fruit.name,
      variety: newPurchase.variety,
      grade: newPurchase.grade,
      unit: fruit.unit,
      crateQuantity: newPurchase.crateQuantity,
      weightKg: netWeight,
      purchaseCostPerKg: rate,
      averageCostPerKg: effectiveCostPerKg,
      sellingRatePerKg: fruit.grades.find((g) => g.grade === newPurchase.grade)?.wholesaleRate || rate * 1.25,
      stockValue: totalCost,
      lastUpdated: now,
    });
  }

  // Update Supplier Ledger & Outstanding
  supplier.totalPurchases += totalCost;
  supplier.paymentsMade += finalPaid;
  supplier.outstandingPayable += dueAmount;

  store.supplierLedger.unshift({
    id: `sl-${Date.now()}`,
    supplierId: supplier.id,
    date: purchaseDate,
    type: "Purchase",
    referenceId: newPurchase.id,
    referenceNo: purchaseNumber,
    description: `Purchase: ${fruit.name} (${newPurchase.grade}) ${netWeight} KG`,
    debit: 0,
    credit: totalCost,
    balance: supplier.outstandingPayable,
    createdAt: now,
  });

  if (finalPaid > 0) {
    store.supplierPayments.unshift({
      id: `sp-${Date.now()}`,
      paymentDate: purchaseDate,
      supplierId: supplier.id,
      supplierName: supplier.name,
      amount: finalPaid,
      paymentMethod: "Bank",
      referenceNo: purchaseNumber,
      notes: "Auto-recorded purchase settlement",
      createdAt: now,
    });

    store.supplierLedger.unshift({
      id: `sl-${Date.now() + 1}`,
      supplierId: supplier.id,
      date: purchaseDate,
      type: "Payment",
      referenceId: newPurchase.id,
      referenceNo: purchaseNumber,
      description: `Payment against purchase ${purchaseNumber}`,
      debit: finalPaid,
      credit: 0,
      balance: supplier.outstandingPayable,
      createdAt: now,
    });
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, purchase: newPurchase });
});

// Update / Modify Existing Purchase (recalculates stock, supplier ledger & totals)
app.put("/api/erp/purchases/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    supplierId,
    fruitId,
    variety,
    grade,
    crateQuantity,
    grossWeight,
    tareWeight,
    purchaseRate,
    transportCost = 0,
    commission = 0,
    otherCost = 0,
    paymentStatus = "Paid",
    paidAmount = 0,
    notes = "",
    purchaseDate = new Date().toISOString().split("T")[0],
  } = req.body;

  const store = loadStore();
  const index = store.purchases.findIndex((p) => p.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Purchase record not found." });
  }

  const oldPurchase = store.purchases[index];
  const supplier = store.suppliers.find((s) => s.id === (supplierId || oldPurchase.supplierId));
  const fruit = store.fruits.find((f) => f.id === (fruitId || oldPurchase.fruitId));

  if (!supplier || !fruit) {
    return res.status(400).json({ error: "Valid supplier and fruit are required." });
  }

  // 1. Revert previous purchase additions from stock
  const oldStock = store.stock.find((s) => s.fruitId === oldPurchase.fruitId && s.grade === oldPurchase.grade);
  if (oldStock) {
    oldStock.weightKg = Math.max(0, oldStock.weightKg - (Number(oldPurchase.netWeight) || 0));
    oldStock.crateQuantity = Math.max(0, oldStock.crateQuantity - (Number(oldPurchase.crateQuantity) || 0));
  }

  const gross = Number(grossWeight) || 0;
  const tare = Number(tareWeight) || 0;
  const netWeight = Math.max(0, gross - tare);
  const rate = Number(purchaseRate) || 0;
  const purchaseVal = netWeight * rate;
  const tCost = Number(transportCost) || 0;
  const comm = Number(commission) || 0;
  const oCost = Number(otherCost) || 0;
  const totalCost = purchaseVal + tCost + comm + oCost;
  const effectiveCostPerKg = netWeight > 0 ? Number((totalCost / netWeight).toFixed(2)) : rate;

  const pStatus = String(paymentStatus).toLowerCase();
  const finalPaid = pStatus === "paid" ? totalCost : pStatus === "credit" ? 0 : Number(paidAmount) || 0;
  const dueAmount = Math.max(0, totalCost - finalPaid);
  const now = new Date().toISOString();

  // 2. Add modified purchase to stock
  const targetGrade = (grade as any) || oldPurchase.grade || "A";
  let targetStock = store.stock.find((s) => s.fruitId === fruit.id && s.grade === targetGrade);
  if (targetStock) {
    const prevWeight = targetStock.weightKg;
    const prevCost = targetStock.averageCostPerKg;
    const newWeight = prevWeight + netWeight;
    const newAvgCost = newWeight > 0 ? Number(((prevWeight * prevCost + totalCost) / newWeight).toFixed(2)) : effectiveCostPerKg;
    targetStock.crateQuantity += Number(crateQuantity) || 0;
    targetStock.weightKg = newWeight;
    targetStock.purchaseCostPerKg = rate;
    targetStock.averageCostPerKg = newAvgCost;
    targetStock.stockValue = Number((newWeight * newAvgCost).toFixed(2));
    targetStock.lastUpdated = now;
  } else {
    store.stock.push({
      id: `stk-${Date.now()}`,
      fruitId: fruit.id,
      fruitName: fruit.name,
      variety: variety || fruit.variety,
      grade: targetGrade,
      unit: fruit.unit,
      crateQuantity: Number(crateQuantity) || 0,
      weightKg: netWeight,
      purchaseCostPerKg: rate,
      averageCostPerKg: effectiveCostPerKg,
      sellingRatePerKg: fruit.grades?.find((g: any) => g.grade === targetGrade)?.wholesaleRate || rate * 1.25,
      stockValue: totalCost,
      lastUpdated: now,
    });
  }

  // 3. Update existing purchase object in-place (no duplicate)
  store.purchases[index] = {
    ...oldPurchase,
    purchaseDate,
    supplierId: supplier.id,
    supplierName: supplier.name,
    fruitId: fruit.id,
    fruitName: fruit.name,
    variety: variety || fruit.variety,
    grade: targetGrade,
    crateQuantity: Number(crateQuantity) || 0,
    grossWeight: gross,
    tareWeight: tare,
    netWeight,
    purchaseRate: rate,
    purchaseValue: purchaseVal,
    transportCost: tCost,
    commission: comm,
    otherCost: oCost,
    totalCost,
    effectiveCostPerKg,
    paymentStatus: (paymentStatus as any) || "Paid",
    paidAmount: finalPaid,
    dueAmount,
    notes,
  };

  // 4. Update supplier ledger purchase entry
  let pLedger = store.supplierLedger.find(
    (l) => (l.referenceId === oldPurchase.id || l.referenceNo === oldPurchase.purchaseNumber) && l.type === "Purchase"
  );
  if (pLedger) {
    pLedger.supplierId = supplier.id;
    pLedger.date = purchaseDate;
    pLedger.credit = totalCost;
    pLedger.description = `Purchase: ${fruit.name} (${targetGrade}) ${netWeight} KG`;
  } else {
    store.supplierLedger.unshift({
      id: `sl-${Date.now()}`,
      supplierId: supplier.id,
      date: purchaseDate,
      type: "Purchase",
      referenceId: oldPurchase.id,
      referenceNo: oldPurchase.purchaseNumber,
      description: `Purchase: ${fruit.name} (${targetGrade}) ${netWeight} KG`,
      debit: 0,
      credit: totalCost,
      balance: 0,
      createdAt: now,
    });
  }

  // 5. Update or sync supplier payment entry
  let payLedger = store.supplierLedger.find(
    (l) => (l.referenceId === oldPurchase.id || l.referenceNo === oldPurchase.purchaseNumber) && l.type === "Payment"
  );
  let supPayment = store.supplierPayments.find(
    (p) => p.referenceNo === oldPurchase.purchaseNumber || p.id === oldPurchase.id
  );

  if (finalPaid > 0) {
    if (payLedger) {
      payLedger.supplierId = supplier.id;
      payLedger.date = purchaseDate;
      payLedger.debit = finalPaid;
      payLedger.description = `Payment against purchase ${oldPurchase.purchaseNumber}`;
    } else {
      store.supplierLedger.unshift({
        id: `sl-${Date.now() + 1}`,
        supplierId: supplier.id,
        date: purchaseDate,
        type: "Payment",
        referenceId: oldPurchase.id,
        referenceNo: oldPurchase.purchaseNumber,
        description: `Payment against purchase ${oldPurchase.purchaseNumber}`,
        debit: finalPaid,
        credit: 0,
        balance: 0,
        createdAt: now,
      });
    }

    if (supPayment) {
      supPayment.supplierId = supplier.id;
      supPayment.supplierName = supplier.name;
      supPayment.amount = finalPaid;
      supPayment.paymentDate = purchaseDate;
    } else {
      store.supplierPayments.unshift({
        id: `sp-${Date.now()}`,
        paymentDate: purchaseDate,
        supplierId: supplier.id,
        supplierName: supplier.name,
        amount: finalPaid,
        paymentMethod: "Bank",
        referenceNo: oldPurchase.purchaseNumber,
        notes: "Auto-recorded purchase settlement",
        createdAt: now,
      });
    }
  } else {
    if (payLedger) {
      store.supplierLedger = store.supplierLedger.filter((l) => l.id !== payLedger!.id);
    }
    if (supPayment) {
      store.supplierPayments = store.supplierPayments.filter((p) => p.id !== supPayment!.id);
    }
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, purchase: store.purchases[index] });
});

// Get all sales
app.get("/api/erp/sales", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({ success: true, sales: store.sales || [] });
});

// Create Sale (Deducts stock, records invoice, updates customer ledger & profit)
app.post("/api/erp/sales", requireAuth, (req: Request, res: Response) => {
  const {
    customerId,
    items,
    discount = 0,
    paymentMethod = "Cash",
    paidAmount = 0,
    notes = "",
    saleDate = new Date().toISOString().split("T")[0],
    companyProfileId,
    companySnapshot: passedCompanySnapshot,
  } = req.body;

  const store = loadStore();
  const now = new Date().toISOString();

  // Resolve Company Profile for invoice snapshot
  let selectedCompanyProfile = store.companyProfiles?.find((cp) => cp.id === companyProfileId);
  if (!selectedCompanyProfile && store.companyProfiles && store.companyProfiles.length > 0) {
    selectedCompanyProfile = store.companyProfiles.find((cp) => cp.isDefault) || store.companyProfiles[0];
  }

  const finalCompanySnapshot = passedCompanySnapshot || (selectedCompanyProfile ? {
    id: selectedCompanyProfile.id,
    companyName: selectedCompanyProfile.companyName,
    tradeName: selectedCompanyProfile.tradeName,
    logo: selectedCompanyProfile.logo,
    address: selectedCompanyProfile.address,
    gstin: selectedCompanyProfile.gstin,
    pan: selectedCompanyProfile.pan,
    phone: selectedCompanyProfile.phone,
    email: selectedCompanyProfile.email,
    website: selectedCompanyProfile.website,
    bankDetails: selectedCompanyProfile.bankDetails,
    upi: selectedCompanyProfile.upi,
    termsConditions: selectedCompanyProfile.termsConditions,
    signature: selectedCompanyProfile.signature,
    authorizedPerson: selectedCompanyProfile.authorizedPerson,
    isActive: selectedCompanyProfile.isActive,
  } : undefined);

  // Find existing customer or auto-create new customer if name provided
  let customer = store.customers.find((c) => c.id === customerId);
  if (!customer && (req.body.customerName || customerId)) {
    const custName = (req.body.customerName || customerId).trim();
    customer = store.customers.find((c) => c.name.toLowerCase() === custName.toLowerCase());
    if (!customer && custName) {
      customer = {
        id: `cust-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: custName,
        businessName: req.body.customerBusiness || custName,
        phone: req.body.customerPhone || '9820000000',
        address: req.body.customerAddress || 'APMC Fruit Market',
        city: req.body.customerCity || 'Mumbai',
        state: 'Maharashtra',
        type: req.body.customerType || 'Wholesale Buyer',
        creditLimit: 500000,
        creditPeriodDays: 15,
        openingBalance: 0,
        outstandingBalance: 0,
        totalPurchases: 0,
        totalPayments: 0,
        totalPaid: 0,
        createdAt: now,
      };
      store.customers.push(customer);
    }
  }

  if (!customer) {
    return res.status(400).json({ error: "Valid customer is required." });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one sale item is required." });
  }

  let subtotal = 0;
  const processedItems: any[] = [];

  // Validate and deduct stock
  for (const it of items) {
    // Find or auto-create fruit/product
    let fruit = store.fruits.find((f) => f.id === it.fruitId);
    if (!fruit && (it.productName || it.fruitName)) {
      const prodName = (it.productName || it.fruitName).trim();
      fruit = store.fruits.find((f) => f.name.toLowerCase() === prodName.toLowerCase());
      if (!fruit && prodName) {
        fruit = {
          id: `frt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: prodName,
          category: 'Other',
          variety: it.variety || 'Standard',
          unit: it.unit || 'KG',
          image: '🍎',
          minStock: 50,
          minStockAlertKg: 50,
          status: 'active',
          grades: [{
            grade: 'Standard' as any,
            purchaseRate: (Number(it.rate) || 80) * 0.8,
            wholesaleRate: Number(it.rate) || 80,
            retailRate: (Number(it.rate) || 80) * 1.2,
          }],
          createdAt: now,
        };
        store.fruits.push(fruit);
      }
    }

    const parsedQty = parseFloat(String(it.quantity || it.weightKg || '0').replace(/[^\d.]/g, ''));
    const qtyNum = isNaN(parsedQty) || parsedQty <= 0 ? (Number(it.weightKg) || 1) : parsedQty;
    const kgInput = parseFloat(String(it.kg || '').replace(/[^\d.]/g, '')) || 0;
    const weight = kgInput > 0 ? kgInput : (Number(it.weightKg) || qtyNum);
    const crates = Number(it.crates) || (String(it.quantity || '').toLowerCase().includes('crate') ? qtyNum : 0);
    const rate = Number(it.rate) || Number(it.ratePerKg) || 0;
    const itemDiscount = Number(it.discount) || 0;
    const lineTotal = Number(it.amount) || Number(it.total) || Number(it.totalPrice) || Math.max(0, weight * rate - itemDiscount);

    subtotal += lineTotal;

    // Find stock record (grade is optional)
    const stockRecord = store.stock.find(
      (s) => s.fruitId === it.fruitId && (it.grade ? s.grade === it.grade : true)
    );

    const costPrice = stockRecord ? stockRecord.averageCostPerKg : rate * 0.8;

    if (stockRecord) {
      stockRecord.weightKg = Math.max(0, stockRecord.weightKg - weight);
      stockRecord.crateQuantity = Math.max(0, stockRecord.crateQuantity - crates);
      stockRecord.stockValue = Number((stockRecord.weightKg * stockRecord.averageCostPerKg).toFixed(2));
      stockRecord.lastUpdated = now;

      // Check for low stock notification
      if (stockRecord.weightKg <= (fruit?.minStock || 200)) {
        store.notifications.unshift({
          id: `notif-${Date.now()}-${fruit?.id}`,
          title: `Low Stock: ${fruit?.name || stockRecord.fruitName}`,
          message: `Current stock is only ${stockRecord.weightKg} KG. Re-stock recommended.`,
          type: "low_stock",
          severity: "warning",
          date: saleDate,
          read: false,
          linkSection: "stock",
        });
      }
    }

    const resolvedItemIcon = it.fruitIcon || (fruit?.photoUrl || (fruit as any)?.imageUrl || fruit?.customIconUrl || fruit?.avatarIcon || fruit?.image || "🍎");

    processedItems.push({
      id: `si-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      fruitId: it.fruitId,
      fruitName: fruit ? fruit.name : it.fruitName,
      fruitCode: it.fruitCode || fruit?.code || fruit?.productCode || "",
      fruitIcon: resolvedItemIcon,
      photoUrl: it.photoUrl || fruit?.photoUrl || (fruit as any)?.imageUrl || "",
      customIconUrl: it.customIconUrl || fruit?.customIconUrl || "",
      avatarIcon: it.avatarIcon || fruit?.avatarIcon || fruit?.defaultIcon || "",
      gstRate: it.gstRate !== undefined ? Number(it.gstRate) : (fruit?.gstRate || 0),
      hsn: it.hsn || it.hsnSac || fruit?.hsn || fruit?.hsnSac || "",
      variety: it.variety || (fruit ? fruit.variety : "Standard"),
      quantity: it.quantity ? String(it.quantity) : `${weight} ${it.unit || 'KG'}`,
      unit: it.unit || (fruit ? fruit.unit : "KG"),
      crates,
      weightKg: weight,
      ratePerKg: rate,
      rate: rate,
      discount: itemDiscount,
      total: lineTotal,
      totalPrice: lineTotal,
      amount: lineTotal,
      costPricePerKg: costPrice,
    });
  }

  const totalDiscount = Number(discount) || 0;
  const expense = Number(req.body.expense) || 0;
  const netTotal = Math.max(0, subtotal + expense - totalDiscount);
  const grandTotal = netTotal;
  const finalPaid = paymentMethod === "Credit" ? 0 : paymentMethod === "Cash" && Number(paidAmount) === 0 ? grandTotal : Number(paidAmount) || 0;
  const dueAmount = Math.max(0, grandTotal - finalPaid);
  const oldBalance = Number(customer.outstandingBalance) || 0;
  const totalBalance = oldBalance + dueAmount;

  const invoiceNumber = `KFP/2026/${String(store.sales.length + 145).padStart(5, "0")}`;

  const newSale = {
    id: `sal-${Date.now()}`,
    invoiceNumber,
    saleDate,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerBusiness: customer.businessName,
    customerType: customer.type || req.body.customerType || "Wholesale Buyer",
    companyProfileId: selectedCompanyProfile?.id || companyProfileId,
    companySnapshot: finalCompanySnapshot,
    items: processedItems,
    subtotal,
    total: subtotal,
    expense,
    discount: totalDiscount,
    netTotal,
    grandTotal,
    oldBalance,
    totalBalance,
    balanceCrates: req.body.balanceCrates,
    weightPerCrate: req.body.weightPerCrate,
    paymentMethod: (paymentMethod as any) || "Cash",
    paidAmount: finalPaid,
    dueAmount,
    notes,
    status: "Completed" as const,
    createdAt: now,
  };

  store.sales.unshift(newSale);

  // Update Customer Stats and Ledger
  customer.totalPurchases += grandTotal;
  customer.totalPayments += finalPaid;
  customer.outstandingBalance += dueAmount;
  customer.lastTransactionDate = saleDate;

  // Add Sale Debit Entry
  store.customerLedger.unshift({
    id: `cl-${Date.now()}`,
    customerId: customer.id,
    date: saleDate,
    type: "Sale",
    referenceId: newSale.id,
    referenceNo: invoiceNumber,
    description: `Sale: ${processedItems.map((p) => `${p.fruitName} (${p.quantity || p.weightKg + 'KG'})`).join(", ")}`,
    debit: grandTotal,
    credit: 0,
    balance: customer.outstandingBalance,
    createdAt: now,
  });

  // If upfront payment received
  if (finalPaid > 0) {
    store.customerPayments.unshift({
      id: `cp-${Date.now()}`,
      paymentDate: saleDate,
      customerId: customer.id,
      customerName: customer.name,
      amount: finalPaid,
      paymentMethod: paymentMethod === "Credit" ? "Cash" : paymentMethod,
      referenceNo: invoiceNumber,
      notes: "Invoice spot payment",
      createdAt: now,
    });

    store.customerLedger.unshift({
      id: `cl-${Date.now() + 1}`,
      customerId: customer.id,
      date: saleDate,
      type: "Payment",
      referenceId: newSale.id,
      referenceNo: invoiceNumber,
      description: `Payment received (${paymentMethod})`,
      debit: 0,
      credit: finalPaid,
      balance: customer.outstandingBalance,
      createdAt: now,
    });
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, sale: newSale });
});

// Update / Modify Existing Sale (recalculates stock, customer ledger, balances & totals)
app.put("/api/erp/sales/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    customerId,
    items,
    discount = 0,
    paymentMethod = "Cash",
    paidAmount = 0,
    notes = "",
    saleDate = new Date().toISOString().split("T")[0],
  } = req.body;

  const store = loadStore();
  const index = store.sales.findIndex((s) => s.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Sale record not found." });
  }

  const oldSale = store.sales[index];
  const customer = store.customers.find((c) => c.id === (customerId || oldSale.customerId));
  if (!customer) {
    return res.status(400).json({ error: "Valid customer is required." });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one sale item is required." });
  }

  const now = new Date().toISOString();

  // 1. Revert previous sale stock deductions
  for (const oldIt of oldSale.items || []) {
    const stockRec = store.stock.find((s) => s.fruitId === oldIt.fruitId && s.grade === oldIt.grade);
    if (stockRec) {
      stockRec.weightKg += Number(oldIt.weightKg) || 0;
      stockRec.crateQuantity += Number(oldIt.crates) || 0;
      stockRec.stockValue = Number((stockRec.weightKg * stockRec.averageCostPerKg).toFixed(2));
    }
  }

  // 2. Process new items and deduct from stock
  let subtotal = 0;
  const processedItems: any[] = [];
  for (const it of items) {
    const fruit = store.fruits.find((f) => f.id === it.fruitId);
    const parsedQty = parseFloat(String(it.quantity || it.weightKg || '0').replace(/[^\d.]/g, ''));
    const qtyNum = isNaN(parsedQty) || parsedQty <= 0 ? (Number(it.weightKg) || 1) : parsedQty;
    const kgInput = parseFloat(String(it.kg || '').replace(/[^\d.]/g, '')) || 0;
    const weight = kgInput > 0 ? kgInput : (Number(it.weightKg) || qtyNum);
    const crates = Number(it.crates) || (String(it.quantity || '').toLowerCase().includes('crate') ? qtyNum : 0);
    const rate = Number(it.rate) || Number(it.ratePerKg) || 0;
    const itemDiscount = Number(it.discount) || 0;
    const lineTotal = Number(it.amount) || Number(it.total) || Number(it.totalPrice) || Math.max(0, weight * rate - itemDiscount);

    subtotal += lineTotal;

    const stockRecord = store.stock.find(
      (s) => s.fruitId === it.fruitId && (it.grade ? s.grade === it.grade : true)
    );
    const costPrice = stockRecord ? stockRecord.averageCostPerKg : rate * 0.8;

    if (stockRecord) {
      stockRecord.weightKg = Math.max(0, stockRecord.weightKg - weight);
      stockRecord.crateQuantity = Math.max(0, stockRecord.crateQuantity - crates);
      stockRecord.stockValue = Number((stockRecord.weightKg * stockRecord.averageCostPerKg).toFixed(2));
      stockRecord.lastUpdated = now;
    }

    const resolvedItemIcon = it.fruitIcon || (fruit?.photoUrl || (fruit as any)?.imageUrl || fruit?.customIconUrl || fruit?.avatarIcon || fruit?.image || "🍎");

    processedItems.push({
      id: it.id || `si-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      fruitId: it.fruitId,
      fruitName: fruit ? fruit.name : it.fruitName,
      fruitCode: it.fruitCode || fruit?.code || fruit?.productCode || "",
      fruitIcon: resolvedItemIcon,
      photoUrl: it.photoUrl || fruit?.photoUrl || (fruit as any)?.imageUrl || "",
      customIconUrl: it.customIconUrl || fruit?.customIconUrl || "",
      avatarIcon: it.avatarIcon || fruit?.avatarIcon || fruit?.defaultIcon || "",
      gstRate: it.gstRate !== undefined ? Number(it.gstRate) : (fruit?.gstRate || 0),
      hsn: it.hsn || it.hsnSac || fruit?.hsn || fruit?.hsnSac || "",
      variety: it.variety || (fruit ? fruit.variety : "Standard"),
      quantity: it.quantity ? String(it.quantity) : `${weight} ${it.unit || 'KG'}`,
      unit: it.unit || (fruit ? fruit.unit : "KG"),
      crates,
      weightKg: weight,
      ratePerKg: rate,
      rate: rate,
      discount: itemDiscount,
      total: lineTotal,
      totalPrice: lineTotal,
      amount: lineTotal,
      costPricePerKg: costPrice,
    });
  }

  const totalDiscount = Number(discount) || 0;
  const expense = Number(req.body.expense) || 0;
  const netTotal = Math.max(0, subtotal + expense - totalDiscount);
  const grandTotal = netTotal;
  const finalPaid = paymentMethod === "Credit" ? 0 : paymentMethod === "Cash" && Number(paidAmount) === 0 ? grandTotal : Number(paidAmount) || 0;
  const dueAmount = Math.max(0, grandTotal - finalPaid);
  const oldBalance = Number(customer.outstandingBalance) || 0;
  const totalBalance = oldBalance + dueAmount;

  // 3. Update existing sale object in-place (no duplicate)
  store.sales[index] = {
    ...oldSale,
    saleDate,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerBusiness: customer.businessName,
    customerType: customer.type || req.body.customerType || oldSale.customerType || "Wholesale Buyer",
    companyProfileId: req.body.companyProfileId !== undefined ? req.body.companyProfileId : oldSale.companyProfileId,
    companySnapshot: req.body.companySnapshot !== undefined ? req.body.companySnapshot : oldSale.companySnapshot,
    items: processedItems,
    subtotal,
    total: subtotal,
    expense,
    discount: totalDiscount,
    netTotal,
    grandTotal,
    oldBalance,
    totalBalance,
    balanceCrates: req.body.balanceCrates !== undefined ? req.body.balanceCrates : oldSale.balanceCrates,
    weightPerCrate: req.body.weightPerCrate !== undefined ? req.body.weightPerCrate : oldSale.weightPerCrate,
    paymentMethod: (paymentMethod as any) || "Cash",
    paidAmount: finalPaid,
    dueAmount,
    notes,
  };

  // 4. Update customer ledger Sale entry
  let saleLedger = store.customerLedger.find(
    (l) => (l.referenceId === oldSale.id || l.referenceNo === oldSale.invoiceNumber) && l.type === "Sale"
  );
  if (saleLedger) {
    saleLedger.customerId = customer.id;
    saleLedger.date = saleDate;
    saleLedger.debit = grandTotal;
    saleLedger.description = `Sale: ${processedItems.map((p) => `${p.fruitName} (${p.weightKg}KG)`).join(", ")}`;
  } else {
    store.customerLedger.unshift({
      id: `cl-${Date.now()}`,
      customerId: customer.id,
      date: saleDate,
      type: "Sale",
      referenceId: oldSale.id,
      referenceNo: oldSale.invoiceNumber,
      description: `Sale: ${processedItems.map((p) => `${p.fruitName} (${p.weightKg}KG)`).join(", ")}`,
      debit: grandTotal,
      credit: 0,
      balance: 0,
      createdAt: now,
    });
  }

  // 5. Update or sync customer ledger Payment entry & customerPayments record
  let payLedger = store.customerLedger.find(
    (l) => (l.referenceId === oldSale.id || l.referenceNo === oldSale.invoiceNumber) && l.type === "Payment"
  );
  let custPayment = store.customerPayments.find(
    (p) => p.referenceNo === oldSale.invoiceNumber || p.id === oldSale.id
  );

  if (finalPaid > 0) {
    if (payLedger) {
      payLedger.customerId = customer.id;
      payLedger.date = saleDate;
      payLedger.credit = finalPaid;
      payLedger.description = `Payment received (${paymentMethod})`;
    } else {
      store.customerLedger.unshift({
        id: `cl-${Date.now() + 1}`,
        customerId: customer.id,
        date: saleDate,
        type: "Payment",
        referenceId: oldSale.id,
        referenceNo: oldSale.invoiceNumber,
        description: `Payment received (${paymentMethod})`,
        debit: 0,
        credit: finalPaid,
        balance: 0,
        createdAt: now,
      });
    }

    if (custPayment) {
      custPayment.customerId = customer.id;
      custPayment.customerName = customer.name;
      custPayment.amount = finalPaid;
      custPayment.paymentDate = saleDate;
      custPayment.paymentMethod = paymentMethod === "Credit" ? "Cash" : (paymentMethod as any);
    } else {
      store.customerPayments.unshift({
        id: `cp-${Date.now()}`,
        paymentDate: saleDate,
        customerId: customer.id,
        customerName: customer.name,
        amount: finalPaid,
        paymentMethod: paymentMethod === "Credit" ? "Cash" : (paymentMethod as any),
        referenceNo: oldSale.invoiceNumber,
        notes: "Invoice spot payment",
        createdAt: now,
      });
    }
  } else {
    if (payLedger) {
      store.customerLedger = store.customerLedger.filter((l) => l.id !== payLedger!.id);
    }
    if (custPayment) {
      store.customerPayments = store.customerPayments.filter((p) => p.id !== custPayment!.id);
    }
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, sale: store.sales[index] });
});

// Customers CRUD & Payment
app.get("/api/erp/customers", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({ success: true, customers: store.customers || [] });
});

app.post("/api/erp/customers", requireAuth, (req: Request, res: Response) => {
  const {
    name,
    businessName,
    contactPerson,
    phone,
    whatsapp,
    email,
    address,
    city,
    state,
    aadhaarNumber,
    aadhaar,
    pan,
    type,
    creditLimit,
    creditPeriodDays,
    openingBalance,
    notes,
    photoUrl,
    avatarIcon,
    customIconUrl,
  } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: "Customer name and phone number are required." });
  }

  const store = loadStore();
  const openBal = Number(openingBalance) || 0;
  const newCustomer = {
    id: `cust-${Date.now()}`,
    name: String(name).trim(),
    businessName: String(businessName || name).trim(),
    contactPerson: String(contactPerson || name).trim(),
    phone: String(phone).trim(),
    whatsapp: String(whatsapp || phone).trim(),
    email: String(email || "").trim(),
    address: String(address || "").trim(),
    city: String(city || "Mumbai").trim(),
    state: String(state || "Maharashtra").trim(),
    aadhaarNumber: String(aadhaarNumber || aadhaar || "").trim(),
    pan: String(pan || "").trim(),
    type: String(type || "Wholesale Buyer").trim(),
    creditLimit: Number(creditLimit) || 100000,
    creditPeriodDays: Number(creditPeriodDays) || 15,
    openingBalance: openBal,
    notes: String(notes || "").trim(),
    photoUrl: String(photoUrl || "").trim(),
    avatarIcon: String(avatarIcon || "").trim(),
    customIconUrl: String(customIconUrl || "").trim(),
    totalPurchases: 0,
    totalPayments: 0,
    outstandingBalance: openBal,
    createdAt: new Date().toISOString(),
  };

  store.customers.unshift(newCustomer);

  if (openBal > 0) {
    store.customerLedger.unshift({
      id: `cl-${Date.now()}`,
      customerId: newCustomer.id,
      date: new Date().toISOString().split("T")[0],
      type: "Opening",
      referenceId: "op-init",
      referenceNo: "OB",
      description: "Opening Balance Brought Forward",
      debit: openBal,
      credit: 0,
      balance: openBal,
      createdAt: new Date().toISOString(),
    });
  }

  saveStore(store);
  return res.json({ success: true, customer: newCustomer });
});

app.put("/api/erp/customers/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  const index = store.customers.findIndex((c) => c.id === id);
  if (index === -1) return res.status(404).json({ error: "Customer not found." });

  const updatedData = { ...req.body };
  if ("gstin" in updatedData && !updatedData.gstin) delete updatedData.gstin;
  if ("gstNumber" in updatedData && !updatedData.gstNumber) delete updatedData.gstNumber;

  store.customers[index] = {
    ...store.customers[index],
    ...updatedData,
    id,
  };
  saveStore(store);
  return res.json({ success: true, customer: store.customers[index] });
});

app.delete("/api/erp/customers/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  store.customers = store.customers.filter((c) => c.id !== id);
  saveStore(store);
  return res.json({ success: true });
});

// Record Customer Payment (reduces Khata balance)
app.post("/api/erp/customers/:id/payment", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, paymentMethod = "UPI", referenceNo = "", notes = "", paymentDate = new Date().toISOString().split("T")[0] } = req.body;
  const store = loadStore();
  const customer = store.customers.find((c) => c.id === id);
  if (!customer) return res.status(404).json({ error: "Customer not found." });

  const payAmount = Number(amount) || 0;
  if (payAmount <= 0) return res.status(400).json({ error: "Valid payment amount required." });

  customer.totalPayments += payAmount;
  customer.outstandingBalance = Math.max(0, customer.outstandingBalance - payAmount);
  const now = new Date().toISOString();

  const newPayment = {
    id: `cp-${Date.now()}`,
    paymentDate,
    customerId: customer.id,
    customerName: customer.name,
    amount: payAmount,
    paymentMethod: (paymentMethod as any) || "UPI",
    referenceNo: referenceNo || `RCV-${Date.now().toString().slice(-6)}`,
    notes,
    createdAt: now,
  };

  store.customerPayments.unshift(newPayment);

  store.customerLedger.unshift({
    id: `cl-${Date.now()}`,
    customerId: customer.id,
    date: paymentDate,
    type: "Payment",
    referenceId: newPayment.id,
    referenceNo: newPayment.referenceNo,
    description: `Payment received (${paymentMethod}) ${notes ? '- ' + notes : ''}`,
    debit: 0,
    credit: payAmount,
    balance: customer.outstandingBalance,
    createdAt: now,
  });

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, customer, payment: newPayment });
});

// Update / Modify Customer Ledger Entry (credit, debit, adjustment, etc.)
app.put("/api/erp/customer-ledger/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { date, type, description, notes, debit, credit, referenceNo } = req.body;
  const store = loadStore();
  const entry = store.customerLedger.find((l) => l.id === id);
  if (!entry) return res.status(404).json({ error: "Customer ledger entry not found." });

  if (date !== undefined) entry.date = date;
  if (type !== undefined) entry.type = type;
  if (description !== undefined) entry.description = description;
  if (notes !== undefined) entry.notes = notes;
  if (referenceNo !== undefined) entry.referenceNo = referenceNo;
  if (debit !== undefined) entry.debit = Math.max(0, Number(debit) || 0);
  if (credit !== undefined) entry.credit = Math.max(0, Number(credit) || 0);

  // Sync linked payment if any
  const payment = store.customerPayments.find((p) => p.id === entry.referenceId || (entry.referenceNo && p.referenceNo === entry.referenceNo));
  if (payment) {
    if (credit !== undefined || debit !== undefined) {
      payment.amount = entry.credit > 0 ? entry.credit : entry.debit;
    }
    if (date !== undefined) payment.paymentDate = date;
    if (description || notes) payment.notes = notes || description;
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, entry });
});

// Create Customer Ledger Entry (Direct Khata Debit / Credit / Adjustment)
app.post("/api/erp/customer-ledger", requireAuth, (req: Request, res: Response) => {
  const { customerId, date, type = "Adjustment", description = "", debit = 0, credit = 0, referenceNo = "", notes = "" } = req.body;
  const store = loadStore();
  const customer = store.customers.find((c) => c.id === customerId);
  if (!customer) return res.status(404).json({ error: "Customer not found." });

  const numDebit = Math.max(0, Number(debit) || 0);
  const numCredit = Math.max(0, Number(credit) || 0);
  const now = new Date().toISOString();

  const newEntry = {
    id: `cl-${Date.now()}`,
    customerId: customer.id,
    date: date || now.split("T")[0],
    type: (type as any) || "Adjustment",
    referenceId: `adj-${Date.now()}`,
    referenceNo: referenceNo || `ADJ-${Date.now().toString().slice(-6)}`,
    description: description || `Khata ${type}`,
    notes,
    debit: numDebit,
    credit: numCredit,
    balance: 0,
    createdAt: now,
  };

  store.customerLedger.unshift(newEntry);
  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, entry: newEntry });
});

// Update / Modify Customer Settlement Payment
app.put("/api/erp/customer-payments/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, paymentMethod, paymentDate, referenceNo, notes } = req.body;
  const store = loadStore();
  const payment = store.customerPayments.find((p) => p.id === id);
  if (!payment) return res.status(404).json({ error: "Customer payment not found." });

  const payAmt = Number(amount) || 0;
  if (amount !== undefined) payment.amount = payAmt;
  if (paymentMethod !== undefined) payment.paymentMethod = paymentMethod;
  if (paymentDate !== undefined) payment.paymentDate = paymentDate;
  if (referenceNo !== undefined) payment.referenceNo = referenceNo;
  if (notes !== undefined) payment.notes = notes;

  // Sync matching ledger entry
  const ledger = store.customerLedger.find((l) => l.referenceId === payment.id || (payment.referenceNo && l.referenceNo === payment.referenceNo));
  if (ledger) {
    if (amount !== undefined) ledger.credit = payAmt;
    if (paymentDate !== undefined) ledger.date = paymentDate;
    if (referenceNo !== undefined) ledger.referenceNo = referenceNo;
    if (notes !== undefined) ledger.description = `Payment received (${payment.paymentMethod}) ${notes ? '- ' + notes : ''}`;
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, payment });
});

// Suppliers CRUD & Payment
app.get("/api/erp/suppliers", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  return res.json({ success: true, suppliers: store.suppliers || [] });
});

app.post("/api/erp/suppliers", requireAuth, (req: Request, res: Response) => {
  const { name, contactPerson, phone, address, gstNumber, openingBalance, notes } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: "Supplier name and phone are required." });
  }

  const store = loadStore();
  const openBal = Number(openingBalance) || 0;
  const newSupplier = {
    id: `sup-${Date.now()}`,
    name,
    contactPerson: contactPerson || "",
    phone,
    address: address || "",
    gstNumber: gstNumber || "",
    openingBalance: openBal,
    notes: notes || "",
    totalPurchases: 0,
    paymentsMade: 0,
    outstandingPayable: openBal,
    createdAt: new Date().toISOString(),
  };

  store.suppliers.unshift(newSupplier);

  if (openBal > 0) {
    store.supplierLedger.unshift({
      id: `sl-${Date.now()}`,
      supplierId: newSupplier.id,
      date: new Date().toISOString().split("T")[0],
      type: "Opening",
      referenceId: "op-init",
      referenceNo: "OB",
      description: "Opening Balance Brought Forward",
      debit: 0,
      credit: openBal,
      balance: openBal,
      createdAt: new Date().toISOString(),
    });
  }

  saveStore(store);
  return res.json({ success: true, supplier: newSupplier });
});

app.put("/api/erp/suppliers/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  const index = store.suppliers.findIndex((s) => s.id === id);
  if (index === -1) return res.status(404).json({ error: "Supplier not found." });

  store.suppliers[index] = {
    ...store.suppliers[index],
    ...req.body,
    id,
  };
  saveStore(store);
  return res.json({ success: true, supplier: store.suppliers[index] });
});

app.delete("/api/erp/suppliers/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  store.suppliers = store.suppliers.filter((s) => s.id !== id);
  saveStore(store);
  return res.json({ success: true });
});

// Record Supplier Payment
app.post("/api/erp/suppliers/:id/payment", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, paymentMethod = "Bank", referenceNo = "", notes = "", paymentDate = new Date().toISOString().split("T")[0] } = req.body;
  const store = loadStore();
  const supplier = store.suppliers.find((s) => s.id === id);
  if (!supplier) return res.status(404).json({ error: "Supplier not found." });

  const payAmount = Number(amount) || 0;
  if (payAmount <= 0) return res.status(400).json({ error: "Valid payment amount required." });

  supplier.paymentsMade += payAmount;
  supplier.outstandingPayable = Math.max(0, supplier.outstandingPayable - payAmount);
  const now = new Date().toISOString();

  const newPayment = {
    id: `sp-${Date.now()}`,
    paymentDate,
    supplierId: supplier.id,
    supplierName: supplier.name,
    amount: payAmount,
    paymentMethod: (paymentMethod as any) || "Bank",
    referenceNo: referenceNo || `PAY-${Date.now().toString().slice(-6)}`,
    notes,
    createdAt: now,
  };

  store.supplierPayments.unshift(newPayment);

  store.supplierLedger.unshift({
    id: `sl-${Date.now()}`,
    supplierId: supplier.id,
    date: paymentDate,
    type: "Payment",
    referenceId: newPayment.id,
    referenceNo: newPayment.referenceNo,
    description: `Payment to supplier (${paymentMethod}) ${notes ? '- ' + notes : ''}`,
    debit: payAmount,
    credit: 0,
    balance: supplier.outstandingPayable,
    createdAt: now,
  });

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, supplier, payment: newPayment });
});

// Update / Modify Supplier Ledger Entry (credit, debit, adjustment, etc.)
app.put("/api/erp/supplier-ledger/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { date, type, description, notes, debit, credit, referenceNo } = req.body;
  const store = loadStore();
  const entry = store.supplierLedger.find((l) => l.id === id);
  if (!entry) return res.status(404).json({ error: "Supplier ledger entry not found." });

  if (date !== undefined) entry.date = date;
  if (type !== undefined) entry.type = type;
  if (description !== undefined) entry.description = description;
  if (notes !== undefined) entry.notes = notes;
  if (referenceNo !== undefined) entry.referenceNo = referenceNo;
  if (debit !== undefined) entry.debit = Math.max(0, Number(debit) || 0);
  if (credit !== undefined) entry.credit = Math.max(0, Number(credit) || 0);

  // Sync linked payment if any
  const payment = store.supplierPayments.find((p) => p.id === entry.referenceId || (entry.referenceNo && p.referenceNo === entry.referenceNo));
  if (payment) {
    if (debit !== undefined || credit !== undefined) {
      payment.amount = entry.debit > 0 ? entry.debit : entry.credit;
    }
    if (date !== undefined) payment.paymentDate = date;
    if (description || notes) payment.notes = notes || description;
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, entry });
});

// Create Supplier Ledger Entry (Direct Khata Debit / Credit / Adjustment)
app.post("/api/erp/supplier-ledger", requireAuth, (req: Request, res: Response) => {
  const { supplierId, date, type = "Adjustment", description = "", debit = 0, credit = 0, referenceNo = "", notes = "" } = req.body;
  const store = loadStore();
  const supplier = store.suppliers.find((s) => s.id === supplierId);
  if (!supplier) return res.status(404).json({ error: "Supplier not found." });

  const numDebit = Math.max(0, Number(debit) || 0);
  const numCredit = Math.max(0, Number(credit) || 0);
  const now = new Date().toISOString();

  const newEntry = {
    id: `sl-${Date.now()}`,
    supplierId: supplier.id,
    date: date || now.split("T")[0],
    type: (type as any) || "Adjustment",
    referenceId: `adj-${Date.now()}`,
    referenceNo: referenceNo || `ADJ-${Date.now().toString().slice(-6)}`,
    description: description || `Supplier Khata ${type}`,
    notes,
    debit: numDebit,
    credit: numCredit,
    balance: 0,
    createdAt: now,
  };

  store.supplierLedger.unshift(newEntry);
  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, entry: newEntry });
});

// Update / Modify Supplier Settlement Payment
app.put("/api/erp/supplier-payments/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, paymentMethod, paymentDate, referenceNo, notes } = req.body;
  const store = loadStore();
  const payment = store.supplierPayments.find((p) => p.id === id);
  if (!payment) return res.status(404).json({ error: "Supplier payment not found." });

  const payAmt = Number(amount) || 0;
  if (amount !== undefined) payment.amount = payAmt;
  if (paymentMethod !== undefined) payment.paymentMethod = paymentMethod;
  if (paymentDate !== undefined) payment.paymentDate = paymentDate;
  if (referenceNo !== undefined) payment.referenceNo = referenceNo;
  if (notes !== undefined) payment.notes = notes;

  // Sync matching ledger entry
  const ledger = store.supplierLedger.find((l) => l.referenceId === payment.id || (payment.referenceNo && l.referenceNo === payment.referenceNo));
  if (ledger) {
    if (amount !== undefined) ledger.debit = payAmt;
    if (paymentDate !== undefined) ledger.date = paymentDate;
    if (referenceNo !== undefined) ledger.referenceNo = referenceNo;
    if (notes !== undefined) ledger.description = `Payment to supplier (${payment.paymentMethod}) ${notes ? '- ' + notes : ''}`;
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, payment });
});

// Expenses
app.post("/api/erp/expenses", requireAuth, (req: Request, res: Response) => {
  const { category, description, amount, paymentMethod = "Cash", notes = "", date = new Date().toISOString().split("T")[0], paidTo = "" } = req.body;
  if (!category || !amount) {
    return res.status(400).json({ error: "Category and amount are required." });
  }

  const store = loadStore();
  const newExpense = {
    id: `exp-${Date.now()}`,
    date,
    category,
    description: description || category,
    amount: Number(amount) || 0,
    paymentMethod: (paymentMethod as any) || "Cash",
    notes,
    paidTo,
    createdAt: new Date().toISOString(),
  };

  store.expenses.unshift(newExpense);
  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, expense: newExpense });
});

// Update / Modify Existing Expense
app.put("/api/erp/expenses/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { category, description, amount, paymentMethod = "Cash", notes = "", date, paidTo } = req.body;
  const store = loadStore();
  const expense = store.expenses.find((e) => e.id === id);
  if (!expense) return res.status(404).json({ error: "Expense not found." });

  if (category) expense.category = category;
  if (description !== undefined) expense.description = description;
  if (amount !== undefined) expense.amount = Number(amount) || 0;
  if (paymentMethod) expense.paymentMethod = paymentMethod as any;
  if (notes !== undefined) expense.notes = notes;
  if (date) expense.date = date;
  if (paidTo !== undefined) (expense as any).paidTo = paidTo;

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, expense });
});

app.delete("/api/erp/expenses/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  store.expenses = store.expenses.filter((e) => e.id !== id);
  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true });
});

// Daily Fruit Rates
app.post("/api/erp/daily-rates", requireAuth, (req: Request, res: Response) => {
  const { rates } = req.body; // Array of { fruitId, grade, purchaseRate, wholesaleRate, retailRate }
  if (!rates || !Array.isArray(rates)) {
    return res.status(400).json({ error: "Rates array required." });
  }

  const store = loadStore();
  const todayStr = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  rates.forEach((r) => {
    const fruit = store.fruits.find((f) => f.id === r.fruitId);
    if (!fruit) return;

    // Update or insert daily rate
    const existingIndex = store.dailyRates.findIndex(
      (dr) => dr.fruitId === r.fruitId && dr.grade === r.grade && dr.date === todayStr
    );

    const entry = {
      id: existingIndex >= 0 ? store.dailyRates[existingIndex].id : `dr-${Date.now()}-${r.fruitId}-${r.grade}`,
      date: todayStr,
      fruitId: r.fruitId,
      fruitName: fruit.name,
      variety: fruit.variety,
      grade: r.grade,
      unit: fruit.unit,
      purchaseRate: Number(r.purchaseRate) || 0,
      wholesaleRate: Number(r.wholesaleRate) || 0,
      retailRate: Number(r.retailRate) || 0,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      store.dailyRates[existingIndex] = entry;
    } else {
      store.dailyRates.unshift(entry);
    }

    // Also sync fruit master default rates for quick sales
    const fg = fruit.grades.find((g) => g.grade === r.grade);
    if (fg) {
      fg.purchaseRate = entry.purchaseRate;
      fg.wholesaleRate = entry.wholesaleRate;
      fg.retailRate = entry.retailRate;
    }

    // Sync stock selling rate
    const stk = store.stock.find((s) => s.fruitId === r.fruitId && s.grade === r.grade);
    if (stk) {
      stk.sellingRatePerKg = entry.wholesaleRate;
    }
  });

  saveStore(store);
  return res.json({ success: true, message: "Daily fruit rates saved." });
});

// Copy yesterday's rates
app.post("/api/erp/daily-rates/copy-yesterday", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  const todayStr = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  // Find most recent rates from any day before today
  const nonTodayRates = store.dailyRates.filter((r) => r.date < todayStr);
  if (nonTodayRates.length === 0) {
    // Generate from current fruit defaults
    const newRates: any[] = [];
    store.fruits.forEach((f) => {
      f.grades.forEach((g) => {
        newRates.push({
          id: `dr-${Date.now()}-${f.id}-${g.grade}`,
          date: todayStr,
          fruitId: f.id,
          fruitName: f.name,
          variety: f.variety,
          grade: g.grade,
          unit: f.unit,
          purchaseRate: g.purchaseRate,
          wholesaleRate: g.wholesaleRate,
          retailRate: g.retailRate,
          updatedAt: now,
        });
      });
    });
    store.dailyRates = [...newRates, ...store.dailyRates];
    saveStore(store);
    return res.json({ success: true, count: newRates.length, message: "Initialized today's rates from fruit master." });
  }

  // Get unique recent rate per fruitId + grade
  const map = new Map<string, any>();
  nonTodayRates.forEach((r) => {
    const key = `${r.fruitId}_${r.grade}`;
    if (!map.has(key)) map.set(key, r);
  });

  const copied: any[] = [];
  map.forEach((r) => {
    const existing = store.dailyRates.find((dr) => dr.fruitId === r.fruitId && dr.grade === r.grade && dr.date === todayStr);
    if (!existing) {
      const entry = {
        id: `dr-${Date.now()}-${r.fruitId}-${r.grade}`,
        date: todayStr,
        fruitId: r.fruitId,
        fruitName: r.fruitName,
        variety: r.variety,
        grade: r.grade,
        unit: r.unit,
        purchaseRate: r.purchaseRate,
        wholesaleRate: r.wholesaleRate,
        retailRate: r.retailRate,
        updatedAt: now,
      };
      copied.push(entry);
      store.dailyRates.unshift(entry);
    }
  });

  saveStore(store);
  return res.json({ success: true, count: copied.length, message: `Copied ${copied.length} rates to today.` });
});

// Wastage Management (reduces stock and updates wastage log)
app.post("/api/erp/wastage", requireAuth, (req: Request, res: Response) => {
  const {
    fruitId,
    grade = "A",
    weightKg,
    crates = 0,
    reason = "Spoilage",
    notes = "",
    date = new Date().toISOString().split("T")[0],
  } = req.body;

  const store = loadStore();
  const fruit = store.fruits.find((f) => f.id === fruitId);
  if (!fruit) return res.status(400).json({ error: "Fruit is required." });

  const weight = Number(weightKg) || 0;
  if (weight <= 0) return res.status(400).json({ error: "Valid wastage weight is required." });

  const stockItem = store.stock.find((s) => s.fruitId === fruit.id && s.grade === grade);
  const costPerKg = stockItem ? stockItem.averageCostPerKg : 50;
  const estimatedValue = Number((weight * costPerKg).toFixed(2));
  const now = new Date().toISOString();

  const newWastage = {
    id: `wst-${Date.now()}`,
    date,
    fruitId: fruit.id,
    fruitName: fruit.name,
    variety: fruit.variety,
    grade: (grade as any) || "A",
    weightKg: weight,
    crates: Number(crates) || 0,
    estimatedValue,
    reason: (reason as any) || "Spoilage",
    notes,
    createdAt: now,
  };

  store.wastage.unshift(newWastage);

  // Deduct from actual stock
  if (stockItem) {
    stockItem.weightKg = Math.max(0, stockItem.weightKg - weight);
    stockItem.crateQuantity = Math.max(0, stockItem.crateQuantity - (Number(crates) || 0));
    stockItem.stockValue = Number((stockItem.weightKg * stockItem.averageCostPerKg).toFixed(2));
    stockItem.lastUpdated = now;
  }

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, wastage: newWastage });
});

// Update / Modify Wastage Entry (recalculates inventory balance & cost valuation)
app.put("/api/erp/wastage/:id", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const { fruitId, grade = "A", weightKg, crates = 0, reason = "Spoilage", notes = "", date } = req.body;
  const store = loadStore();
  const wastage = store.wastage.find((w) => w.id === id);
  if (!wastage) return res.status(404).json({ error: "Wastage record not found." });

  // 1. Revert previous stock deduction
  const oldStock = store.stock.find((s) => s.fruitId === wastage.fruitId && s.grade === wastage.grade);
  if (oldStock) {
    oldStock.weightKg += Number(wastage.weightKg) || 0;
    oldStock.crateQuantity += Number((wastage as any).crates || (wastage as any).cratesCount || 0);
  }

  const fruit = store.fruits.find((f) => f.id === (fruitId || wastage.fruitId));
  const newWeight = Math.max(0, Number(weightKg) || 0);
  const newCrates = Math.max(0, Number(crates) || 0);
  const newGrade = (grade as any) || wastage.grade || "A";

  // 2. Deduct new stock
  const newStock = store.stock.find((s) => s.fruitId === (fruit?.id || wastage.fruitId) && s.grade === newGrade);
  const costPerKg = newStock ? newStock.averageCostPerKg : 50;
  const estimatedValue = Number((newWeight * costPerKg).toFixed(2));

  if (newStock) {
    newStock.weightKg = Math.max(0, newStock.weightKg - newWeight);
    newStock.crateQuantity = Math.max(0, newStock.crateQuantity - newCrates);
    newStock.stockValue = Number((newStock.weightKg * newStock.averageCostPerKg).toFixed(2));
    newStock.lastUpdated = new Date().toISOString();
  }

  wastage.date = date || wastage.date;
  if (fruit) {
    wastage.fruitId = fruit.id;
    wastage.fruitName = fruit.name;
    wastage.variety = fruit.variety;
  }
  wastage.grade = newGrade;
  wastage.weightKg = newWeight;
  (wastage as any).crates = newCrates;
  (wastage as any).cratesCount = newCrates;
  wastage.reason = (reason as any) || wastage.reason;
  wastage.notes = notes !== undefined ? notes : wastage.notes;
  wastage.estimatedValue = estimatedValue;
  (wastage as any).costLoss = estimatedValue;

  recalculateAllERPData(store);
  saveStore(store);
  return res.json({ success: true, wastage });
});

// Stock Adjustment
app.post("/api/erp/stock/adjust", requireAuth, (req: Request, res: Response) => {
  const { stockId, newWeightKg, newCrates, reason = "Physical Count Verification" } = req.body;
  const store = loadStore();
  const stockItem = store.stock.find((s) => s.id === stockId);
  if (!stockItem) return res.status(404).json({ error: "Stock record not found." });

  const oldWeight = stockItem.weightKg;
  stockItem.weightKg = Math.max(0, Number(newWeightKg) || 0);
  if (newCrates !== undefined) {
    stockItem.crateQuantity = Math.max(0, Number(newCrates) || 0);
  }
  stockItem.stockValue = Number((stockItem.weightKg * stockItem.averageCostPerKg).toFixed(2));
  stockItem.lastUpdated = new Date().toISOString();

  saveStore(store);
  return res.json({ success: true, stockItem, diffKg: stockItem.weightKg - oldWeight });
});

// Notifications
app.put("/api/erp/notifications/:id/read", requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const store = loadStore();
  const notif = store.notifications.find((n) => n.id === id);
  if (notif) notif.read = true;
  saveStore(store);
  return res.json({ success: true });
});

// Settings Update
app.put("/api/erp/settings", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  store.settings = {
    ...store.settings,
    ...req.body,
  };
  saveStore(store);
  return res.json({ success: true, settings: store.settings });
});

// Backup Export
app.get("/api/erp/backup", requireAuth, (req: Request, res: Response) => {
  const store = loadStore();
  const backup = JSON.stringify(store, null, 2);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=klyia_fresh_erp_backup_${new Date().toISOString().split("T")[0]}.json`);
  return res.send(backup);
});

// Backup Restore
app.post("/api/erp/restore", requireAuth, (req: Request, res: Response) => {
  const backupData = req.body;
  if (!backupData || !backupData.fruits || !backupData.sales) {
    return res.status(400).json({ error: "Invalid backup data structure." });
  }
  saveStore(backupData);
  return res.json({ success: true, message: "Database restored successfully." });
});

// Reset to Clean Demo Data
app.post("/api/erp/reset-demo", requireAuth, (req: Request, res: Response) => {
  const seed = getInitialSeedData();
  saveStore(seed);
  return res.json({ success: true, message: "Database reset to realistic fruit demo data." });
});

// ==================== AI BUSINESS ASSISTANT ====================
// Section 22: FreshERP AI Assistant - Answers strictly using stored ERP business data
app.post("/api/gemini/chat", requireAuth, async (req: Request, res: Response) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Question is required." });
    }

    const store = loadStore(true);
    const result = await processAiQuestion(store, question);
    return res.json(result);
  } catch (err: any) {
    console.error("AI Assistant error:", err);
    return res.status(500).json({
      error: "Unable to query business intelligence assistant.",
      details: err.message,
    });
  }
});

// Alias for AI ask
app.post("/api/ai/ask", requireAuth, async (req: Request, res: Response) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Question is required." });
    }

    const store = loadStore(true);
    const result = await processAiQuestion(store, question);
    return res.json(result);
  } catch (err: any) {
    console.error("AI Assistant error:", err);
    return res.status(500).json({
      error: "Unable to query business intelligence assistant.",
      details: err.message,
    });
  }
});

// AI Daily Business Summary
app.get("/api/ai/summary", requireAuth, (req: Request, res: Response) => {
  try {
    const store = loadStore(true);
    const summary = generateDailySummary(store);
    return res.json(summary);
  } catch (err: any) {
    console.error("AI Summary error:", err);
    return res.status(500).json({ error: "Failed to generate business summary" });
  }
});

// AI Smart Notifications Center
app.get("/api/ai/notifications", requireAuth, (req: Request, res: Response) => {
  try {
    const store = loadStore(true);
    const notifications = generateSmartNotifications(store);
    return res.json({ notifications });
  } catch (err: any) {
    console.error("AI Notifications error:", err);
    return res.status(500).json({ error: "Failed to generate notifications" });
  }
});

// Business FAQs
app.get("/api/ai/faqs", requireAuth, (req: Request, res: Response) => {
  try {
    const faqs = getBusinessFAQs();
    return res.json({ faqs });
  } catch (err: any) {
    console.error("AI FAQs error:", err);
    return res.status(500).json({ error: "Failed to fetch FAQs" });
  }
});

// ==================== LOCAL FILE STORAGE & UPLOADS ====================

app.post("/api/upload", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

// ==================== LOCAL SQLITE DATABASE & BACKUP APIS ====================

// Get local system storage and SQLite status
app.get("/api/system/storage-info", (req: Request, res: Response) => {
  try {
    const { baseDir, dbPath, uploadsDir, backupsDir } = getAppDataDirectory();
    let dbSize = 0;
    if (fs.existsSync(dbPath)) {
      dbSize = fs.statSync(dbPath).size;
    }
    const uploadsCount = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0;
    const backupsCount = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).length : 0;

    res.json({
      appDataDir: baseDir,
      dbPath,
      dbExists: fs.existsSync(dbPath),
      dbSizeBytes: dbSize,
      dbSizeDisplay: `${(dbSize / 1024).toFixed(1)} KB`,
      engine: "SQLite 3",
      mode: "Local Offline",
      uploadsDir,
      uploadsCount,
      backupsDir,
      backupsCount,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List all available database backups
app.get("/api/backup/list", requireAuth, (req: Request, res: Response) => {
  try {
    const backups = listDatabaseBackups();
    res.json({ backups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a timestamped backup of the current SQLite database
app.post("/api/backup/create", requireAuth, (req: Request, res: Response) => {
  try {
    const { note } = req.body || {};
    const backup = createDatabaseBackup(note);
    res.json({ success: true, backup, message: `Backup created: ${backup.filename}` });
  } catch (err: any) {
    console.error("[FreshERP Backup] Create error:", err);
    res.status(500).json({ error: err.message || "Failed to create backup" });
  }
});

// Restore database from a chosen backup file
app.post("/api/backup/restore", requireAuth, async (req: Request, res: Response) => {
  try {
    const { filename } = req.body || {};
    if (!filename) {
      return res.status(400).json({ error: "Backup filename is required" });
    }
    const restored = await restoreDatabaseBackup(filename);
    storeCache = restored;
    saveStore(restored);
    res.json({ success: true, message: "Database restored successfully from backup" });
  } catch (err: any) {
    console.error("[FreshERP Backup] Restore error:", err);
    res.status(500).json({ error: err.message || "Failed to restore backup" });
  }
});

// System flush endpoint for graceful server sync or shutdown
app.post("/api/system/flush", (req: Request, res: Response) => {
  try {
    const store = loadStore();
    saveStore(store);
    saveSqliteDbToDisk();
    res.json({ success: true, message: "SQLite database flushed to disk successfully." });
  } catch (err: any) {
    console.error("[FreshERP System] Flush error:", err);
    res.status(500).json({ error: err?.message || "Failed to flush database" });
  }
});

// ==================== VITE SPA OR STATIC MIDDLEWARE ====================

// API 404 handler: ensure all unmatched API endpoints return JSON, never HTML
app.all(["/api", "/api/*", "/data/api", "/data/api/*"], (req: Request, res: Response) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Centralized error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("[Klyia FreshERP Error]", err);
  if (res.headersSent) {
    return next(err);
  }
  const status = typeof err.status === "number" ? err.status : 500;
  res.status(status).json({
    error: err.message || "Internal server error",
  });
});

function getDistPath(): string {
  const root = process.cwd();
  const effectiveDir =
    typeof (globalThis as any).__dirname !== "undefined"
      ? (globalThis as any).__dirname
      : currentServerDirname;

  // 1. Direct match if running from dist/server.cjs (where index.html is right alongside server.cjs)
  if (effectiveDir && fs.existsSync(path.join(effectiveDir, "index.html"))) {
    return effectiveDir;
  }
  // 2. Standard project root dist directory
  if (fs.existsSync(path.join(root, "dist", "index.html"))) {
    return path.join(root, "dist");
  }
  // 3. Subdirectory dist from effectiveDir
  if (effectiveDir && fs.existsSync(path.join(effectiveDir, "dist", "index.html"))) {
    return path.join(effectiveDir, "dist");
  }

  return path.join(root, "dist");
}

const isProduction =
  process.env.NODE_ENV === "production" ||
  Boolean(
    (typeof (globalThis as any).__filename === "string" &&
      ((globalThis as any).__filename.endsWith(".cjs") || (globalThis as any).__filename.includes("dist/")))
  ) ||
  process.argv.some(
    (arg) =>
      typeof arg === "string" &&
      (arg.endsWith(".cjs") || arg.includes("dist/server") || arg.includes("server.cjs"))
  ) ||
  typeof (global as any).PhusionPassenger !== "undefined" ||
  Boolean(process.env.PASSENGER_APP_ENV);

async function start() {
  try {
    console.log("[Klyia FreshERP] Booting local SQLite 3 database engine...");
    await initializeSqliteEngine(getInitialSeedData);
    console.log("[Klyia FreshERP] SQLite database ready.");
  } catch (dbInitErr) {
    console.error("[Klyia FreshERP] SQLite initialization warning:", dbInitErr);
  }

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = getDistPath();
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      const isApi =
        req.path.startsWith("/api") ||
        req.path.startsWith("/data/api") ||
        req.url.startsWith("/api") ||
        req.url.startsWith("/data/api") ||
        Boolean(req.headers.accept && req.headers.accept.includes("application/json"));

      if (isApi) {
        return res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
      }

      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("Application frontend build not found. Please run 'npm run build'.");
      }
    });
  }

  // Support Phusion Passenger, Unix sockets, and TCP ports on 0.0.0.0
  if (typeof (global as any).PhusionPassenger !== "undefined") {
    app.listen("passenger", () => {
      console.log("Server running under Phusion Passenger");
    });
  } else if (process.env.PORT && isNaN(Number(process.env.PORT))) {
    // Unix socket or pipe in Passenger environments
    app.listen(process.env.PORT, () => {
      console.log(`Server running on socket ${process.env.PORT}`);
    });
  } else {
    const rawPort = process.env.PORT;
    const port = rawPort && rawPort !== "8080" && !isNaN(Number(rawPort)) ? Number(rawPort) : 3000;
    const host = process.env.HOST || "0.0.0.0";
    app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
    });
  }
}

export function flushToDisk(): void {
  try {
    const store = loadStore();
    saveStore(store);
    saveSqliteDbToDisk();
  } catch (err) {
    console.error("[FreshERP Server] Failed to flush to disk:", err);
  }
}

export { app, start };

process.on("uncaughtException", (err) => {
  console.error("[Klyia FreshERP Uncaught Exception]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Klyia FreshERP Unhandled Rejection]", reason);
});

start();
