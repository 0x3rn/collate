import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

export default defineConfig({
  server: {
    // Local dev only: lets Polar / Paystack sandbox webhooks reach this machine through a
    // temporary Cloudflare quick tunnel (cloudflared tunnel --url http://localhost:5173).
    allowedHosts: [".trycloudflare.com"],
  },
  plugins: [
    vinext({
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
