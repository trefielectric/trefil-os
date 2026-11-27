"use client";
import { createContext } from "react";
export const JornadaPermissions = createContext<readonly string[]>([]);

export const PublicWorkspace = createContext(false);
