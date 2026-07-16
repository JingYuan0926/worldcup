import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { Shell } from "@/components/v2/Shell";
import "./v2.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--v2-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--v2-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Exact Match — precision pools, settled by proof",
  description:
    "Call the exact second. Settled trustlessly on Solana by TxLINE Merkle proofs — no admin key, no oracle committee, no human.",
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`v2-root ${archivo.variable} ${plexMono.variable}`}>
      <Shell>{children}</Shell>
    </div>
  );
}
