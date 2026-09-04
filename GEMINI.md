# Project Guidelines & Rules (Leadwise n8n)

This document outlines standard procedures, rules, and workflows for developers and AI agents working on the Leadwise n8n project. It serves as a foundational bootstrap for any new development or AI chat session.

---

## 1. Safe Workflow Editing Rule (Mandatory)

To prevent accidental modification or loss of existing production/stable workflows:

- **Always work on a copy:** Whenever you are asked to edit or modify a workflow (e.g., `Workflow A`), do not edit the original workflow directly.
- **Replicate and rename:** First, replicate the workflow into a new copy named `[Original Name] - Gemini` (e.g., `Workflow A - Gemini`).
- **Single copy limit:** Only one Gemini-suffixed workflow copy is needed per original workflow. Do not create multiple versions (like `Workflow A - Gemini - 2`, etc.). Just reuse or update the existing `[Original Name] - Gemini` copy for subsequent edits.
- **Edit the copy:** Apply all requested edits, features, or bug fixes exclusively to the `[Original Name] - Gemini` copy. This keeps the original workflow untouched as a safe baseline.
- **Database constraints on ID:** When creating or duplicating workflows, never omit or leave the `"id"` field null, as the PostgreSQL table enforces a non-null constraint on it. Generate a unique, random 16-character alphanumeric string that is not already in use in `workflows.json` (e.g., `gzTLtv69NhLU7ik5`) to use as the workflow ID.

---

## 2. Docker Compose & Database Syncing Commands

All n8n workflows reside in the PostgreSQL database at runtime. The host workspace file is `/root/leadwise_n8n/workflows.json`.

### Exporting Workflows (Database -> host workflows.json)
Always export workflows from n8n before committing or when wanting to capture the latest state:
```bash
# 1. Export all workflows inside the container
docker compose exec -u node n8n n8n export:workflow --all --output=/home/node/workflows_export.json

# 2. Copy the exported file to the host workspace
docker cp n8n:/home/node/workflows_export.json /root/leadwise_n8n/workflows.json

# 3. Clean up the temporary file in the container
docker compose exec -u node n8n rm -f /home/node/workflows_export.json
```

### Importing & Deploying Workflows (host workflows.json -> Database)
In single-server deployment mode, running `n8n import:workflow` automatically deactivates all workflows. Therefore, a complete deployment must safely import and then restore/adjust the active states of each workflow programmatically:

1. **Copy to container:**
   ```bash
   docker cp /root/leadwise_n8n/workflows.json n8n:/home/node/workflows_import.json
   ```
2. **Import into database:**
   ```bash
   docker compose exec -u node n8n n8n import:workflow --input=/home/node/workflows_import.json
   ```
3. **Synchronize Active States:**
   Run a script that iterates over `workflows.json` and runs:
   - For `active: true` workflows:
     ```bash
     docker compose exec -u node n8n n8n publish:workflow --id=<workflowId>
     ```
   - For `active: false` workflows:
     ```bash
     docker compose exec -u node n8n n8n unpublish:workflow --id=<workflowId>
     ```
4. **Cleanup:**
   ```bash
   docker compose exec -u node n8n rm -f /home/node/workflows_import.json
   ```

---

## 3. Critical Architecture & AI Node Guidelines

When designing, modifying, or creating nodes for the LLM agents, adhere strictly to these principles:

### A. Fallback Business Context Strategy (Anti-Null)
- **The Issue:** Many workflows reference `organization.organization_description`, which is often `null` in the database. When this happens, LLMs run without context on what the company does, which causes poor sentiment analysis, incorrect responses, or hallucinations.
- **The Solution:** Always implement a fallback context block. If `organization_description` is null, programmatically extract business details from the onboarding data: `organization_settings.business_onboarding.data` (e.g., `company_name`, `business_niche`, `products_or_services`, and `sales_process_description`) to construct a rich company summary.

### B. Type Safety & Native JSON Object Formatting
- **The Issue:** Constructing JSON strings via raw string concatenation inside n8n Edit Fields/Set nodes (e.g. `="{"new_messages": {{ ... }, "history": {{ ... }} }"`) easily crashes the workflow if the message content contains double quotes (`"`), backslashes, or unescaped newlines.
- **The Solution:** Always define assignments in Set nodes as native `object` types rather than raw strings. Use native JS objects inside the expression (e.g. `={{ { new_messages: ..., history: ... } }}`).
- **Stringifying for Prompts:** Inside AI Agent nodes, use `{{ JSON.stringify($json.messages, null, 2) }}` to safely format the object into a beautiful, readable, and escape-safe string for the LLM.

### C. Enforce Chain of Thought (CoT)
- For any categorization, decision, or boolean flags (like `waiting_answer` or `sentiment`), never force the LLM to output a direct value without context.
- Always include an `"explanation"` or `"reasoning"` key in both the output JSON schema and the system message. Force the LLM to output its analysis *first* before declaring the final decision. This dramatically improves accuracy.

### D. Billing & Database Safeguards
- Always inspect the `onError` handlers of database write nodes (like Supabase `Create a row` or `Update a row`).
- **Billing Rule:** If a database node fails to save an analytical insight, set its `onError` to `stopWorkflow` instead of silently continuing to `Decrease org balance`. Never charge the client's credit balance for failed or unsaved operations.
