# MIS Report

Oct 1, 2026 · @Aleem

## Overview

Litelo will ship a configurable MIS module: a user builds report templates per organisation and workflow, and that organisation's users only pick a report and a date range, or get it emailed on a schedule. Here is a [clickable prototype](https://claude.ai/artifact/RnBzEh7BbNnfZXtVXqxorF).

### Problem

Section 138, Section 25 and SARFAESI workflows are live, but each client's MIS needs are different. Today every new report means engineering work, and client teams rebuild MIS by hand in Excel from exports.

### Goals

1. Let a user create or change a client report without engineering, in under 15 minutes.
2. Let client users get any configured report as an Excel file in two inputs: report and date range.
3. Deliver recurring MIS by email automatically, on the dates each client needs.
4. Keep a full audit trail of every report generated, emailed and downloaded.

### Non-goals for v1

These are deliberately left out of the first version.

1. **Summary sheets with charts.** Planned for v2.
2. **One report covering two workflows.** Each report covers exactly one.
3. **User-defined formulas.** Calculated fields are built in by Litelo and cannot be edited by a user.
4. **On-screen dashboards or charts.** Output is a downloadable file.
5. **Changing column order.** The order of columns in the file is fixed by the platform.

## Key terms

Read this once and the rest of the document makes sense.

| Term | What it means |
| --- | --- |
| user | A person on the Litelo team who sets up and runs reports.&#32; |
| Enterprise | A client of Litelo, such as a bank or a lending company. Also called an organisation. |
| Workflow | The kind of legal case being run. Litelo has three: Section 138, Section 25 and SARFAESI right now. |
| Case | One borrower's legal matter inside one workflow. |
| Batch | A group of cases loaded into Litelo together, usually on the same day. |
| Stage | Where a case has reached, such as Notice sent or Summons. |
| Report template | A saved list of columns. It belongs to one enterprise and one workflow. The user builds it once and reuses it. |
| Column | One piece of information about a case, such as Borrower name or Notice date. It becomes one column in the Excel file. |
| Date basis | The one date column that the user's date range is checked against. Every template must have one. |
| Fixed filter | A rule saved inside a template that always applies, such as only show open cases. |
| Active and Draft | A template's state. Active templates can be run. Draft templates are saved but cannot be run yet. |

## Solution

MIS Report is a new item in the Litelo. It is called **Report**. Inside it there are four screens, shown as tabs.

The user does two separate jobs here. First, build a report once. Second, download that report whenever it is needed. The first job is done rarely. The second is done often.

### How it works, end to end

1. The user opens **Report** from the left menu.
2. The user picks an enterprise, such as ABC Bank, and a workflow, such as Section 138.
3. The user sees the list of reports already built for that pair. This is **Screen 1**.
4. The user clicks **New report** and lands in the builder. This is **Screen 2**.
5. In the builder the user types a name, picks the date basis, ticks the columns to include, and adds any fixed filters. A preview with sample data shows what the file will look like.
6. The user saves the report as Active. It is now ready to use.
7. Later, the user opens the **Report download** tab. This is **Screen 3**.
8. The user picks the report, picks a date range, and clicks **Generate report**.
9. A preview of the real data opens on screen.
10. The user either downloads the file as Excel or CSV, or clicks **Email** to send it on a repeating schedule.
11. Every download and every email is written to the **History** tab. This is **Screen 4**.

Steps 1 to 6 happen once per report. Steps 7 to 11 happen every time a client needs a file.

## Screen 1: Report templates

This is the user's home screen. It lists every report already built for one enterprise and one workflow.

### What is on the screen

At the top there is a filter bar with three controls.

1. **Enterprise** — a dropdown listing every client. The user picks one.
2. **Workflow** — three buttons: Section 138, Section 25, SARFAESI. The user picks one.
3. **Search** — a text box to find a report by name.

Below the filter bar is a table of reports. It has these columns.

| Column | What it shows |
| --- | --- |
| Report | The report name, with its description underneath |
| Date range applies to | The date basis chosen for this report |
| Columns | How many columns are in the file |
| Status | Active or Draft |
| Updated | When it last changed, and who changed it |
| Actions | Edit, Duplicate, Delete |

There is a **New report** button at the top right.

### User stories

**US-1.1** — As a user, I want to see all reports built for one client and one workflow, so that I know what already exists before building another.

- The table shows only reports matching the selected enterprise and workflow.
- If none exist, the screen shows a short message naming that client and workflow, plus a New report button.

**US-1.2** — As a user, I want to search reports by name, so that I can find one quickly when a client has many.

- Typing filters the table as the user types.
- The search looks at both the report name and its description.

**US-1.3** — As a user, I want to duplicate a report, so that I can make a small variation without starting again.

- Duplicate creates a copy named "\<original name> (copy)".
- The copy is always created as a **Draft**, so it cannot be run by mistake before it is checked.

**US-1.4** — As a user, I want to delete a report that is no longer used, so that the list stays clean.

- Delete asks for confirmation and names the report.
- Past downloads of that report stay in History and can still be downloaded.
- Any email schedule using that report stops, and the user is told.

**US-1.5** — As a user, I want to see whether a report is Active or Draft, so that I know which ones can be run.

- Only Active reports appear in the Report download screen.
- The user can switch a report between Active and Draft while editing it.

## Screen 2: Report builder

This is where the user decides what goes into the Excel file. It opens when the user clicks New report, or Edit on an existing one.

The screen has two halves. The left half has four numbered steps. The right half is a panel that stays in view and updates as the user works.

### Step 1: Report details

The user fills in:

- **Report name** — required. Must be unique for that enterprise.
- **Description** — optional. A short line explaining what the report is for.
- **Enterprise** — which client this report belongs to.
- **Status** — Active or Draft.
- **Workflow** — Section 138, Section 25 or SARFAESI.

### Step 2: Date range applies to

The user picks one date column from a dropdown. This is the date basis.

### Step 3: Columns

This step has two side-by-side panels.

The left panel is a table of every column available for the chosen workflow. It has a search box and a dropdown to narrow by group, such as Borrower or Court. Each row shows the column name, its group and its type. The user ticks the ones to include.

The right panel lists the columns picked so far. For each one the user can rename the heading that appears in Excel, and remove it.

### Step 4: Fixed filters

A filter is a rule that always applies to this report. Each filter has three parts: a column, a condition, and a value. For example: *Case status is any of Open*.

Filters are joined with AND, so a case must match all of them to appear.

### The right-hand panel

Three things sit here and update live as the user works.

1. **What this report does** — one plain sentence describing the report, with the important words highlighted. Anything missing is shown in red.
2. **Preview** — five rows of fake sample data, using the real column headings.
3. **Save** — with Cancel beside it.

### User stories

**US-2.1** — As a user, I want to name the report and pick its Enterprise and workflow first, so that everything after that is correct for them.

- Name is required and must be unique within that enterprise.
- Two different enterprises may use the same report name.
- Changing the workflow asks for confirmation if columns or filters already exist, then clears them.

**US-2.2** — As a user, I want to choose which date column the date range checks, so that everyone reads the report the same way.

- The dropdown only shows date columns from the chosen workflow.
- A short hint explains that cases with no value in that column are left out of the file.

**US-2.3** — As a user, I want to search and tick columns from a table, so that I can find what I need among 70 or more options.

- Searching filters the list as the user types.
- The group dropdown narrows the list to one group at a time.
- Ticking adds the column. Unticking removes it.
- **Clear all** removes every column at once.

**US-2.4** — As a user, I want to rename a column heading, so that the file matches the words the client already uses.

- The heading defaults to Litelo's own name for that column.
- Renaming changes only the text in the Excel file. The underlying data does not change.

**US-2.5** — As a user, I want to decide what a repeating column shows, so that one case still fits on one row.

- The choices are latest value, first value, all values joined, and count.
- Latest value is the default.

**US-2.6** — As a user, I want to add fixed filters, so that I can build focused reports such as Undelivered notices.

- Conditions change with the column type. Pick lists offer *is any of* and *is none of*. Numbers offer *more than*, *at least* and so on. Dates offer *before*, *after*, *in the last N days*.
- Filters already added are shown as chips above the list, in plain words.

**US-2.7** — As a user, I want a plain-language summary and a live preview, so that I can check the report before saving it.

- The sentence updates on every change.
- Missing pieces are highlighted, for example when no date basis has been picked.
- The preview shows five rows of sample data with the real headings.

**US-2.8** — As a user, I want to be told clearly what is wrong when I save, so that a broken report never reaches a client.

- Save is blocked and a list of fixes is shown if the name, the date basis, or at least one column is missing, or if a filter has no value.
- A saved change applies to the next run. Files already downloaded do not change.

## Screen 3: Report download

This is the screen the user uses most. Building a report happens once. Downloading it happens every week or every month.

The user does three things here: pick a report, pick a date range, and get the file.

### What is on the screen

The left panel holds the controls.

1. **Enterprise** — a dropdown at the top of the screen.
2. **Report** — a list of that client's Active reports, grouped by workflow. The user picks one.
3. **Date range** — six quick buttons: Last 7 days, This month, Last month, This quarter, This financial year, Custom. Below them are From and To date boxes.
4. **Generate report** — the button that runs it.

The right panel is empty until the report runs. After that it shows the result: the report name, the date range used, the time it was generated, a one-line description of the report, and a preview table of the real data.

Above the preview are three buttons: **Download CSV**, **Download Excel** and **Email**.

### Emailing on a schedule

Clicking Email opens a small window. The user fills in four things.

| Field | What it does |
| --- | --- |
| Send to | One or more email addresses, added one at a time |
| How often | Daily, Weekly or Monthly |
| Time | What time of day it goes out, in Indian time |
| Keep sending until | The date the schedule stops |

The user clicks **Send**. The first email goes out straight away. After that it repeats on the chosen pattern until the end date.

Once a schedule exists, a bar appears above the preview showing when it sends, to whom, and until when. It has Edit and Cancel buttons.

### User stories

**US-3.1** — As a user, I want to pick a report and a date range and get a file, so that I can answer a client request in under a minute.

- Only Active reports appear in the list. Drafts are hidden.
- This month is selected by default.
- Typing in From or To switches the quick buttons to Custom.
- Generate is blocked, with a message, if a date is missing or From is after To.

**US-3.2** — As a user, I want to see the data on screen before downloading, so that I catch a wrong date range before sending it to a client.

- The preview shows the real data, not sample data.
- It shows the first rows only. A line underneath says how many rows are shown.
- The report name, date range and generation time are shown above the preview.

**US-3.3** — As a user, I want to download the file as Excel or CSV, so that I can match what the client asked for.

- Both buttons are available on every report.
- The file name includes the report name, the client name and the end date.
- The download is recorded in History.

**US-3.4** — As a user, I want to set a report to email automatically, so that I stop doing the same download every Monday.

- At least one email address is required. Invalid addresses are rejected with a message naming the address.
- The end date must be in the future.
- The first email is sent immediately when the user clicks Send.
- Each later email covers the same length of time as the original range, counted back from its own send date. A weekly email always carries the most recent week.

**US-3.5** — As a user, I want to see and cancel an existing schedule, so that a client stops receiving a report they no longer need.

- If a schedule already exists for that report, it is shown as a bar above the preview.
- Edit reopens the same window with the current settings filled in.
- Cancel stops future emails. Emails already sent stay in History.

## Screen 4: History

This screen lists every file that has been downloaded or emailed for a client.

It exists for two reasons. First, so the team can send the same file again without setting it up a second time. Second, because these files hold borrower names, addresses and phone numbers, so there must be a record of who took what.

### What is on the screen

At the top there is an enterprise dropdown and a search box. Below that is a table.

| Column | What it shows |
| --- | --- |
| Report | The report name, with the file name underneath |
| Workflow | Section 138, Section 25 or SARFAESI |
| Date range | The dates the file covered |
| Rows | How many cases were in the file |
| Format | Excel or CSV, and whether it was emailed |
| Generated | When it was created, and by whom |
| Actions | Download again, Run with latest data |

### Download again versus Run with latest data

These two buttons do different things, and the difference matters.

- **Download again** gives the exact file created at that time. Nothing in it changes.
- **Run with latest data** rebuilds the report using the same dates, but with today's data. The numbers may differ.

A short line of text above the table explains this, so nobody has to guess.

### User stories

**US-4.1** — As a user, I want to see every file taken for a client, so that I can prove what was shared and when.

- Rows are newest first.
- Each row shows who generated the file.
- Rows sent by email are marked.
- Rows cannot be edited.

**US-4.2** — As a user, I want to download a past file again, so that I can resend it when a client loses it.

- The file returned is identical to the one created originally.
- Files are kept for 90 days. After that the row stays but the file is rebuilt on request.

**US-4.3** — As a user, I want to re-run a past report with fresh data, so that I can send an updated version without setting it up again.

- Run with latest data opens the Report download screen with the report and dates already filled in, and generates it.
- If that report has since been deleted or set to Draft, the user is told and nothing runs.

**US-4.4** — As a user, I want to search history, so that I can find one file among hundreds.

- Search looks at the report name, the file name and the person who generated it.

## Open questions&#32;

- Who is allowed to configure a report? The Litelo team only, or can a client build, edit and schedule their own? This also decides whether clients get a login at all.
- Should recipients be limited to the organisation's email domains?
- Is there a maximum file size for email attachments, above which we send a secure download link instead?
