import type { Metadata } from "next";
import { CentralInventory } from "@/components/central-inventory";
import "./inventory.css";

export const metadata: Metadata = {
  title: "Inventario central · Trefil OS",
  robots: { index: false, follow: false },
};

export default function InventoryPage() {
  return <CentralInventory />;
}
