const { ensureDevApp } = require('./electron-app.cjs');

const app = ensureDevApp();
console.log(`Built ${app.productName} at ${app.targetApp}`);
