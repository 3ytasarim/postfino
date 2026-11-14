"use client";
import { motion } from "motion/react";

/** Page transition between app routes: content rises in (the template remounts on every navigation). */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}
