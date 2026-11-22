import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base: the build runs at a site's root or in any sub-folder.
export default defineConfig({
  base: './',
  plugins: [react()],
})
