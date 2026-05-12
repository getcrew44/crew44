const { ensureDevApp } = require('./app.cjs');

const app = ensureDevApp();
console.log(`Built ${app.productName} at ${app.targetApp}`);
