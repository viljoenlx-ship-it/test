# Modular_ERP_Operations_Map_v7 (Liam's blueprint, exported from Google Sheets 2026-11-19)

Each section is one tab, as CSV.

## 1. Departments & Modules

```csv
MODULAR ERP ARCHITECTURE — DEPARTMENTS & SUB-MODULES (36 MODULES)
Complete functional breakdown across 8 domains. Color key: Teal = Statutory/Compliance | Purple = HR Welfare & Doc Gen | Amber = Universal Real-World Operations

Domain / Department,Module ID,Sub-Module Name,Architectural Tier,Core Entities Tracked,Key Workflows & Capabilities,Downstream Integrations
1. Core Kernel & Governance,KRN-01,"Identity, Users & Zero-Trust RBAC",Tier 1: Kernel,"Users, Roles, Granular Permissions, Approval Limits, Audit Trail","User onboarding, role assignment, field-level masking, immutable action logging",All Modules
1. Core Kernel & Governance,KRN-02,Unified Party Directory,Tier 1: Kernel,"Customers, Suppliers, Employees, Contractors, Leads, Contacts","Single party master where one entity can act as customer, supplier, and staff","Sales, Procurement, HR, Portals"
1. Core Kernel & Governance,KRN-03,Multi-Branch & Inter-Company Structure,Tier 1: Kernel,"Legal Entities, Branches, Warehouses, Cost Centres, Inter-Company Accounts","Branch isolation, inter-branch stock transfers, consolidated vs branch P&L","Inventory, Finance, POS, Reporting"
1. Core Kernel & Governance,KRN-04,"Custom Fields, State Machines & Workflows",Tier 1: Kernel,"Dynamic Schemas, Custom Pipelines, No-Code Automation Rules, Notifications","Tenant-defined statuses, conditional triggers, automated task/alert routing",All Modules
1. Core Kernel & Governance,KRN-05,External Self-Service Portals,Tier 1: Kernel,"Customer Portal Sessions, Supplier RFQ Submissions, Magic Links",Customers download statements/invoices & approve quotes; suppliers upload B-BBEE & quotes,"Debtors, Sales, Procurement, Support"
1. Core Kernel & Governance,KRN-06,Data Migration & No-Lock-In Engine,Tier 1: Kernel,"Import Templates, Column Mappings, Deduplication Logs, Opening Balances",Guided CSV/Excel migration from Pastel/Sage/QuickBooks & 1-click full data export,All Master & Ledger Modules
2. Finance & Accounting,FIN-01,General Ledger & Chart of Accounts,Tier 2: Commercial Core,"Accounts, Journals, Fiscal Periods, Multi-Currency Rates, Trial Balance","Automated double-entry posting from every operational event, period locks",All Financial & Operational Modules
2. Finance & Accounting,FIN-02,Debtors (Accounts Receivable),Tier 2: Commercial Core,"Customer Invoices, Credit Notes, Receipts, Age Analysis, Statements","Automated invoice generation, payment allocation, overdue reminders, credit holds","Sales, POS, Rentals, Portals, GL"
2. Finance & Accounting,FIN-03,Creditors (Accounts Payable),Tier 2: Commercial Core,"Supplier Bills, Debit Notes, Payment Batches, Remittance Advices","3-way matching (PO vs GRN vs Bill), early settlement tracking, EFT batch export","Procurement, Inventory, B-BBEE, GL"
2. Finance & Accounting,FIN-04,"Cashbook, Bank Feeds & Reconciliation",Tier 2: Commercial Core,"Bank Accounts, Statement Imports, Matching Rules, Cash Flow Forecast","Auto-matching bank lines to debtors/creditors, split allocations, liquidity view","Debtors, Creditors, Petty Cash, GL"
2. Finance & Accounting,FIN-05,"Petty Cash, Till Floats & Expense Claims",Tier 2: Commercial Core,"Petty Cash Boxes, Till Floats, Employee Receipt Claims, Reimbursements","Mobile till-slip photo capture, manager approval workflow, payroll/GL payout","POS, Field Service, HR Payroll, GL"
2. Finance & Accounting,FIN-06,"Tax, VAT & Statutory Audit",Tier 2: Commercial Core,"VAT201 Returns, Tax Codes, Withholding Tax, Audit Logs","Input/output VAT calculation, tax period locking, SARS audit trail export","Sales, Procurement, Fixed Assets, GL"
"3. Sales, CRM & Revenue",SAL-01,CRM Pipeline & Quotes,Tier 2: Commercial Core,"Leads, Opportunities, Quotes, Price Lists, Discount Rules","Lead tracking, tiered/customer-specific pricing, 1-click quote-to-order conversion","Party Directory, Inventory, Portals"
"3. Sales, CRM & Revenue",SAL-02,Sales Orders & Fulfilment,Tier 2: Commercial Core,"Sales Orders, Backorders, Picking Slips, Delivery Notes, PODs","Stock reservation, partial deliveries, digital Proof of Delivery capture, auto-invoicing","Inventory, Warehousing, Logistics, Debtors"
"3. Sales, CRM & Revenue",SAL-03,Point of Sale (POS) & Counter Sales,Tier 3: Operational,"POS Terminals, Cash-Up Shifts, Split Payments, Barcodes, Offline Queue","Walk-in barcode checkout, cash/card/EFT split tender, shift Z-reads, offline sync","Inventory, Debtors, Cashbook, Petty Cash"
"3. Sales, CRM & Revenue",SAL-04,"Recurring Billing, Subscriptions & Rentals",Tier 3: Operational,"Rental Contracts, Hired Serial Units, Meter Readings, Recurring Schedules","Automated monthly retainer/subscription runs, equipment hire deposits & return checks","Inventory, Assets, Debtors, Maintenance"
"3. Sales, CRM & Revenue",SAL-05,"Customer Support, Returns & Warranties",Tier 3: Operational,"Support Tickets, RMAs, Warranty Claims, SLA Timers","Issue logging, serial warranty lookup, credit note or replacement dispatch","Sales, Inventory, Maintenance, Portals"
4. Supply Chain & Stock,SCM-01,Universal Catalog & Inventory Ledger,Tier 2: Commercial Core,"Products, Services, Bundles, Serials/Batches, Expiry Dates, Valuation","Immutable stock movement ledger (FIFO/Weighted Avg), reorder alerts, multi-UOM","Sales, POS, Procurement, Manufacturing"
4. Supply Chain & Stock,SCM-02,Procurement & Supplier Management,Tier 2: Commercial Core,"Requisitions, RFQs, Purchase Orders, Supplier Price Books, B-BBEE Status","Min-stock auto-PO drafts, approval routing, supplier B-BBEE recognition tracking","Inventory, Creditors, B-BBEE, Portals"
4. Supply Chain & Stock,SCM-03,"Warehousing, Bins & Stocktakes",Tier 3: Operational,"Zones/Bins, Goods Received Notes (GRNs), Putaway, Cycle Counts","Barcode receiving, bin-level picking, blind stocktakes with variance posting","Inventory, Procurement, Sales, GL"
4. Supply Chain & Stock,SCM-04,"Logistics, Dispatch & Fleet Trips",Tier 3: Operational,"Delivery Runs, Waybills, Vehicle Loads, Fuel Logs, Route Manifests","Load consolidation, driver dispatch manifests, POD confirmation, fuel efficiency","Sales Orders, Assets, Petty Cash"
5. Production & Operations,OPS-01,Manufacturing & Bills of Materials (BOM),Tier 3: Operational,"Multi-Level BOMs, Work Orders, Routings, Raw Material Issue, Scrap","Component reservation, assembly/production runs, finished goods costing","Inventory, Warehousing, Quality, GL"
5. Production & Operations,OPS-02,Field Service & Job Costing,Tier 3: Operational,"Job Cards, Technician Dispatch, Site Timesheets, Job Materials, Margins","Tracks labour, parts, mileage & petty cash per job card for real-time job profit","Sales, Inventory, HR Time, Fleet, Debtors"
5. Production & Operations,OPS-03,Asset Register & Preventative Maintenance,Tier 3: Operational,"Fixed Assets, Equipment Meters, PM Schedules, Breakdown Tickets, Spares","Depreciation schedules, meter/time-based servicing, breakdown repair & spare issue","Inventory, Finance GL, Rentals, Fleet"
5. Production & Operations,OPS-04,Quality Assurance (QA) & Non-Conformance,Tier 3: Operational,"Inspection Checklists, Batch Test Results, NCRs, Corrective Actions","Incoming goods & production QA gates, quarantine stock holds, root-cause logs","Warehousing, Manufacturing, Procurement"
6. Human Resources,HRP-01,"Employee Master, Org Chart & Onboarding",Tier 4: Back-Office,"Employee Profiles, Reporting Lines, Job Grades, Onboarding Checklists","Central personnel file, probation tracking, automated asset/access provisioning","Party Directory, Kernel RBAC, IT Assets"
6. Human Resources,HRP-02,"Time, Attendance & Shift Rostering",Tier 4: Back-Office,"Shift Patterns, Clock-Ins, Overtime Rules, Leave Balances & Requests","Biometric/mobile clock-in, leave approval workflows, overtime calculation","Payroll, Field Service, Manufacturing"
6. Human Resources,HRP-03,Payroll Engine & Statutory Deductions,Tier 4: Back-Office,"Pay Runs, Payslips, PAYE, UIF, SDL, Garnishees, EFT Bank Files","Automated gross-to-net calculation, EMP201/EMP501 & IRP5 generation, GL posting","Time & Attendance, Welfare, Finance GL"
6. Human Resources,HRP-04,Personnel Document Generator,Tier 4: Back-Office,"BCEA Contract Templates, Warnings, Certificates of Service, E-Sign Links","Dynamic variable merge + conditional clauses, WhatsApp e-sign, auto-filing","Employee Master, Welfare, Kernel Docs"
6. Human Resources,HRP-05,Staff Welfare & Employee Assistance,Tier 4: Back-Office,"Encrypted EAP Notes, Staff Loans/Advances, OHSA Medicals, Grievances","Zero-trust counseling logs, auto-deducted staff loans, CCMA-ready disciplinary trail","Payroll, Finance GL, Doc Generator, HSE"
"7. Compliance, Risk & HSE",CMP-01,Employment Equity (EE) & B-BBEE,Tier 4: Back-Office,"EEA2/EEA4 Matrices, EE Numerical Goals, B-BBEE Scorecard, WSP/ATR Spend","Workforce demographic tracking, hiring gap alerts, preferential procurement calc","HR Master, Procurement, Creditors"
"7. Compliance, Risk & HSE",CMP-02,"COIDA, Labour Filings & POPIA Privacy",Tier 4: Back-Office,"COIDA W.As.8 Earnings, UI-19 Forms, POPIA Consents, Retention Rules","Annual COIDA return prep, auto UI-19 on exit, automated data anonymization","Payroll, Offboarding, Party Directory"
"7. Compliance, Risk & HSE",CMP-03,"Health, Safety (HSE) & Legal Contracts",Tier 4: Back-Office,"Incident/Near-Miss Logs, Risk Assessments, PPE Issues, Commercial SLAs","OHSA incident investigation, safety drill logs, contract renewal/expiry alerts","Inventory (PPE), Welfare, Procurement"
"8. Projects, IT & Analytics",ANA-01,Project Management & Milestones,Tier 4: Back-Office,"Projects, Tasks, Gantt Milestones, Resource Allocation, Project Budgets","Internal & client project delivery, task dependencies, budget vs actual tracking","Field Service, Time, Procurement, GL"
"8. Projects, IT & Analytics",ANA-02,"IT Assets, Software Licenses & Helpdesk",Tier 4: Back-Office,"Devices, SaaS Seats, License Renewals, Internal Support Tickets","Hardware custody assignment, seat reclamation on offboarding, internal IT tickets","Employee Master, Fixed Assets, Creditors"
"8. Projects, IT & Analytics",ANA-03,Executive Dashboards & Custom Report Builder,Tier 1: Kernel,"KPI Scorecards, Cross-Module Pivot Reports, Scheduled Email Digests","Role-based live dashboards, drill-down to source documents, automated PDF/CSV reports",All Modules
```

## 2. Cross-Module Flows

```csv
END-TO-END CROSS-MODULE OPERATIONAL FLOWS
How transactions move seamlessly across departments without duplicate data entry or tight code coupling.

Operational Lifecycle,Stage,Lifecycle Milestone,Primary Modules,Triggering Action / Event,Automated Cross-Module Impact & Records Created
1. Order-to-Cash (O2C),Step 1,Lead / Inquiry or Walk-In,SAL-01 / SAL-03,Customer requests quote via Portal/Sales OR walks up to POS counter,Party record created/matched; customer price list & credit limit checked
1. Order-to-Cash (O2C),Step 2,Quote Approval & Order,SAL-01 / SAL-02,Customer approves quote via Portal/WhatsApp OR POS scans items,Sales Order confirmed; available stock reserved in branch warehouse
1. Order-to-Cash (O2C),Step 3,"Pick, Pack & Dispatch",SCM-03 / SCM-04,Warehouse picks bins; Logistics assigns vehicle run & captures POD,Inventory ledger deducts stock; delivery note signed digitally on mobile
1. Order-to-Cash (O2C),Step 4,Invoicing & Revenue Posting,FIN-02 / FIN-01,Invoice issued on delivery/POS checkout (or monthly rental schedule),"Debtor balance increases; GL posts Revenue, VAT Output & Cost of Sales"
1. Order-to-Cash (O2C),Step 5,Payment & Bank Recon,FIN-04 / KRN-05,"Customer pays via EFT, card, cash, or Portal payment link",Receipt allocated to invoice; cashbook auto-reconciles bank statement line
2. Procure-to-Pay (P2P),Step 1,Demand & Requisition,SCM-01 / OPS-01,"Stock hits reorder point, Job Card needs parts, or staff submits request",Draft requisition/RFQ created with preferred suppliers & B-BBEE status visible
2. Procure-to-Pay (P2P),Step 2,RFQ & Purchase Order,SCM-02 / KRN-05,Suppliers submit quotes via Portal; manager approves PO per RBAC limits,Approved PO sent to supplier; expected stock on-order updated
2. Procure-to-Pay (P2P),Step 3,Goods Receipt & QA Check,SCM-03 / OPS-04,Warehouse scans delivered items on GRN; QA runs inspection checklist,Stock added to warehouse bins; faulty items quarantined & NCR logged
2. Procure-to-Pay (P2P),Step 4,3-Way Match & Supplier Bill,FIN-03 / CMP-01,Supplier invoice captured (or emailed to inbox) & matched to PO + GRN,Creditor balance updated; VAT Input & B-BBEE procurement spend logged
2. Procure-to-Pay (P2P),Step 5,EFT Batch & Remittance,FIN-03 / FIN-04,Approved bills grouped into bank payment batch on due date,EFT file exported; remittance advices emailed; GL clears Creditor account
3. Operations & Job Execution,Step 1,Job Card / Work Order Trigger,OPS-01 / OPS-02,"Sales Order, Rental return, or breakdown ticket spawns Job/Work Order","Required BOM materials, tools, and technician/machine slots scheduled"
3. Operations & Job Execution,Step 2,Material Issue & Site Dispatch,SCM-03 / SCM-04,Parts issued from store to Job Card/van; technician dispatched to site,Stock moves from Warehouse to Work-in-Progress (WIP) / Job Cost ledger
3. Operations & Job Execution,Step 3,"Time, Mileage & Petty Cash",HRP-02 / FIN-05,"Technician logs site hours, vehicle mileage, and emergency till-slip expenses","Labour cost, fleet cost & approved petty cash attach directly to Job Card"
3. Operations & Job Execution,Step 4,QA Sign-Off & Completion,OPS-04 / SAL-02,Customer signs digital Job Card on site OR finished goods pass final QA,Finished goods enter stock OR Job Card triggers final customer invoice with margin view
4. Hire-to-Retire & Welfare,Step 1,Requisition & EE Target Check,HRP-01 / CMP-01,Manager requests new hire; system flags Employment Equity demographic goals,Recruitment checklist checks EE plan alignment before offer approval
4. Hire-to-Retire & Welfare,Step 2,Contract Gen & WhatsApp E-Sign,HRP-04 / CMP-02,HR generates BCEA contract & POPIA consent with conditional clauses,Secure signing link sent via WhatsApp/email; signed PDF auto-filed to staff record
4. Hire-to-Retire & Welfare,Step 3,"Time, Welfare Loans & Payroll",HRP-02 / HRP-05,"Clock-ins, leave, overtime, and approved welfare loan installments compiled","Payroll calculates PAYE/UIF/SDL, deducts loan repayment, posts GL & EFT file"
4. Hire-to-Retire & Welfare,Step 4,"EE, COIDA & Statutory Filings",CMP-01 / CMP-02,Monthly/annual workforce & earnings data aggregated automatically,"EMP201, IRP5, EEA2/EEA4, WSP/ATR, and COIDA W.As.8 reports generated"
4. Hire-to-Retire & Welfare,Step 5,Offboarding & Exit Pack,HRP-04 / ANA-02,Termination/resignation state triggered on employee record,"System revokes IT access, reclaims assets, generates Certificate of Service & UI-19"
5. Acquire-to-Retire (Assets),Step 1,Asset Purchase & Capitalization,FIN-03 / OPS-03,Capital equipment/vehicle purchased via PO and supplier bill,"Fixed Asset tag created with depreciation rule, warranty, and branch custody"
5. Acquire-to-Retire (Assets),Step 2,"Deployment, Rental or Fleet Use",SAL-04 / SCM-04,"Asset assigned to employee, dispatched on delivery route, or hired to client",Odometer/hour meter readings updated; rental revenue or fleet cost tracked
5. Acquire-to-Retire (Assets),Step 3,Preventative & Breakdown Maint.,OPS-03 / SCM-01,Meter threshold or breakdown alert triggers Maintenance Work Order,Spare parts issued from stock; technician repair time & downtime logged to asset
5. Acquire-to-Retire (Assets),Step 4,Depreciation & Disposal,FIN-01 / OPS-03,Monthly depreciation runs automatically; end-of-life asset sold or scrapped,GL posts monthly depreciation; disposal calculates profit/loss on sale of asset
```

## 3. Core Data Abstractions

```csv
CORE DATA & DOMAIN ABSTRACTIONS (7 FOUNDATIONAL PATTERNS)
Design patterns that allow one modular codebase to adapt to any business vertical without custom forks.

Pattern ID,Architectural Abstraction,Structural Design Concept,Why It Solves 'Mundane' Real-World Edge Cases,Enabled Modules
ABS-01,Unified Party & Role Model,"Replaces separate Customer, Supplier, Employee, Lead & Contractor tables with one Party master","A single business or person can simultaneously be a customer, supplier, and contractor without duplicate records or split statements","KRN-02, SAL-01, SCM-02, HRP-01"
ABS-02,Universal Catalog & Ledger,"Models physical stock, serialized units, batches, services, rentals, and BOMs under one Item structure","Allows a single invoice or job card to mix physical parts, labour hours, and rental equipment seamlessly","SCM-01, SAL-02, OPS-01, OPS-02"
ABS-03,Unified Commercial Document Engine,"Treats Quotes, Orders, Delivery Notes, Invoices, POs, GRNs & Bills as state transitions of one header/line schema",Enables 1-click document conversion (Quote -> Order -> Invoice) and full upstream/downstream audit traceability,"SAL-01, SAL-02, SCM-02, FIN-02, FIN-03"
ABS-04,Zero-Code Custom Fields & Schemas,"Lets tenants attach typed custom attributes (text, dropdown, date, formula, lookup) to any entity","Solves mundane industry quirks (e.g., pallet dimensions, shoe sizes, vehicle VINs) without custom code",KRN-04 (All Modules)
ABS-05,Tenant-Defined State Machines,"Replaces hardcoded statuses with configurable pipelines, transition guards, and role permissions","Lets every company define its own approval stages for jobs, leave, maintenance tickets, or sales deals","KRN-04, OPS-02, OPS-03, HRP-05"
ABS-06,Multi-Entity & Branch Isolation,"Embeds Tenant ID, Legal Entity ID, and Branch ID across all transactional and ledger records",Supports single-shop businesses out of the box while scaling effortlessly to multi-branch groups,"KRN-03, FIN-01, SCM-01, SAL-03"
ABS-07,Conditional Document & Clause Engine,Merges live record variables and IF/ELSE clause blocks into branded PDFs with WhatsApp/email e-sign,"Eliminates manual Word editing for BCEA employment contracts, warnings, quotes, and rental agreements","HRP-04, SAL-01, SAL-04, CMP-03"
```

## 4. Daily Workflow Accelerators

```csv
DAILY WORKFLOW ACCELERATORS (12 HIGH-IMPACT UX SHORTCUTS)
Practical quality-of-life features rarely built into traditional ERPs that save staff hours every week.

Shortcut ID,Workflow Accelerator,UX Category,How It Speeds Up Daily Operations,Primary Modules
ACC-01,Global Command Palette (Cmd+K),Navigation & Action,"Keyboard-first spotlight bar to jump to any record, run actions ('New Invoice'), or search across modules in <1 second",All Modules
ACC-02,Smart Paste from Excel / WhatsApp,Data Entry,Paste raw multi-column rows from Excel or messy WhatsApp text directly into line-item grids with auto-SKU matching,"Sales, Procurement, Stocktakes, Data Import"
ACC-03,Inline Quick-Create Modals,Data Entry,"Create a new customer, supplier, item, or bin on the fly inside any dropdown without losing your current form state",All Transactional Forms
ACC-04,Magic Email-to-Record Dropboxes,Automation,Forward supplier PDF bills or customer POs to bills@tenant.app; OCR extracts line items into a draft awaiting 1-click approval,"Creditors, Sales Orders, Expense Claims"
ACC-05,WhatsApp & SMS Deep-Link Actions,Communication,"1-click share of quotes, invoices, statements, POD links, and contract e-sign URLs straight to WhatsApp—essential where email is rare","Debtors, Sales, HR Doc Gen, Field Service"
ACC-06,1-Click Contract & Letter Generator,HR & Legal,"Generate BCEA contracts, warnings, or Certificates of Service pre-filled from employee data with conditional clauses & mobile e-sign","HR Master, Doc Generator, Welfare"
ACC-07,Inline Math & Margin Calculators,Data Entry,"Type '4*12' or '250+15%' directly into quantity/price cells, or type target margin % to auto-calculate selling price","Quotes, Invoices, POs, Job Costing"
ACC-08,One-Click Reverse & Recreate,Error Recovery,Fix posted invoice/bill errors safely: automatically posts a reversing credit/debit note and opens an editable clone,"Debtors, Creditors, Journals"
ACC-09,5-Second Undo Grace Toasts,Error Recovery,Holds destructive actions and outbound emails/webhooks for 5 seconds with an instant 'Undo' button before committing,All Modules
ACC-10,QR Scan-to-Action Labels,Warehouse & Assets,"Print QR stickers for bins, equipment, and rental assets; scanning with any phone camera opens stock count, rental return, or repair ticket","Warehousing, Assets, Maintenance, Rentals"
ACC-11,Saved Filter Tabs & Pinboards,Reporting & UX,"Save any filtered list (e.g., 'Overdue >60 Days', 'Unassigned Job Cards') as a live 1-click workspace tab with badge counts",All List Views & Dashboards
ACC-12,Offline POS & Job Card Auto-Save,Resilience,Local browser storage keeps POS tills and field technician job cards working seamlessly during load-shedding or signal drops,"POS, Field Service, Warehousing"
```

## 5. Industry Activation Matrix

```csv
INDUSTRY ACTIVATION MATRIX (HOW ONE CODEBASE FITS ANY BUSINESS)
Pre-configured module presets that toggle UI complexity on or off depending on the tenant's business model.

Module Ref,Functional Module Group,Retail & Hardware Store,Field Service & Contractors,Manufacturing & Assembly,Equipment Rentals & Hire,Professional & IT Services,Transport & Logistics
KRN-01..06,"Core Kernel (Auth, Party, Branches, Portals, Import)",ON (Required),ON (Required),ON (Required),ON (Required),ON (Required),ON (Required)
FIN-01..04,"Core Finance (GL, Debtors, Creditors, Cashbook)",ON (Required),ON (Required),ON (Required),ON (Required),ON (Required),ON (Required)
FIN-05,"Petty Cash, Till Floats & Expense Claims",ON (Till Floats),ON (Site Cash),Optional,Optional,ON (Expenses),ON (Driver Fuel)
FIN-06,"Tax, VAT & Statutory Audit",ON,ON,ON,ON,ON,ON
SAL-01..02,"CRM Pipeline, Quotes & Sales Orders",Optional,ON,ON,ON,ON,ON
SAL-03,Point of Sale (POS) & Counter Sales,ON (Primary),Optional,Optional,Optional,OFF,OFF
SAL-04,"Recurring Billing, Subscriptions & Rentals",OFF,Optional (SLAs),OFF,ON (Primary),ON (Retainers),Optional
SAL-05,"Customer Support, Returns & Warranties",ON (Returns),ON (Warranties),ON (RMAs),ON,ON (Tickets),Optional
SCM-01..03,"Catalog, Inventory, Procurement & Warehousing",ON (Primary),ON (Van Stock),ON (Raw/FG),ON (Hire Fleet),OFF / Light,Optional (Parts)
SCM-04,"Logistics, Dispatch & Fleet Trips",Optional,Optional,ON,ON (Delivery),OFF,ON (Primary)
OPS-01,Manufacturing & Bills of Materials (BOM),Light (Kits),OFF,ON (Primary),OFF,OFF,OFF
OPS-02,Field Service & Job Costing,OFF,ON (Primary),Optional,ON (On-Site),ON (Projects),Optional
OPS-03,Asset Register & Preventative Maintenance,Optional,ON (Tools),ON (Machines),ON (Hire Units),Optional,ON (Vehicles)
OPS-04,Quality Assurance (QA) & Non-Conformance,OFF,Optional,ON (Primary),ON (Pre-Hire),OFF,Optional
HRP-01..03,"HR Master, Time/Shifts & Payroll Engine",ON,ON,ON,ON,ON,ON
HRP-04..05,Personnel Doc Generator & Staff Welfare,ON,ON,ON,ON,ON,ON
CMP-01..03,"Employment Equity, B-BBEE, COIDA, POPIA & HSE",ON,ON (HSE/COIDA),ON (HSE/EE),ON,ON (POPIA/EE),ON (HSE/COIDA)
ANA-01..03,"Projects, IT Assets & Executive Dashboards",ON (Dashboards),ON,ON,ON,ON (Primary),ON
```

## 6. Module Dependencies & Tiers

```csv
MODULE DEPENDENCY GRAPH & COMMERCIAL PACKAGING TIERS
"Defines hard technical prerequisites, downstream data consumers, and clean SaaS packaging bundles."

Module ID,Sub-Module Name,Architectural Tier,Hard Prerequisites (Must Be Active),Unlocks / Feeds Into,Recommended Commercial Packaging,Activation & Isolation Notes
KRN-01,"Identity, Users & Zero-Trust RBAC",Tier 1: Kernel,None (Root Foundation),All Modules (35),Core Platform (Included),Cannot be disabled; governs all authentication and permissions.
KRN-02,Unified Party Directory,Tier 1: Kernel,KRN-01,All Operational & Finance Modules,Core Platform (Included),"Single contact master required before creating customers, suppliers, or staff."
KRN-03,Multi-Branch & Inter-Company Structure,Tier 1: Kernel,KRN-01,"FIN-01, SCM-01, SAL-03, ANA-03",Core Platform (Included),Defaults to 1 Head Office branch; unlocks multi-branch when toggled.
KRN-04,"Custom Fields, State Machines & Workflows",Tier 1: Kernel,KRN-01,All Modules,Core Platform (Included),"Powers tenant-specific fields, pipelines, and automated alerts."
KRN-05,External Self-Service Portals,Tier 1: Kernel,"KRN-01, KRN-02","FIN-02, SAL-01, SCM-02, SAL-05",Growth Add-On,Exposes read/approve views to external parties via magic links.
KRN-06,Data Migration & No-Lock-In Engine,Tier 1: Kernel,"KRN-01, KRN-02","FIN-01, SCM-01, HRP-01",Core Platform (Included),Used during onboarding and full tenant data export.
FIN-01,General Ledger & Chart of Accounts,Tier 2: Commercial Core,"KRN-01, KRN-03","FIN-02..06, SCM-01, HRP-03, OPS-03",Essentials Tier,Central financial spine; receives automated journals from all sub-ledgers.
FIN-02,Debtors (Accounts Receivable),Tier 2: Commercial Core,"KRN-02, FIN-01","SAL-01..04, FIN-04, KRN-05",Essentials Tier,"Required for any customer invoicing, statements, or age analysis."
FIN-03,Creditors (Accounts Payable),Tier 2: Commercial Core,"KRN-02, FIN-01","SCM-02, FIN-04, CMP-01",Essentials Tier,"Required for supplier bills, payment batches, and B-BBEE spend tracking."
FIN-04,"Cashbook, Bank Feeds & Reconciliation",Tier 2: Commercial Core,FIN-01,"FIN-02, FIN-03, FIN-05",Essentials Tier,"Links bank accounts to debtor receipts, creditor payments, and petty cash."
FIN-05,"Petty Cash, Till Floats & Expense Claims",Tier 2: Commercial Core,"FIN-01, FIN-04, KRN-02","SAL-03, OPS-02, HRP-03",Essentials Tier,"Handles daily till floats, driver cash, and staff slip reimbursements."
FIN-06,"Tax, VAT & Statutory Audit",Tier 2: Commercial Core,FIN-01,"FIN-02, FIN-03, SAL-03",Essentials Tier,Calculates VAT201 and locks submitted tax periods.
SAL-01,CRM Pipeline & Quotes,Tier 2: Commercial Core,"KRN-02, SCM-01","SAL-02, SAL-04, KRN-05",Essentials Tier,Can run standalone for CRM-only teams or feed Sales Orders.
SAL-02,Sales Orders & Fulfilment,Tier 2: Commercial Core,"KRN-02, SCM-01, FIN-02","SCM-03, SCM-04, OPS-01, OPS-02",Essentials Tier,"Bridges customer orders with stock reservation, dispatch, and invoicing."
SAL-03,Point of Sale (POS) & Counter Sales,Tier 3: Operational,"SCM-01, FIN-02, FIN-04, FIN-05","SCM-03, FIN-06",Operations Add-On,"Requires Catalog, Debtors (Walk-in Cash Customer), and Cashbook/Till Float."
SAL-04,"Recurring Billing, Subscriptions & Rentals",Tier 3: Operational,"KRN-02, SCM-01, FIN-02","OPS-03, KRN-05",Operations Add-On,Automates recurring invoices and tracks hired-out serialized units.
SAL-05,"Customer Support, Returns & Warranties",Tier 3: Operational,"KRN-02, SCM-01","FIN-02, OPS-03, KRN-05",Operations Add-On,Links RMA returns to credit notes and serial warranty history.
SCM-01,Universal Catalog & Inventory Ledger,Tier 2: Commercial Core,"KRN-03, FIN-01","SAL-01..05, SCM-02..03, OPS-01..03",Essentials Tier,Supports service-only items if physical stock tracking is toggled off.
SCM-02,Procurement & Supplier Management,Tier 2: Commercial Core,"KRN-02, SCM-01, FIN-03","SCM-03, CMP-01, KRN-05",Essentials Tier,"Manages RFQs, POs, and supplier B-BBEE certificate validity."
SCM-03,"Warehousing, Bins & Stocktakes",Tier 3: Operational,"KRN-03, SCM-01","SAL-02, SCM-02, SCM-04, OPS-01",Operations Add-On,Adds bin-level location tracking on top of basic branch inventory.
SCM-04,"Logistics, Dispatch & Fleet Trips",Tier 3: Operational,"SAL-02, SCM-03","OPS-03, FIN-05",Operations Add-On,Groups delivery notes into vehicle runs and tracks fuel/PODs.
OPS-01,Manufacturing & Bills of Materials (BOM),Tier 3: Operational,"SCM-01, FIN-01","SCM-03, OPS-04, HRP-02",Operations Add-On,Consumes component stock into WIP and outputs finished goods.
OPS-02,Field Service & Job Costing,Tier 3: Operational,"KRN-02, SCM-01, FIN-02","HRP-02, FIN-05, SCM-04, ANA-01",Operations Add-On,"Aggregates parts, timesheets, and petty cash onto client Job Cards."
OPS-03,Asset Register & Preventative Maintenance,Tier 3: Operational,"KRN-03, FIN-01, SCM-01","SAL-04, SCM-04, ANA-02",Operations Add-On,Tracks fixed asset depreciation alongside spare parts & service schedules.
OPS-04,Quality Assurance (QA) & Non-Conformance,Tier 3: Operational,SCM-01,"SCM-02, SCM-03, OPS-01",Operations Add-On,Adds inspection checkpoints to GRNs and manufacturing work orders.
HRP-01,"Employee Master, Org Chart & Onboarding",Tier 4: Back-Office,"KRN-01, KRN-02","HRP-02..05, CMP-01..02, ANA-02",People & Compliance Pack,"Extends Party records with employment dates, job grades, and demographics."
HRP-02,"Time, Attendance & Shift Rostering",Tier 4: Back-Office,HRP-01,"HRP-03, OPS-01, OPS-02",People & Compliance Pack,"Feeds worked hours, overtime, and leave into Payroll and Job Costing."
HRP-03,Payroll Engine & Statutory Deductions,Tier 4: Back-Office,"HRP-01, FIN-01","HRP-02, HRP-05, FIN-05, CMP-02",People & Compliance Pack,Posts salary journals to GL and exports bank EFT + SARS tax files.
HRP-04,Personnel Document Generator,Tier 4: Back-Office,"HRP-01, KRN-04","HRP-05, CMP-02, CMP-03",People & Compliance Pack,"Merges employee fields into BCEA contracts, warnings, and Certificates of Service."
HRP-05,Staff Welfare & Employee Assistance,Tier 4: Back-Office,"HRP-01, KRN-01","HRP-03, HRP-04, CMP-03",People & Compliance Pack,Requires strict RBAC encryption; links staff loans to Payroll & GL.
CMP-01,Employment Equity (EE) & B-BBEE,Tier 4: Back-Office,"HRP-01, FIN-03, SCM-02",ANA-03,People & Compliance Pack,Pulls workforce demographics from HR and verified spend from Creditors.
CMP-02,"COIDA, Labour Filings & POPIA Privacy",Tier 4: Back-Office,"HRP-01, HRP-03, KRN-02",HRP-04,People & Compliance Pack,"Automates COIDA earnings, UI-19 exit forms, and POPIA anonymization."
CMP-03,"Health, Safety (HSE) & Legal Contracts",Tier 4: Back-Office,"KRN-02, HRP-01","SCM-01, HRP-05",People & Compliance Pack,"Tracks OHSA safety incidents, PPE issues, and supplier/client SLAs."
ANA-01,Project Management & Milestones,Tier 4: Back-Office,"KRN-01, KRN-04","OPS-02, HRP-02, FIN-01",Growth Add-On,"Provides Gantt milestones, task boards, and project budget tracking."
ANA-02,"IT Assets, Software Licenses & Helpdesk",Tier 4: Back-Office,"HRP-01, OPS-03",FIN-03,Growth Add-On,"Tracks laptop custody, software seat renewals, and internal IT tickets."
ANA-03,Executive Dashboards & Custom Report Builder,Tier 1: Kernel,KRN-01,All Active Modules,Core Platform (Included),Dynamically surfaces KPIs only for modules enabled by the tenant.
```

## 7. Role & Permission Matrix

```csv
DEFAULT RBAC ROLE & PERMISSION MATRIX (ZERO-TRUST GOVERNANCE)
*Note: Staff Welfare EAP counseling notes (HRP-05) use field-level encryption restricted strictly to designated Welfare Officers—hidden even from SysAdmins.

Domain / Department,Module Ref,Functional Scope,Tenant Owner / SysAdmin,Branch / Ops Manager,Accountant / Bookkeeper,Sales / POS Cashier,Warehouse / Technician,HR / Compliance Officer,External Portal User
1. Core Kernel & Governance,KRN-01..06,"Kernel, Branches, Portals & Data Import",Full Admin,Branch Config,Read Only,No Access,No Access,No Access,Self Portal Only
2. Finance & Accounting,FIN-01..04,"GL, Debtors, Creditors & Cashbook",Full Admin,Approve & View,Full / Post,View Customer Bal,No Access,No Access,Own Statements
2. Finance & Accounting,FIN-05,"Petty Cash, Till Floats & Expense Claims",Full Admin,Approve Claims,Post & Reconcile,Till Float / Submit,Submit Receipts,Submit Receipts,No Access
2. Finance & Accounting,FIN-06,"Tax, VAT & Statutory Audit",Full Admin,Read Only,Prepare & Lock,No Access,No Access,No Access,No Access
"3. Sales, CRM & Revenue",SAL-01..02,"CRM Pipeline, Quotes & Sales Orders",Full Admin,Approve Discounts,View Invoices,Full Create/Edit,View Job Scope,No Access,Approve Quotes
"3. Sales, CRM & Revenue",SAL-03,Point of Sale (POS) & Counter Sales,Full Admin,Void / Cash-Up,Audit Z-Reads,Operate Till,No Access,No Access,No Access
"3. Sales, CRM & Revenue",SAL-04,"Recurring Billing, Subscriptions & Rentals",Full Admin,Approve Contracts,Billing Runs,Create / Check-Out,Inspect Returns,No Access,View Hire Units
"3. Sales, CRM & Revenue",SAL-05,"Customer Support, Returns & Warranties",Full Admin,Approve Credits,Issue Credit Notes,Log & Resolve,Technical Inspect,No Access,Log / Track Tickets
4. Supply Chain & Stock,SCM-01,Universal Catalog & Inventory Ledger,Full Admin,Approve Adj.,Costing & Valuation,View Stock Qty,Full Stock Control,No Access,View Catalog
4. Supply Chain & Stock,SCM-02,Procurement & Supplier Management,Full Admin,Approve POs,3-Way Match Bills,Request Quote,Create POs / RFQs,No Access,Submit Quotes (RFQ)
4. Supply Chain & Stock,SCM-03..04,"Warehousing, Bins, Logistics & Fleet",Full Admin,Read Only,View GRNs / PODs,View Delivery ETA,Full Receive/Pick,No Access,View PODs
5. Production & Operations,OPS-01..02,Manufacturing BOMs & Field Job Costing,Full Admin,View Job Margins,WIP & Margin Audit,Create Job Card,Execute & Log Time,No Access,Sign Job Card
5. Production & Operations,OPS-03..04,"Fixed Assets, Maintenance & QA",Full Admin,Approve CapEx,Depreciation Runs,No Access,Full Maint. & QA,No Access,No Access
6. Human Resources,HRP-01..02,"Employee Master, Shifts & Timekeeping",Full Admin,Approve Leave/OT,Read Hours Only,Own Clock/Leave,Own Clock/Leave,Full HR Admin,No Access
6. Human Resources,HRP-03,Payroll Engine & Statutory Deductions,Full Admin,Approve Pay Run,Post GL & EFT,Own Payslips,Own Payslips,Prepare Pay Run,No Access
6. Human Resources,HRP-04,Personnel Document Generator,Full Admin,Co-Sign Contracts,No Access,E-Sign Own Docs,E-Sign Own Docs,Generate & Issue,No Access
6. Human Resources,HRP-05,Staff Welfare & EAP (Zero-Trust Encrypted),Restricted*,Approve Loans Only,Loan GL Deduction,Submit Request,Submit Request,Welfare Officer*,No Access
"7. Compliance, Risk & HSE",CMP-01..02,"Employment Equity, B-BBEE, COIDA & POPIA",Full Admin,Read Scorecards,B-BBEE Spend Log,No Access,No Access,Full Compliance,Upload B-BBEE Cert
"7. Compliance, Risk & HSE",CMP-03,"Health, Safety (HSE) & Legal Contracts",Full Admin,Review Incidents,Store SLAs,Report Incident,Safety Checklists,HSE / Legal Admin,No Access
"8. Projects, IT & Analytics",ANA-01..03,"Projects, IT Assets & Executive Dashboards",Full Admin,Branch Dashboards,Financial BI,Sales BI & Tasks,Ops BI & Tasks,HR BI & Tasks,No Access
```

## 8. Core KPIs & Dashboards

```csv
8. Core KPI & Executive Dashboard Metrics

KPI ID,Department / Domain,Metric Name,Calculation Formula / Logic,Source Modules,Target Persona,Refresh Cadence
KPI-01,Finance & Accounting,Days Sales Outstanding (DSO),(Total Accounts Receivable / Total Credit Sales) x Number of Days,"Debtors, General Ledger, POS","Owner, Accountant",Daily
KPI-02,Finance & Accounting,Days Payable Outstanding (DPO),(Total Accounts Payable / Cost of Goods Sold) x Number of Days,"Creditors, Procurement, GL","Owner, Accountant",Daily
KPI-03,Finance & Accounting,Net Cash Runway (Months),Available Cash & Bank Balances / Average Monthly Net Burn,"Cash & Treasury, Petty Cash, GL","Owner, CFO",Real-Time
KPI-04,Finance & Accounting,Gross Profit Margin (%),((Net Revenue - Cost of Goods Sold) / Net Revenue) x 100,"Sales, Inventory, Job Costing, GL","Owner, Branch Manager",Real-Time
KPI-05,Sales & Commercial,Quote-to-Order Conversion Rate,(Accepted Quotes / Total Issued Quotes) x 100,"Sales CRM, External Portals","Sales Manager, Owner",Daily
KPI-06,Sales & Commercial,Recurring Revenue Churn (%),(Lost Monthly Recurring Revenue / Starting MRR) x 100,"Subscriptions & Rentals, Debtors","Owner, Sales Manager",Monthly
KPI-07,Sales & Commercial,POS Till Variance,Actual Counted Cash & Card Slips - System Expected Till Total,"POS & Counter Sales, Petty Cash","Branch Manager, Cashier",Per Shift
KPI-08,Supply Chain & Inventory,Inventory Turnover Ratio,Cost of Goods Sold / Average Inventory Value,"Inventory, Warehousing, Sales","Ops Manager, Procurement",Weekly
KPI-09,Supply Chain & Inventory,Stockout & Reorder Alert Count,Count of Active SKUs where Available Qty <= Minimum Reorder Level,"Inventory, Procurement","Procurement, Warehouse",Real-Time
KPI-10,Supply Chain & Inventory,On-Time In-Full (OTIF) Delivery,(Orders Delivered On-Time & Complete / Total Dispatched Orders) x 100,"Logistics & Fleet, Sales Orders","Ops Manager, Logistics",Daily
KPI-11,Operations & Field Service,Job Card Profitability Variance,"((Actual Job Revenue - Actual Material, Labour & Fleet Cost) / Quoted Margin)","Field Service & Job Costing, HR Time","Ops Manager, Owner",Per Job
KPI-12,Maintenance & Assets,Planned vs. Reactive Maintenance %,(Preventative Work Orders / Total Maintenance Work Orders) x 100,Preventative & Reactive Maintenance,"Maintenance Lead, Ops",Monthly
KPI-13,HR & Payroll,Overtime & Absenteeism Rate,(Total Overtime Hours or Unplanned Leave Hours / Scheduled Hours) x 100,"Time & Attendance, Payroll","HR Officer, Branch Manager",Weekly
KPI-14,Compliance & Transformation,Employment Equity Goal Attainment,(Actual Hires/Promotions per Designated Group / Annual EE Plan Target) x 100,"Employment Equity (EEA2/EEA4), HR","HR/Compliance Officer, Owner",Monthly
KPI-15,Compliance & Transformation,Verified B-BBEE Procurement Spend %,(Total Spend with Valid B-BBEE Recognized Suppliers / Total Measured Spend) x 100,"B-BBEE Scorecard, Creditors","Procurement, Compliance",Monthly
KPI-16,People & Welfare,Contract & Compliance Doc Readiness,"(Employees with Signed BCEA Contract, EEA1 & POPIA Consent / Total Active Staff) x 100","Personnel Doc Generator, POPIA",HR/Compliance Officer,Daily
```

## 9. System Config & Localization

```csv
9. System Configuration & Localization Settings

Config ID,Configuration Domain,Setting Name,Configurable Options / Structure,Impact Across Modules,Default (South Africa Preset)
CFG-01,Tax & Fiscal Engine,Tax / VAT Rate Matrix,"Standard Rate, Zero-Rated, Exempt, Reverse Charge, Custom Excise","Sales Invoices, POS, Supplier Bills, GL Tax Control",15% Standard VAT (SARS Compliant)
CFG-02,Tax & Fiscal Engine,Accounting Basis,Accrual Basis vs. Cash/Receipts Basis for Tax Reporting,"General Ledger, VAT201 Return Reports, Debtors/Creditors",Accrual Basis (Cash option < R2.5m)
CFG-03,Fiscal Calendar,Financial Year & Period Locks,"Start Month (1-12), 12/13 Periods, Soft/Hard Period Close Locks","General Ledger, Budgeting, Fixed Asset Depreciation",March 1 - Feb 28 (or Custom)
CFG-04,Multi-Currency & FX,Base & Foreign Currencies,"ISO Currency Codes, Daily Auto-FX Rates, Realized/Unrealized Gain/Loss","Procurement Imports, Export Sales, Multi-Entity Consolidation",ZAR (South African Rand)
CFG-05,Numbering & Sequences,Document Prefix & Auto-Numbering,"Custom Prefix, Branch Code Token, Year/Month Token, Zero-Padding","Invoices, Quotes, POs, GRNs, Job Cards, Employee Codes",INV-{YYYY}-{00001}
CFG-06,Inventory Valuation,Costing Method,"Weighted Average Cost (WAC), FIFO, Standard Cost (Per Tenant/Category)","Inventory Ledger, COGS Posting, Stocktakes, Manufacturing",Weighted Average Cost (WAC)
CFG-07,Units & Barcodes,UoM Conversions & Label Formats,"Base Unit vs. Pack/Case/Pallet Multipliers, EAN-13, Code128, QR URLs","POS, Warehousing, Procurement, QR Scan-to-Action",Each / Box / Pallet + QR URL
CFG-08,Statutory Payroll Rules,Country Labour & Tax Tables,"PAYE Brackets, UIF Caps, SDL %, COIDA Risk Classes, Leave Accrual Rules","Payroll Engine, EMP201/EMP501, IRP5, UI-19 Generators",SA BCEA / SARS Tax Year Tables
CFG-09,Transformation & EE,Equity & B-BBEE Thresholds,"Designated vs. Non-Designated Turnover Thresholds (EME, QSE, Generic)","EE Plan Alerts, B-BBEE Certificate Expiry Warnings, Scorecard",SA DTIC B-BBEE Codes & EE Act
CFG-10,Branding & Comms,White-Label & Channel Gateways,"Company Logo, Accent Hex, Custom SMTP, WhatsApp Business API, SMS Gateway","PDF Invoices, Personnel Contracts, External Portals, Deep Links",Tenant Logo + Email/WhatsApp Links
CFG-11,Approval Thresholds,Dynamic Sign-Off Rules,"Amount Tiers (e.g., PO > R10k requires Manager; > R50k requires Owner)","Procurement POs, Petty Cash Claims, Staff Loans, Credit Notes",Role-Based Tiered Thresholds
CFG-12,Offline & Sync Rules,Edge Caching & Conflict Policy,"POS/Job Card Local Storage Window, Auto-Sync Interval, Price Lock Policy","POS Counter Sales, Field Service Job Cards, Mobile Stocktake",24-Hour Offline Queue + Auto-Sync
```

## 10. Audit & Security Governance

```csv
"10. Audit, Security & Data Governance"

Gov ID,Governance Pillar,Control / Mechanism,Technical & Operational Implementation,Compliance Standard Addressed,Retention / Enforcement Policy
GOV-01,Tenant Isolation,Strict Multi-Tenant Partitioning,"Mandatory tenant_id scoping on every query, file bucket, and cache key","ISO 27001, SOC 2, POPIA",Enforced at Kernel Data Layer
GOV-02,Immutable Audit Trail,Append-Only Event & Field History,"Logs actor_id, timestamp, IP/device, before/after JSON diff on every write","SARS Audit Rules, King IV, ISO 27001",Minimum 5-7 Years Immutable
GOV-03,Financial Integrity,No-Delete Posted Ledger Policy,"Posted invoices, bills, journals, and payslips cannot be deleted; only reversed","IFRS, GAAP, SARS Tax Admin Act",Hard Block on DELETE Operations
GOV-04,Zero-Trust Field Security,Envelope Encryption for Sensitive Data,"EAP counseling notes, ID numbers, and bank details encrypted at rest","POPIA Special Personal Info, GDPR",Per-Tenant KMS Key + Role Decryption
GOV-05,Identity & Session Safety,"MFA, SSO & Short-Lived Tokens","TOTP/SMS 2FA for Admin/Finance roles, scoped magic links for External Portals","NIST 800-63, OWASP Top 10",Mandatory 2FA for Owner/Accountant
GOV-06,POPIA / GDPR Lifecycle,Consent Tracking & Right to Erasure,Timestamped consent proofs; crypto-shredding/anonymization preserving GL totals,"POPIA (South Africa), GDPR (EU)",Configurable Auto-Purge Schedules
GOV-07,Segregation of Duties (SoD),Maker-Checker Conflict Prevention,Prevents the same user from creating a supplier/employee and approving payout,"Internal Audit Controls, Fraud Prevention",Configurable Rule per Tenant
GOV-08,E-Signature Non-Repudiation,Cryptographic Signing Certificate,"Captures SHA-256 document hash, OTP/WhatsApp verification, IP, and timestamp","ECT Act (South Africa), eIDAS",Embedded Audit Page in Signed PDF
GOV-09,Disaster Recovery & Backup,Point-in-Time Recovery (PITR),Automated encrypted daily snapshots + continuous WAL replication across regions,Business Continuity (ISO 22301),RPO < 5 Mins / RTO < 1 Hour
GOV-10,Zero Lock-In Portability,1-Click Full Tenant Data Export,"Generates standardized ZIP archive of CSVs, GL trial balance, and attached PDFs","POPIA Data Portability, Fair SaaS",Self-Service Export Anytime
```

