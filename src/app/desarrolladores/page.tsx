import type { Metadata } from "next";
import { DeveloperApp } from "@/components/developer-app";
import "./developers.css";

export const metadata:Metadata={title:"Desarrolladores · Trefil OS",description:"Claves, permisos y conexiones MCP de Trefil Electric.",robots:{index:false,follow:false},referrer:"no-referrer"};
export default function DeveloperPage(){return <DeveloperApp/>}
