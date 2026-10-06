# MIS Report - Implementation Strategy

## Database Mapping

Your existing databases and what they provide:

| Database | What it provides for MIS |
|----------|-------------------------|
| **Auth** | User info, Enterprise (client) list, Permissions |
| **Casebridge** | Case master data, Borrower info, Loan details |
| **CMS** | Court data, Hearings, Filings, Judgments |
| **Courtbridge** | Court integrations, CNR, Case status |
| **Digiserve** | Communications - SMS, Email, WhatsApp, Replies |
| **Workflow** | Workflow definitions, Stages, Stage transitions |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (MIS Module)                     │
│  Templates List │ Builder │ Download │ History               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MIS Service (New)                         │
│  - Column Catalog (Hardcoded per workflow)                   │
│  - Template CRUD                                             │
│  - Report Generator (queries multiple DBs)                   │
│  - Scheduler                                                 │
└─────────────────────────────────────────────────────────────┘
          │           │           │           │
          ▼           ▼           ▼           ▼
┌─────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐
│  Auth   │ │Casebridge│ │    CMS    │ │ Digiserve│
│(existing)│ │(existing)│ │ (existing)│ │(existing)│
└─────────┘ └──────────┘ └───────────┘ └──────────┘
```

---

## Data Flow

### Step 1: Get Platform Config (From Auth DB)
```
Auth DB → Enterprises, Users, Permissions
Workflow DB → Workflow types (S138, S25, SARFAESI)
```

### Step 2: Column Catalog (Hardcoded in Code)
```javascript
// No DB call - defined in code per workflow
const COLUMN_CATALOG = {
  s138: [...],
  s25: [...],
  sarf: [...]
}
```

### Step 3: Save Report Template (New MIS Tables)
```
MIS DB (new tables) → report_templates, report_history, report_schedules
```

### Step 4: Generate Report (Query Multiple DBs)
```
Casebridge + CMS + Digiserve + Courtbridge → JOIN/aggregate → Excel/CSV
```

---

## New Tables Required (Add to existing DB or new MIS schema)

### Table 1: report_templates
```sql
CREATE TABLE report_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enterprise_id UUID NOT NULL,  -- FK to Auth.enterprises
    workflow_type VARCHAR(50) NOT NULL,  -- 's138', 's25', 'sarf'
    date_basis VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'Draft',
    columns JSONB NOT NULL,
    filters JSONB DEFAULT '[]',
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(enterprise_id, name)
);
```

### Table 2: report_history
```sql
CREATE TABLE report_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES report_templates(id),
    template_name VARCHAR(255),
    enterprise_id UUID NOT NULL,
    workflow_type VARCHAR(50),
    date_from DATE,
    date_to DATE,
    format VARCHAR(10),
    row_count INT,
    file_key VARCHAR(500),
    generated_via VARCHAR(20),
    generated_by UUID,
    generated_at TIMESTAMP DEFAULT NOW()
);
```

### Table 3: report_schedules
```sql
CREATE TABLE report_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES report_templates(id),
    frequency VARCHAR(20),
    send_time TIME,
    end_date DATE,
    recipients JSONB,
    format VARCHAR(10),
    date_range_preset VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Column Catalog Structure (Hardcoded)

Each column maps to actual DB tables:

```javascript
const COLUMN_CATALOG = {
  s138: [
    {
      group: "Case and batch",
      fields: [
        {
          k: "case_id",
          label: "Case ID",
          type: "text",
          db: "casebridge",
          table: "cases",
          column: "case_reference"
        },
        {
          k: "batch_id",
          label: "Batch ID", 
          type: "text",
          db: "casebridge",
          table: "batches",
          column: "batch_code",
          join: "cases.batch_id = batches.id"
        }
      ]
    },
    {
      group: "Borrower",
      fields: [
        {
          k: "borrower_name",
          label: "Borrower name",
          type: "text",
          db: "casebridge",
          table: "borrowers",
          column: "full_name",
          join: "cases.borrower_id = borrowers.id"
        }
      ]
    },
    {
      group: "Communication",
      fields: [
        {
          k: "sms_status",
          label: "SMS status",
          type: "enum",
          db: "digiserve",
          table: "communications",
          column: "status",
          filter: "channel = 'sms'",
          isRepeating: true
        }
      ]
    },
    {
      group: "Court",
      fields: [
        {
          k: "court_name",
          label: "Court",
          type: "text",
          db: "cms",
          table: "court_cases",
          column: "court_name",
          join: "cases.id = court_cases.case_id"
        }
      ]
    },
    {
      group: "Calculated",
      fields: [
        {
          k: "case_age",
          label: "Case age (days)",
          type: "number",
          isCalculated: true,
          expression: "DATEDIFF(NOW(), cases.created_at)"
        }
      ]
    }
  ]
}
```

---

## API Endpoints

### From Existing Platform (No changes needed)
```
GET /auth/enterprises         → List enterprises for dropdown
GET /auth/users/me            → Current user
GET /workflow/types           → S138, S25, SARFAESI
```

### New MIS APIs
```
# Templates
GET    /mis/templates?enterprise_id=&workflow=&search=
POST   /mis/templates
GET    /mis/templates/:id
PUT    /mis/templates/:id
DELETE /mis/templates/:id
POST   /mis/templates/:id/duplicate

# Column Catalog (returns hardcoded config)
GET    /mis/columns/:workflow_type

# Report Generation
POST   /mis/reports/preview
       Body: {template_id, date_from, date_to}
       Returns: {columns, rows (limit 100), total_count}

POST   /mis/reports/generate
       Body: {template_id, date_from, date_to, format}
       Returns: {file_url, row_count}

# History
GET    /mis/history?enterprise_id=&search=
GET    /mis/history/:id/download

# Schedules
POST   /mis/schedules
PUT    /mis/schedules/:id
DELETE /mis/schedules/:id
```

---

## Report Generation Logic

### Query Builder Pseudo-code
```python
def generate_report(template, date_from, date_to):
    # 1. Get column configs for selected columns
    columns = get_column_configs(template.workflow_type, template.columns)
    
    # 2. Group by database
    db_queries = group_columns_by_db(columns)
    
    # 3. Build base query from Casebridge
    base_query = f"""
        SELECT cases.id as case_id
        FROM casebridge.cases
        WHERE cases.enterprise_id = '{template.enterprise_id}'
        AND cases.workflow_type = '{template.workflow_type}'
        AND cases.{template.date_basis} BETWEEN '{date_from}' AND '{date_to}'
    """
    
    # 4. Apply fixed filters
    for filter in template.filters:
        base_query += build_filter_clause(filter)
    
    # 5. Join other databases as needed
    if needs_cms_data(columns):
        base_query = add_cms_join(base_query, columns)
    
    if needs_digiserve_data(columns):
        base_query = add_digiserve_join(base_query, columns)
    
    # 6. Execute and format
    results = execute_cross_db_query(base_query)
    
    # 7. Generate file
    return generate_excel(results, template.columns)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create MIS database tables
- [ ] Hardcode column catalog for Section 138
- [ ] Template CRUD APIs
- [ ] Basic UI for template list and builder

### Phase 2: Report Generation (Week 3-4)
- [ ] Query builder for Casebridge
- [ ] Add CMS joins
- [ ] Add Digiserve joins
- [ ] Preview API
- [ ] Excel/CSV generation

### Phase 3: Complete Workflows (Week 5)
- [ ] Column catalog for Section 25
- [ ] Column catalog for SARFAESI
- [ ] Calculated fields

### Phase 4: History & Scheduling (Week 6)
- [ ] Report history tracking
- [ ] File storage (S3)
- [ ] Email scheduling
- [ ] Cron job for scheduled reports

---

## Questions to Clarify

1. **Which DB should hold MIS tables?** (New schema or add to existing?)
2. **Cross-DB queries** - Do you use:
   - Single DB with schemas?
   - Multiple DBs with DB links?
   - Application-level joins?
3. **File storage** - S3 or local storage for generated reports?
4. **Email service** - Which service for scheduled emails?

---

## Next Steps

1. Confirm DB structure for your existing tables
2. I'll create the column catalog mapping to your actual tables
3. Build the API layer
4. Build the frontend components
