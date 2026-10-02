import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({
  root: 'preview',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^.*Ledgercontext(\.jsx)?$/, replacement: path.resolve('preview/stub-ledger.jsx') },
      { find: /^.*useCompanySync(\.js)?$/, replacement: path.resolve('preview/stub-sync.js') },
      { find: /^.*useSubscription(\.js)?$/, replacement: path.resolve('preview/stub-subscription.js') },
    ],
  },
});
