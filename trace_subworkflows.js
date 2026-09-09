const fs = require('fs');

const data = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));
const workflowsMap = new Map(data.map(w => [w.id, w]));

const roots = [
  { id: 'blo9CtclyCJHZuGz', name: 'CRON - Follow-up - V3 - Real time' },
  { id: 'v6NUteIdSiuUO8CE', name: 'CRON - Check awaiting leads - V3' },
  { id: 'vgsOvwesuExBXFtk', name: 'CRON - Analyze new messages - V3' },
  { id: 'fTwsVAuDXAE2YL9L', name: 'Orchestrator - Real data - Scheduled' }
];

const visited = new Set();
const tree = {};

function trace(id, depth = 0) {
  if (visited.has(id)) return;
  visited.add(id);

  const wf = workflowsMap.get(id);
  if (!wf) {
    console.log(`[Warning] Workflow with ID ${id} not found in workflows.json.`);
    return;
  }

  tree[id] = { name: wf.name, subworkflows: [] };

  // Find all "Execute Workflow" nodes
  if (wf.nodes) {
    for (const node of wf.nodes) {
      if (node.type === 'n8n-nodes-base.executeWorkflow') {
        const wfIdParam = node.parameters?.workflowId;
        let subId = null;
        if (typeof wfIdParam === 'string') {
          subId = wfIdParam;
        } else if (wfIdParam && typeof wfIdParam === 'object') {
          subId = wfIdParam.value;
        }
        if (subId) {
          tree[id].subworkflows.push({ id: subId, nodeName: node.name });
          trace(subId, depth + 1);
        }
      }
    }
  }
}

console.log('=== Recursive Subworkflow Tracing ===\n');
for (const r of roots) {
  console.log(`Tracing from root: "${r.name}" (${r.id})...`);
  trace(r.id);
}

console.log('\n--- Full Dependency Tree: ---');
console.log(JSON.stringify(tree, null, 2));

console.log('\n--- All Reachable Workflow IDs in Scope: ---');
console.log(Array.from(visited).map(id => {
  const wf = workflowsMap.get(id);
  return `${id} => "${wf ? wf.name : 'Unknown'}"`;
}));
