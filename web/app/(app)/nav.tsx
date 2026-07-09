"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/today", label: "Today" },
  { href: "/leads", label: "Leads" },
  { href: "/conversations", label: "Conversations" },
  { href: "/callbacks", label: "Callbacks" },
  { href: "/projects", label: "Projects" },
  { href: "/sources", label: "Sources" },
  { href: "/playbooks", label: "Playbooks" },
  { href: "/assistant", label: "Assistant" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav>
      {items.map((i) => (
        <Link key={i.href} href={i.href}
          className={`nav-item ${path === i.href || path.startsWith(i.href + "/") ? "active" : ""}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
