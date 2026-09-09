# Plano de Execução: Restrição de Execução por Permissões no n8n (leadwise_n8n) - Nós Pais Estritos (Revisado)

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

### ⚠️ Regra de Expressões Nativas no n8n (Sem Nós de Código para Validação)
Para reduzir o overhead de nós e conexões desnecessárias, **é proibido usar nós Javascript Code customizados para checagem booleana de permissão**. Em vez disso, utilizaremos expressões nativas direto em nós do tipo `If` para verificar as permissões.

**Fail-closed (triagem / follow-up / waiting-answer / TAS):** se o array vier ausente, `null` ou `[]`, **não** executar o LLM. A ausência de permissões sempre avalia como falso.

**Media Describer é absoluto:** este workflow **não** participa do `Filter Allowed Analyses` e **não** exige copilot, analises, TAS, `copilot.sugestoes_ia`, `copilot.waiting_answer` nem nenhuma outra chave. Se `media_describer` está no array → transcreve. Se não está → 200 sem LLM. Falta de outras permissões **nunca** veta mídia. Não existe edge function `media-describer`; o POST nasce dos webhooks de ingestão via `sendMediaDescriberWebhook`. Sem `organization_user_id` no body, encerrar sem transcrever.

---

## 3. Estratégia de Implementação nos Cinco Workflows (Com Nós Pais Estritos)

### A. Fluxo de Triagem e Análises Individuais
**Workflow de Destino:** `Triagem e analises individuais - V3 - Gemini`

* **Ponto de Interceptação:** Logo após a resposta de `get-analytics-lead-messages`.
* **Leitura das Permissões:** `{{ $json.metadata.module_permissions }}`.
* **Nó `Filter Allowed Analyses` (Code Node - JavaScript):**
  * Interseção entre o array sugerido pelo LLM (`suggestedAnalyses`) e as permissões ativas (caso o array `module_permissions` venha vazio ou nulo, o retorno é um array vazio de análises para garantir fail-closed):
    ```javascript
    const suggested = $json.values || [];
    const perms = $json.metadata?.module_permissions;
    if (!Array.isArray(perms) || perms.length === 0) return [{ json: { values: [] } }];
    
    const permissionMap = {
      'sentiment': 'analises.sentimento',
      'objections': 'analises.objecoes',
      'product': 'analises.produtos',
      'segments': 'analises.v3', // ou gestao_vendas.funil
      'topics': 'analises.v3',
      'followup': 'copilot.sugestoes_ia'
    };

    const filtered = suggested.filter(a => {
      const required = permissionMap[a];
      return required ? perms.includes(required) : false;
    });

    return [{ json: { values: filtered } }];
    ```

### B. Fluxo de Media Describer (Transcrição e Descrição de Mídias)
**Workflow de Destino:** `Media describer webhook - V3 - Gemini`

Tratado estritamente como **Nó Pai / Módulo Base** (`media_describer`, sem ponto).

* **Ponto de Interceptação Inicial (Evitar Conexões Mortas):** Logo na entrada, após o nó `Webhook`.
* **Nó `Verify User ID` (If Node):**
  * Condição: `{{ $json.body.organization_user_id }}` is not empty.
  * **False:** Encerra o fluxo imediatamente com 200 OK sem nenhuma requisição de banco de dados ou erro.
  * **True:** Segue para o nó Supabase.
* **Nó `Get Media Permissions` (Supabase, `service_role`):**
  * `id = {{ $json.body.organization_user_id }}`
* **Nó `Check Media Permission` (If Node com Condição Nativa):**
  * Condição nativa no n8n:
    - **Value 1:** `={{ $json.module_permissions }}`
    - **Operator:** `contains` (Array)
    - **Value 2:** `media_describer` (String)
  * **False:** Encerra imediatamente com 200 OK sem transcrever nem cobrar crédito.
  * **True:** Segue fluxo normal.

### C. Fluxo de Trends, Alerts and Strategies (TAS)
**Workflow de Destino:** `Leadwise - Trends, Alerts and Strategies - Gemini`

Tratado estritamente como **Nó Pai / Módulo Base** (`trends_alerts_strategies`, sem ponto).

* **Ponto de Interceptação:** Após `When Executed by Another Workflow`.
* **Nó `Get TAS Permissions` (Supabase, `service_role`):**
  * `id = {{ $json.organization_user_id }}`
* **Nó `Check TAS Permission` (If Node com Condição Nativa):**
  * Condição nativa no n8n:
    - **Value 1:** `={{ $json.module_permissions }}`
    - **Operator:** `contains`
    - **Value 2:** `trends_alerts_strategies`
  * **True:** Executa o `TAS analyzer` e insere o relatório consolidado na tabela `ai_insights_v3`.
  * **False:** Interrompe a execução imediatamente sem custos.

### D. Fluxo de Sales Follow-up (Roteiros de Reengajamento)
**Workflow de Destino:** `Follow up - Per lead - V3 - Gemini`

* **Ponto de Interceptação:** Após `get-follow-up-lead-messages`.
* **Nó `Check Follow-up Permission` (If Node com Condição Nativa):**
  * Condição nativa no n8n:
    - **Value 1:** `={{ $json.metadata?.module_permissions }}`
    - **Operator:** `contains`
    - **Value 2:** `copilot.sugestoes_ia`
  * **True:** Executa o `Follow up analyzer`.
  * **False:** Interrompe imediatamente.

### E. Fluxo de Awaiting Agent (Mensagens Sem Resposta)
**Workflow de Destino:** `Check waiting answer - Agent - V3 - Gemini`

* **Ponto de Interceptação:** Após `get-waiting-answer-lead-messages`.
* **Nó `Check Waiting Answer Permission` (If Node com Condição Nativa):**
  * Condição nativa no n8n:
    - **Value 1:** `={{ $json.metadata?.module_permissions }}`
    - **Operator:** `contains`
    - **Value 2:** `copilot.waiting_answer`
  * **True:** Executa o `AI Agent`.
  * **False:** Interrompe imediatamente.

---

## 4. Ordem Canônica de Rollout de Produção (Evitar Quebras)

Devido às restrições severas de **Fail-Closed**, para evitar interrupções de serviço durante o deploy, a implantação deve seguir estritamente esta ordem:

1. **SQL Migrations:** Rodar a migração SQL contendo o backfill e atualizações de presets/gatilhos no Supabase de produção (concedendo as permissões retroativas).
2. **Edge Functions Deploy:** Efetuar o deploy de todas as 3 Edge Functions atualizadas (`get-analytics`, `get-follow-up`, `get-waiting-answer`) para garantir que o array `module_permissions` passe a ser retornado nos metadados.
3. **Frontend Deploy:** Deploy do frontend (`ia_analytics`) para exibir os novos módulos e proteção de rotas no menu.
4. **n8n Workflows Deploy:** Importar, configurar e ativar os novos workflows `- Gemini` no n8n.
