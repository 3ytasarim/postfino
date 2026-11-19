"use client";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";

/** Single-open accordion with the shadcn/ui API and look, without the Radix dependency. */
type RootCtx = { value: string | null; toggle: (v: string) => void };
const Root = createContext<RootCtx | null>(null);
const Item = createContext<{ value: string; open: boolean; id: string } | null>(null);

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Accordion({
  collapsible = false,
  defaultValue = null,
  className,
  children,
}: {
  type?: "single";
  collapsible?: boolean;
  defaultValue?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [value, setValue] = useState<string | null>(defaultValue);
  const toggle = (v: string) => setValue((cur) => (cur === v ? (collapsible ? null : cur) : v));
  return (
    <Root.Provider value={{ value, toggle }}>
      <div className={className}>{children}</div>
    </Root.Provider>
  );
}

export function AccordionItem({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const root = useContext(Root);
  const id = useId();
  const open = root?.value === value;
  return (
    <Item.Provider value={{ value, open, id }}>
      <div data-state={open ? "open" : "closed"} className={cx("border-b last:border-b-0", className)}>
        {children}
      </div>
    </Item.Provider>
  );
}

export function AccordionTrigger({ className, children }: { className?: string; children: ReactNode }) {
  const root = useContext(Root);
  const item = useContext(Item);
  if (!root || !item) return null;
  return (
    <h3 className="flex">
      <button
        type="button"
        id={`${item.id}-trigger`}
        aria-expanded={item.open}
        aria-controls={`${item.id}-content`}
        data-state={item.open ? "open" : "closed"}
        onClick={() => root.toggle(item.value)}
        className={cx(
          "flex min-h-12 flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 [&[data-state=open]>svg]:rotate-180",
          className,
        )}
      >
        {children}
        <ChevronDown aria-hidden className="pointer-events-none size-4 shrink-0 translate-y-0.5 text-ink-3 transition-transform duration-200" />
      </button>
    </h3>
  );
}

export function AccordionContent({ className, children }: { className?: string; children: ReactNode }) {
  const item = useContext(Item);
  const reduce = useReducedMotion();
  if (!item) return null;
  return (
    <AnimatePresence initial={false}>
      {item.open && (
        <motion.div
          id={`${item.id}-content`}
          role="region"
          aria-labelledby={`${item.id}-trigger`}
          className="overflow-hidden text-sm"
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0 }}
          transition={{ duration: reduce ? 0 : 0.2, ease: "easeOut" }}
        >
          <div className={cx("pt-0 pb-4", className)}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
