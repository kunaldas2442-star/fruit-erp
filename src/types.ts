export type FruitGradeType = 'A' | 'B' | 'C' | 'Damaged';
export type UnitType = 'KG' | 'Crate' | 'Bag' | 'Dozen' | 'Box' | string;
export type PaymentMethodType = 'Cash' | 'UPI' | 'Bank' | 'Credit' | 'Cheque';
export type ExpenseCategoryType = 
  | 'Transport' 
  | 'Labour' 
  | 'Packaging' 
  | 'Rent' 
  | 'Electricity' 
  | 'Loading/Unloading' 
  | 'Commission' 
  | 'Fuel' 
  | 'Maintenance' 
  | 'Other';

export type WastageReasonType = 
  | 'Damaged' 
  | 'Rotten' 
  | 'Overripe' 
  | 'Spoilage' 
  | 'Handling Loss' 
  | 'Other';

export type NavigationSection =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'stock'
  | 'customers'
  | 'suppliers'
  | 'fruits'
  | 'rates'
  | 'expenses'
  | 'wastage'
  | 'reports'
  | 'settings';

export interface UserSession {
  username: string;
  role: 'admin';
  mustChangePassword: boolean;
  token: string;
  loginTime: number;
}

export interface BusinessSettings {
  businessName: string;
  shortName?: string;
  tagline?: string;
  ownerName: string;
  phone: string;
  phone1?: string;
  phone2?: string;
  phone2Label?: string;
  phone3?: string;
  phone3Label?: string;
  email?: string;
  address: string;
  city: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  gstin?: string;
  upiId?: string;
  bankDetails?: string;
  currency?: string;
  invoicePrefix?: string;
  invoiceTerms?: string;
  whatsappGreeting?: string;
  sessionTimeoutMinutes?: number;
  logoUrl?: string;
  emblemUrl?: string;
}

export interface FruitGradeRate {
  grade: FruitGradeType;
  purchaseRate: number;
  wholesaleRate: number;
  retailRate: number;
  currentStockKg?: number;
}

export type FruitGradePrice = FruitGradeRate;

export interface CompanyBillProfile {
  id: string;
  companyName: string;
  tradeName?: string;
  logo?: string;
  address: string;
  gstin?: string;
  pan?: string;
  phone: string;
  email?: string;
  website?: string;
  bankDetails?: string;
  upi?: string;
  termsConditions?: string;
  signature?: string;
  authorizedPerson?: string;
  isActive: boolean;
  isDefault?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface FruitItem {
  id: string;
  name: string;
  shortName?: string;
  productCode?: string;
  code?: string;
  category: string;
  variety: string;
  unit: UnitType;
  defaultRate?: number;
  gstRate?: number;
  hsnSac?: string;
  hsn?: string;
  description?: string;
  grades: FruitGradeRate[];
  minStock: number;
  minStockAlertKg?: number;
  supplierId?: string;
  image?: string;
  photoUrl?: string;
  imageUrl?: string;
  customIconUrl?: string;
  avatarIcon?: string;
  defaultIcon?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt?: string;
}

export type Fruit = FruitItem;

export interface StockRecord {
  id: string;
  fruitId: string;
  fruitName: string;
  variety: string;
  grade: FruitGradeType;
  unit: UnitType;
  crateQuantity: number;
  cratesCount?: number;
  weightKg: number;
  purchaseCostPerKg: number;
  averageCostPerKg: number;
  sellingRatePerKg: number;
  stockValue: number;
  lastUpdated: string;
}

export type StockItem = StockRecord;

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email?: string;
  address: string;
  city?: string;
  state?: string;
  bankDetails?: string;
  gstNumber?: string;
  openingBalance?: number;
  notes?: string;
  totalPurchases: number;
  paymentsMade?: number;
  totalPaid?: number;
  outstandingPayable: number;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  businessName: string;
  contactPerson?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  address: string;
  city: string;
  state?: string;
  gstNumber?: string;
  gstin?: string;
  aadhaarNumber?: string;
  aadhaar?: string;
  pan?: string;
  type?: string;
  creditLimit: number;
  creditPeriodDays?: number;
  openingBalance: number;
  notes?: string;
  totalPurchases: number;
  totalPayments?: number;
  totalPaid?: number;
  outstandingBalance: number;
  lastTransactionDate?: string;
  createdAt: string;
  photoUrl?: string;
  avatarIcon?: string;
  customIconUrl?: string;
}

export interface PurchaseItem {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  fruitId: string;
  fruitName: string;
  variety: string;
  grade: FruitGradeType;
  crateQuantity: number;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  netWeightKg?: number;
  purchaseRate: number;
  purchaseValue: number;
  transportCost: number;
  commission: number;
  commissionCost?: number;
  otherCost: number;
  totalCost: number;
  totalAmount?: number;
  effectiveCostPerKg: number;
  paymentStatus: 'Paid' | 'Partial' | 'Credit' | 'paid' | 'partial' | 'credit';
  paidAmount: number;
  dueAmount: number;
  notes: string;
  createdAt: string;
}

export type Purchase = PurchaseItem;

export interface SaleItem {
  id: string;
  fruitId: string;
  fruitName: string;
  fruitCode?: string;
  fruitIcon?: string;
  photoUrl?: string;
  customIconUrl?: string;
  avatarIcon?: string;
  variety?: string;
  grade?: FruitGradeType | string;
  unit?: UnitType | string;
  quantity?: string | number;
  crates?: number;
  weightKg?: number;
  ratePerKg?: number;
  rate?: number;
  discount?: number;
  total: number;
  totalPrice?: number;
  amount?: number;
  costPricePerKg?: number;
  gstRate?: number;
  hsn?: string;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  saleDate: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerBusiness?: string;
  customerType?: string;
  companyProfileId?: string;
  companySnapshot?: CompanyBillProfile;
  items: SaleItem[];
  subtotal: number;
  total?: number;
  expense?: number;
  discount: number;
  netTotal?: number;
  grandTotal: number;
  totalAmount?: number;
  oldBalance?: number;
  totalBalance?: number;
  balanceCrates?: number;
  weightPerCrate?: string | number;
  paymentMethod: PaymentMethodType;
  paymentStatus?: 'Paid' | 'Partial' | 'Credit' | 'paid' | 'partial' | 'credit';
  paidAmount: number;
  dueAmount: number;
  balanceDue?: number;
  notes: string;
  status: 'Completed' | 'Cancelled';
  createdAt: string;
}

export interface CustomerLedgerEntry {
  id: string;
  customerId: string;
  date: string;
  type: 'Sale' | 'Payment' | 'Opening' | 'Adjustment' | 'sale' | 'payment';
  referenceId: string;
  referenceNo?: string;
  description?: string;
  notes?: string;
  debit: number;
  credit: number;
  balance: number;
  createdAt?: string;
}

export interface SupplierLedgerEntry {
  id: string;
  supplierId: string;
  date: string;
  type: 'Purchase' | 'Payment' | 'Opening' | 'Adjustment' | 'purchase' | 'payment';
  referenceId: string;
  referenceNo?: string;
  description?: string;
  notes?: string;
  debit: number;
  credit: number;
  balance: number;
  createdAt?: string;
}

export interface SupplierPayment {
  id: string;
  paymentDate: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  paymentMethod: PaymentMethodType;
  referenceNo: string;
  notes: string;
  createdAt: string;
}

export interface CustomerPayment {
  id: string;
  paymentDate: string;
  customerId: string;
  customerName: string;
  amount: number;
  paymentMethod: PaymentMethodType;
  referenceNo: string;
  notes: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  date: string;
  category: ExpenseCategoryType | string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethodType | string;
  paidTo?: string;
  notes: string;
  createdAt: string;
}

export interface DailyRateEntry {
  id: string;
  date: string;
  fruitId: string;
  fruitName: string;
  variety: string;
  grade: FruitGradeType;
  unit: UnitType;
  purchaseRate: number;
  wholesaleRate: number;
  retailRate: number;
  updatedAt: string;
}

export type DailyRate = DailyRateEntry;

export interface WastageEntry {
  id: string;
  date: string;
  fruitId: string;
  fruitName: string;
  variety: string;
  grade: FruitGradeType;
  weightKg: number;
  crates: number;
  cratesCount?: number;
  estimatedValue: number;
  costLoss?: number;
  lossAmount?: number;
  reason: WastageReasonType | string;
  notes: string;
  createdAt: string;
}

export type Wastage = WastageEntry;

export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type NotificationCategory =
  | 'LOW STOCK'
  | 'PAYMENT FOLLOW-UP'
  | 'OVERDUE CUSTOMER'
  | 'HIGH WASTAGE'
  | 'HIGH EXPENSE'
  | 'LOW PROFIT'
  | 'FAST SELLING FRUIT'
  | 'SLOW MOVING FRUIT'
  | 'PURCHASE SUGGESTION'
  | 'RATE CHANGE'
  | 'CREDIT LIMIT WARNING'
  | 'payment_overdue'
  | string;

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  severity: 'info' | 'warning' | 'error';
  date: string;
  read: boolean;
  linkSection?: string;
  actionLabel?: string;
  actionType?: 'view_khata' | 'whatsapp' | 'view_stock' | 'create_purchase' | 'view_report' | 'view_customer' | 'view_supplier' | 'record_payment';
  actionTargetId?: string;
  actionData?: any;
}

export interface AiActionButton {
  label: string;
  action: 'view_khata' | 'whatsapp' | 'view_customer' | 'view_stock' | 'create_purchase' | 'view_report' | 'view_supplier' | 'record_payment';
  targetId?: string;
  data?: any;
}

export interface AiKeyMetric {
  label: string;
  value: string;
  badge?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface AiResponse {
  answer: string;
  intent: string;
  category?: string;
  keyMetrics?: AiKeyMetric[];
  structuredData?: {
    type: 'customer_khata' | 'customer_list' | 'stock_list' | 'purchase_suggestion' | 'sales_summary' | 'profit_summary' | 'wastage_summary' | 'expense_summary' | 'general' | 'supplier_list';
    items?: any[];
  };
  recommendation?: string;
  actions?: AiActionButton[];
  source?: 'gemini' | 'calculated_erp';
}

export interface AiDailySummary {
  date: string;
  greeting: string;
  headline: string;
  sales: number;
  purchase: number;
  expenses: number;
  estimatedProfit: number;
  attentionPoints: {
    id: string;
    icon: string;
    text: string;
    highlight?: string;
    actionLabel?: string;
    action?: 'view_khata' | 'whatsapp' | 'view_stock' | 'create_purchase';
    targetId?: string;
  }[];
  suggestion: string;
}

export interface BusinessFAQ {
  id: string;
  question: string;
  questionHinglish?: string;
  category: 'Sales' | 'Purchase' | 'Khata' | 'Stock' | 'Profit' | 'Operations';
  shortAnswer: string;
  steps: string[];
  sampleQuery: string;
}

export interface ERPDataStore {
  user: {
    username: string;
    passwordHash: string;
    salt: string;
    mustChangePassword: boolean;
    lastLogin?: string;
    hasDashboardPin?: boolean;
    dashboardPinHash?: string;
    dashboardPinSalt?: string;
  };
  settings: BusinessSettings;
  companyProfiles?: CompanyBillProfile[];
  fruits: FruitItem[];
  stock: StockRecord[];
  suppliers: Supplier[];
  customers: Customer[];
  purchases: PurchaseItem[];
  sales: Sale[];
  customerLedger: CustomerLedgerEntry[];
  supplierLedger: SupplierLedgerEntry[];
  supplierPayments: SupplierPayment[];
  customerPayments: CustomerPayment[];
  expenses: Expense[];
  dailyRates: DailyRateEntry[];
  wastage: WastageEntry[];
  notifications: AppNotification[];
}
