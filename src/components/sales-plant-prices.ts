"use client";
import { useContext, useEffect, useState } from "react";
import { PublicWorkspace } from "@/lib/jornada-permissions";
import { getSupabaseClient } from "@/lib/supabase/client";

type OfficialPrice = {
  lista: string;
  codigo: string;
  precio: string;
  vigente: string;
};
export function usePlantPrices() {
  const guest=useContext(PublicWorkspace);
  const [prices, setPrices] = useState<OfficialPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if(guest){setPrices([]);setLoading(false);setMessage("Catálogo de prueba");return;}
    const client = getSupabaseClient();
    if (!client) {
      setLoading(false);
      setMessage(
        "Catálogo local. Conecta tu cuenta de Equipo para consultar las tarifas oficiales.",
      );
      return;
    }
    let version = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const current = ++version;
      clearTimeout(timer);
      setLoading(true);
      setPrices([]);
      timer = setTimeout(async () => {
        try {
          const { data } = await client.auth.getSession();
          if (current !== version) return;
          if (!data.session)
            throw new Error(
              "Catálogo local. Inicia sesión en Equipo para consultar los precios oficiales.",
            );
          const result = await client.rpc("plant_current_prices");
          if (current !== version) return;
          if (result.error)
            throw new Error("No se pudieron consultar los precios oficiales.");
          setPrices(result.data ?? []);
          setMessage("");
        } catch (error) {
          if (current === version)
            setMessage(
              error instanceof Error
                ? error.message
                : "No se pudieron cargar las tarifas.",
            );
        } finally {
          if (current === version) setLoading(false);
        }
      }, 0);
    };
    const { data } = client.auth.onAuthStateChange(refresh);
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      ++version;
      clearTimeout(timer);
      data.subscription.unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [guest]);
  return { prices, loading, message };
}
