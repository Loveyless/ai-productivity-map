import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://loveyless.github.io',
  base: '/ai-productivity-map',
  output: 'static',
  build: {
    format: 'directory',
  },
});
