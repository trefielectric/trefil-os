import type { Metadata } from "next";
import { WorkforceApp } from "@/components/workforce-app";
import "./workforce.css";

export const metadata: Metadata = {
  title: "Equipo · Trefil OS",
  description: "Asistencia, tareas y gestión del equipo de Trefil Electric.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function WorkforcePage() {
  return <WorkforceApp />;
}
