# Plano de Execução: Restrição de Execução por Permissões no n8n (leadwise_n8n) - Nós Pais

Este documento descreve as alterações planejadas nos workflows ativos do **n8n** para consultar e impor as permissões de módulo (`module_permissions`) de cada usuário, tratando os fluxos de **Media Describer** e **Trends, Alerts and Strategies (TAS)** como **Nós Pais (Módulos Base)** independentes e de primeiro nível.

---

## 1. Diretrizes de Segurança (Regra Mandatória)

De acordo com o `GEMINI.md` do projeto, **nunca devemos editar os fluxos estáveis diretamente**.
Para cada um dos quatro fluxos a serem alterados, criaremos cópias de segurança com o sufixo `- Gemini` para realizar o desenvolvimento e testes com segurança:
* `Triagem e analises individuais - V3` $\rightarrow$ `Triagem e analises individuais - V3 - Gemini`
* `Media describer webhook - V3` $\rightarrow$ `Media describer webhook - V3 - Gemini`
* `Leadwise - Trends, Alerts and Strategies` $\rightarrow$ `Leadwise - Trends, Alerts and Strategies - Gemini`
* `Follow up - Per lead - V3` $\rightarrow$ `Follow up - Per lead - V3 - Gemini`

---

## 2. Otimização de Performance e Redução de Conexões Supabase (O(1) Queries)

Durante a revisão técnica, identificamos que realizar consultas separadas de permissões para cada lead em lote causaria sobrecarga no banco de dados e adicionaria latência desnecessária.

### Solução Inteligente (Recomendada):
Sempre que o n8n chamar a Edge Function `get-analytics-lead-messages` no início dos crons ou workflows, essa Edge Function deve retornar o array `module_permissions` diretamente no JSON de resposta.

Isso significa que:
1. No fluxo **`Triagem e analises individuais - V3 - Gemini`** e no **`Follow up - Per lead - V3 - Gemini`**, o n8n **não precisa criar um novo nó Supabase**. O array de permissões já virá pronto na carga de trabalho de entrada (`When Executed by Another Workflow`).
2. Isso reduz o tempo de processamento pela metade e previne estouros de limite de conexões simultâneas no PostgreSQL.

---

## 3. Estratégia de Implementação nos Quatro Workflows (Com Nós Pais)

### A. Fluxo de Triagem e Análises Individuais
**Workflow de Destino:** `Triagem e analises individuais - V3 - Gemini`

* **Ponto de Interceptação:** Logo no início, após o nó de trigger.
* **Leitura das Permissões:** O array de permissões já vem mapeado nos metadados obtidos da Edge Function: `{{ $json.metadata.module_permissions }}`.
* **Nó `Filter Allowed Analyses` (Code Node - JavaScript):**
  * Realiza a interseção entre o array sugerido pelo LLM (`suggestedAnalyses`) e as permissões ativas no banco:
    * `sentiment` $\rightarrow$ Requer `analises.sentimento`
    * `objections` $\rightarrow$ Requer `analises.objecoes`
    * `product` $\rightarrow$ Requer `analises.produtos`
    * `segments` $\rightarrow$ Requer `analises.v3` (ou `gestao_vendas.funil`)
    * `topics` $\rightarrow$ Requer `analises.v3`
    * `followup` $\rightarrow$ Requer `copilot.sugestoes_ia`

---

### B. Fluxo de Media Describer (Transcrição e Descrição de Mídias)
**Workflow de Destino:** `Media describer webhook - V3 - Gemini`
Tratado como **Nó Pai (Módulo Base)** independente, o n8n agora busca a chave direta `media_describer` (sem pontos/namespaces).

* **Ponto de Interceptação:** Logo na entrada, após o nó `Webhook`.
* **Nó `Get Media Permissions` (Supabase com credencial `service_role`):**
  * Busca `module_permissions` da tabela `organization_users` usando o ID recebido no webhook: `id = {{ $json.body.organization_user_id }}`.
* **Nó `Check Media Permission` (If Node):**
  * Condição: Verifica se o array `module_permissions` contém a string direta **`media_describer`**.
  * **Caminho True:** Segue para o fluxo normal de transcrição ou descrição de imagem.
  * **Caminho False:** Encerra a execução graciosamente, respondendo ao webhook com status de sucesso, mas sem executar processamento ou gerar custos de infraestrutura de IA.

---

### C. Fluxo de Trends, Alerts and Strategies (TAS)
**Workflow de Destino:** `Leadwise - Trends, Alerts and Strategies - Gemini`
Tratado como **Nó Pai (Módulo Base)** independente, o n8n agora busca a chave direta `trends_alerts_strategies`.

* **Ponto de Interceptação:** Logo no início, após o nó `When Executed by Another Workflow`.
* **Nó `Get TAS Permissions` (Supabase com credencial `service_role`):**
  * Seleciona `module_permissions` na tabela `organization_users` filtrando por `id = {{ $json.organization_user_id }}`.
* **Nó `Check TAS Permission` (If Node):**
  * Condição: Confirma se o array `module_permissions` contém a string direta **`trends_alerts_strategies`**.
  * **Caminho True:** Executa normalmente o `TAS analyzer` e insere o relatório consolidado na tabela `ai_insights_v3`.
  * **Caminho False:** Interrompe a execução imediatamente, sem chamar o modelo LLM do Gemini e sem decrementar créditos da organização.

---

### D. Fluxo de Sales Follow-up (Roteiros de Reengajamento)
**Workflow de Destino:** `Follow up - Per lead - V3 - Gemini`

* **Ponto de Interceptação:** Logo no início, após o nó de trigger.
* **Leitura das Permissões:** O array de permissões já vem mapeado nos metadados obtidos da Edge Function: `{{ $json.metadata.module_permissions }}`.
* **Nó `Check Follow-up Permission` (If Node):**
  * Condição: Confirma se o array `module_permissions` contém a string **`copilot.sugestoes_ia`**.
  * **Caminho True:** Executa normalmente o `Follow up analyzer` e salva a recomendação/script no banco.
  * **Caminho False:** Interrompe a execução imediatamente, sem acionar o LLM e economizando recursos computacionais e créditos de saldo da empresa.

---

## 4. Lógica de Código de Filtragem (Exemplo de Implementação)

Em todos os nós do tipo `If` adicionados para proteção de permissões, podemos utilizar uma simples expressão Javascript no n8n:

```javascript
// Exemplo para o Media Describer (Check Media Permission)
const perms = $('Get Media Permissions').item.json.module_permissions;
if (!perms || perms.length === 0) return true;
return perms.includes('media_describer'); // Valida nó pai diretamente
```

```javascript
// Exemplo para o Trends, Alerts and Strategies (Check TAS Permission)
const perms = $('Get TAS Permissions').item.json.module_permissions;
if (!perms || perms.length === 0) return true;
return perms.includes('trends_alerts_strategies'); // Valida nó pai diretamente
```

---

## 5. Passos para Aplicação e Deploy

1. Duplicar os 4 workflows no JSON `workflows.json` e gerar identificadores únicos correspondentes de 16 caracteres.
2. Aplicar a inserção dos nós conforme planejado e atualizar as coordenadas visuais dos nós afetados.
3. Importar os workflows modificados para o banco do n8n utilizando os utilitários do repositório:
   ```bash
   node activate_and_migrate.js
   ```
4. Testar os webhooks e crons simulando payload com contas bloqueadas para validar se o fluxo morre nas etapas iniciais de validação.
