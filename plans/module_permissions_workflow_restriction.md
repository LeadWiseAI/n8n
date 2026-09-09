# Plano de Execução: Restrição de Execução por Permissões no n8n (leadwise_n8n) - Nós Pais Estritos

Este documento descreve as alterações planejadas nos workflows ativos do **n8n** para consultar e impor as permissões de módulo (`module_permissions`) de cada usuário, tratando os fluxos de **Media Describer** e **Trends, Alerts and Strategies (TAS)** estritamente como **Nós Pais (Módulos Base)** independentes de primeiro nível e sem representações granulares duplicadas.

Catálogo, presets, SQL e o campo `metadata.module_permissions` nas edge functions são responsabilidade do repositório **ia-analytics** (`plans/module_permissions_n8n_integration.md`). Este plano cobre **somente** cópias `- Gemini` dos workflows e os nós de filtro.

Chaves canônicas (nunca usar duplicatas pontuadas):

- Pais: `media_describer`, `trends_alerts_strategies`
- Granulares novas/usadas aqui: `copilot.waiting_answer`, `copilot.sugestoes_ia`, `analises.sentimento`, `analises.objecoes`, `analises.produtos`, `analises.v3`, `gestao_vendas.funil`

---

## 1. Diretrizes de Segurança (Regra Mandatória)

De acordo com o `GEMINI.md` do projeto, **nunca devemos editar os fluxos estáveis diretamente**.
Para cada um dos cinco fluxos a serem alterados, criaremos cópias de segurança com o sufixo `- Gemini` para realizar o desenvolvimento e testes com segurança:
* `Triagem e analises individuais - V3` $\rightarrow$ `Triagem e analises individuais - V3 - Gemini`
* `Media describer webhook - V3` $\rightarrow$ `Media describer webhook - V3 - Gemini`
* `Leadwise - Trends, Alerts and Strategies` $\rightarrow$ `Leadwise - Trends, Alerts and Strategies - Gemini`
* `Follow up - Per lead - V3` $\rightarrow$ `Follow up - Per lead - V3 - Gemini`
* `Check waiting answer - Agent - V3 - Gemini` (Já em cópia, alteraremos diretamente este fluxo ativo `- Gemini`).

---

## 2. Otimização de Performance e Redução de Conexões Supabase (O(1) Queries)

**Não** assumir que follow-up e waiting-answer passam por `get-analytics-lead-messages`. Cada fluxo lê o array na function que ele **já** chama:

| Workflow | Edge function | Path no JSON |
| :--- | :--- | :--- |
| Triagem | `get-analytics-lead-messages` | `{{ $json.metadata.module_permissions }}` |
| Follow up | `get-follow-up-lead-messages` | `{{ $json.metadata.module_permissions }}` |
| Waiting answer | `get-waiting-answer-lead-messages` | `{{ $json.metadata.module_permissions }}` |
| Media describer | Disparo no ia-analytics: `sendMediaDescriberWebhook` (ingest) → este webhook. Checagem n8n: REST `organization_users` por `body.organization_user_id` | **somente** se o array contém `media_describer` |
| TAS | REST `organization_users` por `organization_user_id` do item | `module_permissions` da linha |

Isso significa que, nos três primeiros, o n8n **não precisa criar um novo nó Supabase**. O array já vem na carga de trabalho depois da chamada HTTP existente.

**Fail-closed (triagem / follow-up / waiting-answer / TAS):** se o array vier ausente, `null` ou `[]`, **não** executar o LLM. O snippet `if (!perms || perms.length === 0) return true` está **proibido**.

**Media Describer é absoluto:** este workflow **não** participa do `Filter Allowed Analyses` e **não** exige copilot, analises, TAS, `copilot.sugestoes_ia`, `copilot.waiting_answer` nem nenhuma outra chave. Se `media_describer` está no array → transcreve. Se não está → 200 sem LLM. Falta de outras permissões **nunca** veta mídia. Não existe edge function `media-describer`; o POST nasce dos webhooks de ingestão via `sendMediaDescriberWebhook`. Sem `organization_user_id` no body, encerrar sem transcrever.

---

## 3. Estratégia de Implementação nos Cinco Workflows (Com Nós Pais Estritos)

### A. Fluxo de Triagem e Análises Individuais
**Workflow de Destino:** `Triagem e analises individuais - V3 - Gemini`

* **Ponto de Interceptação:** Logo após a resposta de `get-analytics-lead-messages`.
* **Leitura das Permissões:** `{{ $json.metadata.module_permissions }}`.
* **Nó `Filter Allowed Analyses` (Code Node - JavaScript):**
  * Interseção entre o array sugerido pelo LLM (`suggestedAnalyses`) e as permissões ativas:
    * `sentiment` $\rightarrow$ `analises.sentimento`
    * `objections` $\rightarrow$ `analises.objecoes`
    * `product` $\rightarrow$ `analises.produtos`
    * `segments` $\rightarrow$ `analises.v3` ou `gestao_vendas.funil`
    * `topics` $\rightarrow$ `analises.v3`
    * `followup` $\rightarrow$ `copilot.sugestoes_ia`

### B. Fluxo de Media Describer (Transcrição e Descrição de Mídias)
**Workflow de Destino:** `Media describer webhook - V3 - Gemini`

Tratado estritamente como **Nó Pai / Módulo Base** (`media_describer`, sem ponto). **Prioridade absoluta neste workflow:** o If olha **apenas** essa chave.

* **Origem do POST:** helper `sendMediaDescriberWebhook` no ia-analytics (uzapi / chatwoot / bitrix / waba), não uma edge function `media-describer`.
* **Ponto de Interceptação:** Logo na entrada, após o nó `Webhook`.
* **Nó `Get Media Permissions` (Supabase, `service_role`):**
  * `id = {{ $json.body.organization_user_id }}`
  * Se `organization_user_id` estiver vazio: caminho False (não transcrever).
* **Nó `Check Media Permission` (If):**
  * True **somente** se o array contém **`media_describer`**. Proibido `AND` com copilot/analises/qualquer outra permissão.
  * False: responde 200 ao webhook **sem** transcrição, OCR, nem débito de crédito.
  * True: segue o fluxo normal **mesmo** se o usuário não tiver nenhum outro módulo.

### C. Fluxo de Trends, Alerts and Strategies (TAS)
**Workflow de Destino:** `Leadwise - Trends, Alerts and Strategies - Gemini`

Tratado estritamente como **Nó Pai / Módulo Base** (`trends_alerts_strategies`, sem ponto).

* **Ponto de Interceptação:** Após `When Executed by Another Workflow`.
* **Nó `Get TAS Permissions` (Supabase, `service_role`):**
  * `id = {{ $json.organization_user_id }}`
* **Nó `Check TAS Permission` (If):**
  * True: `TAS analyzer` + insert em `ai_insights_v3`.
  * False: para imediatamente, sem Gemini e sem decremento de créditos.

Preset Training **não** inclui TAS; só IA Analytics (e backfill de quem já tem `analises`).

### D. Fluxo de Sales Follow-up (Roteiros de Reengajamento)
**Workflow de Destino:** `Follow up - Per lead - V3 - Gemini`

* **Ponto de Interceptação:** Após `get-follow-up-lead-messages` (não após analytics).
* **Leitura:** `{{ $json.metadata.module_permissions }}`.
* **Nó `Check Follow-up Permission` (If):**
  * True se contém **`copilot.sugestoes_ia`**.
  * False: sem LLM e sem débito.

### E. Fluxo de Awaiting Agent (Mensagens Sem Resposta)
**Workflow de Destino:** `Check waiting answer - Agent - V3 - Gemini`

* **Ponto de Interceptação:** Após `get-waiting-answer-lead-messages` (não após analytics).
* **Leitura:** `{{ $json.metadata.module_permissions }}`.
* **Nó `Check Waiting Answer Permission` (If):**
  * True se contém **`copilot.waiting_answer`**.
  * False: sem LLM e sem débito.

---

## 4. Lógica de Código de Filtragem (Fail-closed)

```javascript
// Media Describer — única chave; ignora o restante do array
const orgUserId = $('Webhook').item.json.body?.organization_user_id;
const perms = $('Get Media Permissions').item.json.module_permissions;
if (!orgUserId || !Array.isArray(perms)) return false;
return perms.includes('media_describer');
```

```javascript
// TAS
const perms = $('Get TAS Permissions').item.json.module_permissions;
if (!Array.isArray(perms) || perms.length === 0) return false;
return perms.includes('trends_alerts_strategies');
```

```javascript
// Follow-up (depois de get-follow-up-lead-messages)
const perms = $json.metadata?.module_permissions;
if (!Array.isArray(perms) || perms.length === 0) return false;
return perms.includes('copilot.sugestoes_ia');
```

```javascript
// Waiting answer (depois de get-waiting-answer-lead-messages)
const perms = $json.metadata?.module_permissions;
if (!Array.isArray(perms) || perms.length === 0) return false;
return perms.includes('copilot.waiting_answer');
```

---

## 5. Passos para Aplicação e Deploy

Pré-requisito: o ia-analytics já ter publicado `metadata.module_permissions` nas três functions e `organization_user_id` no webhook de mídia. Sem isso, os If fail-closed **param todos os fluxos**.

1. Duplicar os workflows necessários no JSON `workflows.json` e gerar identificadores únicos de 16 caracteres (waiting-answer já está em `- Gemini`).
2. Inserir os nós conforme a seção 3 e ajustar coordenadas.
3. Importar com os utilitários do repositório:
   ```bash
   node activate_and_migrate.js
   ```
4. Testar com (a) usuário com a chave, (b) usuário sem a chave, (c) payload de mídia sem `organization_user_id`, (d) `metadata.module_permissions` vazio — (b)(c)(d) não podem chamar LLM.
