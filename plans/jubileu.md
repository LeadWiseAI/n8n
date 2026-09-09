# Jubileu — gates de `module_permissions` no n8n

Visão única para as cópias `- Gemini`. Catálogo e UI ficam no ia-analytics. Aqui só: **quando um workflow pode gastar LLM**.

Regra geral: fail-closed. Sem array, `null` ou `[]` → não chama modelo. Uma chave do OR basta; nunca exigir o par.

---

## 1. O que o n8n precisa saber

O array vem cru de `organization_users.module_permissions`.

Nos três fluxos de mensagem, já chega em `metadata.module_permissions` — **não** abrir conexão Supabase extra. Media e TAS leem a linha por `organization_user_id`.

Helper único (mesmo contrato em todo If/Code):

```
has(perms, ...keys) → true se perms é array e alguma key está nele
```

Pais sem ponto. Filhos `pai.recurso`. Não inventar `copilot.media_describer` nem `analises.v3`.

---

## 2. Catálogo que importa neste plano

Só chaves que **abrem ou fecham um workflow/ramo**. O resto (`dashboard`, `planos`, `uso_ia.custos`, `copilot.hot`, `copilot.todas`, `copilot.indicados`…) é menu/UI neste repo e o n8n ignora.

| Chave | Papel no n8n |
|---|---|
| `media_describer` | Liga o Media describer. Absoluto: mais nada entra na conta. |
| `trends_alerts_strategies` | Liga o TAS. |
| `analises.sentimentos` | Liga sentimento (triagem). |
| `copilot.em_risco` | Também liga sentimento (mesmo ramo). |
| `analises.produtos` | Liga produto. |
| `analises.topicos` | Liga tópicos. |
| `analises.objecoes` | Liga objeções. |
| `analises.segmentacao` | Liga segmentos. |
| `analises.follow_ups` | Liga follow-up (triagem **e** workflow per-lead). |
| `copilot.follow_ups` | Também liga follow-up (os dois lugares). |
| `copilot.esquecidos` | Liga waiting-answer. |

`copilot.hot` **não entra no n8n**. A fila Hot é deste código (Copilot v2 / classificação de lead).

Chaves mortas — se aparecerem no array, ignorar: `analises.v3`, `analises.sentimento`, `gestao_vendas.funil`, `copilot.sugestoes_ia`, `copilot.waiting_answer`.

---

## 3. Mapa fluxo → gate

Trabalhar só nas cópias `- Gemini`. Waiting-answer já é `- Gemini`.

| Workflow | Depois de | Gate |
|---|---|---|
| Triagem e analises individuais - V3 | `get-analytics-lead-messages` | Filtra `values` por ramo (abaixo) |
| Follow up - Per lead - V3 | `get-follow-up-lead-messages` | `analises.follow_ups` **ou** `copilot.follow_ups` |
| Check waiting answer - Agent - V3 | `get-waiting-answer-lead-messages` | `copilot.esquecidos` |
| Media describer webhook - V3 | Webhook + GET `organization_users` | `media_describer` e `organization_user_id` |
| Leadwise - Trends, Alerts and Strategies | GET `organization_users` | `trends_alerts_strategies` |

### Triagem (um Code, só aqui)

Interseção `suggested` × permissões. Cada ramo é uma lista OR:

```
sentiment   → analises.sentimentos | copilot.em_risco
product     → analises.produtos
topics      → analises.topicos
objections  → analises.objecoes
followup    → analises.follow_ups | copilot.follow_ups
segments    → analises.segmentacao
```

Ramo sem chave → some da lista. Lista vazia → não segue para LLM daquele tipo.

Em risco **não** é um workflow. É a mesma permissão do sentimento: quem tem só `copilot.em_risco` (sem `analises.sentimentos`) ainda gera análise negativa.

Follow-up **é o mesmo OR** no item da triagem e no workflow per-lead. Quem tem só Copilot follow-ups gera roteiro; quem tem só Análises follow-ups também.

### Media

1. Sem `organization_user_id` → 200, sem query, sem LLM.
2. If `contains media_describer` → transcreve.
3. Qualquer outra chave (ou a falta delas) **não** veta.

### TAS / waiting-answer / follow-up per-lead

If nativo. Falso → para sem custo.

Follow-up per-lead: duas condições OR no mesmo If (`analises.follow_ups` ∥ `copilot.follow_ups`).

---

## 4. O que não fazer

- Não gatear Hot, Indicados, Todas, Relatórios, Planos, Uso da IA.
- Não exigir o pai `analises` além do granular (quem tem só `analises.sentimentos` já basta).
- Não exigir o pai `copilot` além do granular da fila — exceto se o array vier vazio.
- Não usar Code para If binário (media, TAS, waiting-answer). Code só na triagem.
- Não editar o workflow estável.

---

## 5. Rollout

Backfill e catálogo no ia-analytics já rodaram. Falta:

1. Edge functions devolvendo `metadata.module_permissions` cru (se ainda não estiver em produção).
2. Montar as cópias `- Gemini` com os If/OR acima.
3. Ligar as cópias só depois de 1.
