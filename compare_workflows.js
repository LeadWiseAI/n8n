const { execSync } = require('child_process');
const fs = require('fs');

// 1. Get current workflows
const currentContent = fs.readFileSync('workflows.json', 'utf8');
const currentWorkflows = JSON.parse(currentContent);

// 2. Get initial workflows from git
const initialContent = execSync('git show db21ddc:workflows.json', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
const initialWorkflows = JSON.parse(initialContent);

console.log('=== original vs current active states ===');

const initialMap = new Map(initialWorkflows.map(w => [w.id, w]));
const currentMap = new Map(currentWorkflows.map(w => [w.id, w]));

console.log('\n--- Gemini Workflows in Current: ---');
for (const [id, w] of currentMap) {
  if (w.name.includes('Gemini')) {
    const originalExists = initialMap.has(id);
    console.log(`ID: ${id} | Name: "${w.name}" | Active: ${w.active} | (New: ${!originalExists})`);
  }
}

console.log('\n--- Workflows whose Active State Changed: ---');
for (const [id, w] of currentMap) {
  const initWf = initialMap.get(id);
  if (initWf) {
    if (initWf.active !== w.active) {
      console.log(`ID: ${id} | Name: "${w.name}" | Original Active: ${initWf.active} -> Current Active: ${w.active}`);
    }
  } else {
    console.log(`ID: ${id} | Name: "${w.name}" | New Workflow | Current Active: ${w.active}`);
  }
}
