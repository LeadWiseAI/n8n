const fs = require('fs');

const workflowsPath = '/root/leadwise_n8n/workflows.json';
const data = JSON.parse(fs.readFileSync(workflowsPath, 'utf8'));

// 1. Deactivate original workflow "Sentiment Analysis - Per lead - V3" (YFkvXD1YmD4bSc8C)
const originalWf = data.find(w => w.id === 'YFkvXD1YmD4bSc8C');
if (originalWf) {
  originalWf.active = false;
  console.log('Deactivated the original workflow "Sentiment Analysis - Per lead - V3".');
}

// 2. Activate Gemini workflow "Sentiment Analysis - Per lead - V3 - Gemini" (u1vdhWbiCMSt0Z1Q)
const geminiWf = data.find(w => w.name === 'Sentiment Analysis - Per lead - V3 - Gemini');
if (geminiWf) {
  geminiWf.active = true;
  console.log('Activated the new "Sentiment Analysis - Per lead - V3 - Gemini" workflow.');
}

// 3. Update the calling workflow "Triagem e analises individuais - V3" (ANma7fFMpL2xMd7U)
const callingWf = data.find(w => w.id === 'ANma7fFMpL2xMd7U');
if (callingWf) {
  const node = callingWf.nodes.find(n => n.name === "Call 'Sentiment Analysis - Per lead'");
  if (node) {
    node.parameters.workflowId = {
      "__rl": true,
      "value": geminiWf.id,
      "mode": "list",
      "cachedResultUrl": "/workflow/" + geminiWf.id,
      "cachedResultName": geminiWf.name
    };
    console.log('Updated the sub-workflow reference in "Triagem e analises individuais - V3" to point to the Gemini version.');
  } else {
    console.error('Error: Calling node not found in "Triagem e analises individuais - V3"!');
  }
} else {
  console.error('Error: Calling workflow "Triagem e analises individuais - V3" not found!');
}

fs.writeFileSync(workflowsPath, JSON.stringify(data, null, 2));
console.log('Successfully saved changes to workflows.json.');
