import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const base = "/react-icons/";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
  define: {
    "process.env.BASE": JSON.stringify(base.slice(0, -1)),
  },
});
