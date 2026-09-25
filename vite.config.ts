import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		devtools(),
		// Nitro picks the Vercel preset when building on Vercel. Tokyo (hnd1) runs
		// in AWS ap-northeast-1, the Turso database's region, and avoids Vercel's
		// default US East: OKX refuses requests from US IPs.
		nitro({ vercel: { functions: { regions: ["hnd1"] } } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});
